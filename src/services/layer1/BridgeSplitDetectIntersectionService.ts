import { Pool } from 'pg';

export interface BridgeSplitDetectIntersectionResult {
  success: boolean;
  splitCount: number;
  intersectionsFound: number;
  bridgesCreated: number;
  error?: string;
  details?: {
    toleranceUsed: number;
    segmentsCreated: number;
    bridgesCreated: number;
  };
}

export class BridgeSplitDetectIntersectionService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Bridge, split, and detect intersections that handles both exact intersections and near-misses
   * This creates proper Y-configurations by:
   * 1. Detecting trails that should intersect but have gaps
   * 2. Bridging the gaps with connector trails
   * 3. Splitting trails at intersection points
   */
  async bridgeSplitDetectIntersections(
    gapToleranceMeters: number = 50.0,
    splitToleranceMeters: number = 5.0
  ): Promise<BridgeSplitDetectIntersectionResult> {
    try {
      console.log('🔍 Starting bridge, split, and detect intersection processing...');
      console.log(`   📏 Gap tolerance: ${gapToleranceMeters}m`);
      console.log(`   📏 Split tolerance: ${splitToleranceMeters}m`);
      
      let totalIntersectionsFound = 0;
      let totalSplitCount = 0;
      let totalBridgesCreated = 0;

      // Step 1: Find trail pairs that should intersect but have gaps
      const gapPairs = await this.findTrailGaps(gapToleranceMeters);
      console.log(`Found ${gapPairs.length} trail pairs with gaps that need bridging`);

      // Step 2: Bridge the gaps
      for (const pair of gapPairs) {
        console.log(`\n🔗 Bridging gap: ${pair.trail1_name} ↔ ${pair.trail2_name} (gap: ${pair.gapDistance.toFixed(1)}m)`);
        
        const bridgeSuccess = await this.createBridgeTrail(pair);
        if (bridgeSuccess) {
          totalBridgesCreated++;
        }
      }

      // Step 3: Find and split Y-intersections (trails that cross at midpoints)
      const yIntersectionPairs = await this.findYIntersectionPairs(splitToleranceMeters);
      console.log(`Found ${yIntersectionPairs.length} Y-intersection pairs to split`);

      for (const pair of yIntersectionPairs) {
        console.log(`\n✂️ Splitting Y-intersection: ${pair.trail1_name} ↔ ${pair.trail2_name}`);
        
        const splitSuccess = await this.splitYIntersection(pair);
        if (splitSuccess) {
          totalIntersectionsFound++;
          totalSplitCount += 2; // Each intersection creates 2 split points
        }
      }

      console.log(`✅ Bridge, split, and detect intersection processing completed:`);
      console.log(`   - Gaps bridged: ${totalBridgesCreated}`);
      console.log(`   - Y-intersections split: ${totalIntersectionsFound}`);
      console.log(`   - Split points created: ${totalSplitCount}`);

      return {
        success: true,
        splitCount: totalSplitCount,
        intersectionsFound: totalIntersectionsFound,
        bridgesCreated: totalBridgesCreated,
        details: {
          toleranceUsed: gapToleranceMeters,
          segmentsCreated: totalSplitCount,
          bridgesCreated: totalBridgesCreated
        }
      };

    } catch (error) {
      console.error('❌ Error in bridge, split, and detect intersection processing:', error);
      return {
        success: false,
        splitCount: 0,
        intersectionsFound: 0,
        bridgesCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find trail pairs that have gaps between them (should intersect but don't)
   */
  private async findTrailGaps(toleranceMeters: number): Promise<any[]> {
    const result = await this.pgClient.query(`
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Length(t1.geometry::geography) > 50  -- Only consider trails longer than 50m
          AND ST_Length(t2.geometry::geography) > 50
      ),
      gap_analysis AS (
        SELECT 
          trail1_uuid,
          trail1_name,
          trail1_geom,
          trail2_uuid,
          trail2_name,
          trail2_geom,
          ST_Distance(trail1_geom::geography, trail2_geom::geography) as gap_distance,
          ST_ClosestPoint(trail1_geom, ST_ClosestPoint(trail2_geom, ST_StartPoint(trail1_geom))) as trail1_closest,
          ST_ClosestPoint(trail2_geom, ST_ClosestPoint(trail1_geom, ST_StartPoint(trail2_geom))) as trail2_closest
        FROM trail_pairs
        WHERE ST_Distance(trail1_geom::geography, trail2_geom::geography) > 0
          AND ST_Distance(trail1_geom::geography, trail2_geom::geography) <= $1
      )
      SELECT 
        trail1_uuid,
        trail1_name,
        trail1_geom,
        trail2_uuid,
        trail2_name,
        trail2_geom,
        gap_distance,
        trail1_closest,
        trail2_closest
      FROM gap_analysis
      ORDER BY gap_distance ASC
    `, [toleranceMeters]);

    return result.rows;
  }

  /**
   * Create a bridge trail to connect two trails with a gap
   */
  private async createBridgeTrail(pair: any): Promise<boolean> {
    try {
      // Create a straight line between the closest points
      const bridgeGeometry = `LINESTRING(${pair.trail1_closest.x} ${pair.trail1_closest.y}, ${pair.trail2_closest.x} ${pair.trail2_closest.y})`;
      
      // Calculate bridge properties
      const bridgeLength = pair.gapDistance;
      const bridgeName = `Connector: ${pair.trail1_name} ↔ ${pair.trail2_name}`;
      
      // Insert the bridge trail
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, trail_type, length_km, elevation_gain, elevation_loss,
          geometry, source, source_tags, osm_id
        ) VALUES (
          gen_random_uuid(), $1, 'connector', $2, 0, 0,
          ST_GeomFromText($3, 4326), 'bridged', '{}', NULL
        )
      `, [bridgeName, bridgeLength / 1000, bridgeGeometry]);

      console.log(`   ✅ Created bridge: ${bridgeName} (${bridgeLength.toFixed(1)}m)`);
      return true;

    } catch (error) {
      console.error(`   ❌ Error creating bridge: ${error}`);
      return false;
    }
  }

  /**
   * Find trail pairs that form Y-intersections (trails that cross at midpoints)
   */
  private async findYIntersectionPairs(toleranceMeters: number): Promise<any[]> {
    const result = await this.pgClient.query(`
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
      ),
      intersection_analysis AS (
        SELECT 
          trail1_uuid,
          trail1_name,
          trail1_geom,
          trail2_uuid,
          trail2_name,
          trail2_geom,
          ST_Intersection(trail1_geom, trail2_geom) as intersection_point,
          -- Check if intersection is far from endpoints (midpoint intersection)
          LEAST(
            ST_Distance(ST_StartPoint(trail1_geom), ST_Intersection(trail1_geom, trail2_geom)),
            ST_Distance(ST_EndPoint(trail1_geom), ST_Intersection(trail1_geom, trail2_geom))
          ) as trail1_distance_to_endpoint,
          LEAST(
            ST_Distance(ST_StartPoint(trail2_geom), ST_Intersection(trail1_geom, trail2_geom)),
            ST_Distance(ST_EndPoint(trail2_geom), ST_Intersection(trail1_geom, trail2_geom))
          ) as trail2_distance_to_endpoint
        FROM trail_pairs
      )
      SELECT 
        trail1_uuid,
        trail1_name,
        trail1_geom,
        trail2_uuid,
        trail2_name,
        trail2_geom,
        intersection_point
      FROM intersection_analysis
      WHERE trail1_distance_to_endpoint > $1  -- Intersection is far from trail1 endpoints
        AND trail2_distance_to_endpoint > $1  -- Intersection is far from trail2 endpoints
      ORDER BY trail1_distance_to_endpoint ASC
    `, [toleranceMeters]);

    return result.rows;
  }

  /**
   * Split both trails at the Y-intersection point
   */
  private async splitYIntersection(pair: any): Promise<boolean> {
    try {
      console.log(`   🔧 Splitting ${pair.trail1_name} and ${pair.trail2_name} at intersection point`);

      // Split trail 1 at the intersection point
      const trail1Split = await this.splitTrailAtPoint(
        pair.trail1_uuid,
        pair.trail1_name,
        pair.trail1_geom,
        pair.intersection_point
      );

      // Split trail 2 at the intersection point
      const trail2Split = await this.splitTrailAtPoint(
        pair.trail2_uuid,
        pair.trail2_name,
        pair.trail2_geom,
        pair.intersection_point
      );

      return trail1Split && trail2Split;
    } catch (error) {
      console.error(`   ❌ Error splitting Y-intersection ${pair.trail1_name} ↔ ${pair.trail2_name}:`, error);
      return false;
    }
  }

  /**
   * Split a specific trail at the intersection point
   */
  private async splitTrailAtPoint(
    trailUuid: string,
    trailName: string,
    trailGeom: any,
    intersectionPoint: any
  ): Promise<boolean> {
    try {
      // Create a small buffer around the intersection point for splitting
      const bufferRadius = 0.1; // 0.1 meters
      const bufferQuery = `
        SELECT ST_Buffer($1::geography, $2)::geometry as buffer_geom
      `;
      
      const bufferResult = await this.pgClient.query(bufferQuery, [intersectionPoint, bufferRadius]);
      const bufferGeom = bufferResult.rows[0].buffer_geom;

      // Split the trail using the buffer
      const splitResult = await this.pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [trailGeom, bufferGeom]);

      const segments = splitResult.rows;
      
      if (segments.length > 1) {
        console.log(`   ✅ Split ${trailName} into ${segments.length} segments`);
        
        // Insert split segments and delete original
        await this.insertSplitSegmentsAndDeleteOriginal(
          trailUuid,
          segments,
          trailName
        );
        
        return true;
      } else {
        console.log(`   ⚠️ No split needed for ${trailName} (only ${segments.length} segment)`);
        return false;
      }
    } catch (error) {
      console.error(`   ❌ Error splitting trail ${trailName}:`, error);
      return false;
    }
  }

  /**
   * Insert split segments and delete the original trail
   */
  private async insertSplitSegmentsAndDeleteOriginal(
    originalTrailUuid: string,
    segments: any[],
    originalName: string
  ): Promise<void> {
    // Get original trail data
    const originalTrail = await this.pgClient.query(`
      SELECT * FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
    `, [originalTrailUuid]);

    if (originalTrail.rows.length === 0) return;

    const trail = originalTrail.rows[0];

    // Insert split segments (filter out very small segments)
    for (let i = 0; i < segments.length; i++) {
      const segmentGeom = segments[i].segment;
      
      const length = await this.pgClient.query(`
        SELECT ST_Length($1::geography) as length_m
      `, [segmentGeom]);

      // Only insert segments longer than 5 meters
      if (length.rows[0].length_m > 5) {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, trail_type, length_km, elevation_gain, elevation_loss,
            geometry, source, source_tags, osm_id
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9
          )
        `, [
          `${originalName} (Split ${i + 1})`,
          trail.trail_type,
          length.rows[0].length_m / 1000, // Convert to km
          trail.elevation_gain,
          trail.elevation_loss,
          segmentGeom,
          trail.source,
          trail.source_tags,
          trail.osm_id
        ]);
      }
    }

    // Delete the original trail
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
    `, [originalTrailUuid]);
  }
}
