import { Pool, PoolClient } from 'pg';

/**
 * Result interface for multipoint intersection splitting operations
 */
export interface MultipointIntersectionSplittingResult {
  success: boolean;
  intersectionsProcessed: number;
  segmentsCreated: number;
  trailsSplit: number;
  error?: string;
  details?: {
    xIntersections: number;        // 2-point crossings
    pIntersections: number;        // 3+ point complex intersections
    toleranceUsed: number;
    processingTimeMs: number;
  };
}

/**
 * Interface for detected multipoint intersections
 */
export interface MultipointIntersection {
  trail1Uuid: string;
  trail1Name: string;
  trail2Uuid: string;
  trail2Name: string;
  intersectionType: 'x_intersection' | 'p_intersection';
  pointCount: number;
  intersectionPoints: Array<{
    point: any; // PostGIS geometry
    path: number[];
  }>;
  distanceMeters: number;
}

/**
 * Configuration for multipoint intersection splitting
 */
export interface MultipointIntersectionConfig {
  stagingSchema: string;
  toleranceMeters?: number;
  minTrailLengthMeters?: number;
  maxIntersectionPoints?: number;
  maxIterations?: number;
  verbose?: boolean;
}

/**
 * Focused service to handle only multipoint intersections (ST_MultiPoint geometry types)
 * 
 * This service specifically targets:
 * - X-Intersections: 2-point crossings where trails cross each other
 * - P-Intersections: 3+ point complex intersections with multiple crossing points
 * 
 * It does NOT handle:
 * - Single point intersections (ST_Point) - handled by TIntersectionSplittingService
 * - Line intersections (ST_LineString) - handled by YIntersectionSplittingService
 * - Complex geometry collections - handled by ComplexIntersectionSplittingService
 */
export class MultipointIntersectionSplittingService {
  private config: Required<MultipointIntersectionConfig>;

  constructor(
    private pgClient: Pool,
    config: MultipointIntersectionConfig
  ) {
    this.config = {
      toleranceMeters: 5.0,
      minTrailLengthMeters: 10.0,
      maxIntersectionPoints: 10,
      maxIterations: 20,
      verbose: false,
      ...config
    };
  }

  /**
   * Main entry point for iterative multipoint intersection splitting
   * Processes intersections one at a time until all are resolved
   */
  async splitMultipointIntersections(): Promise<MultipointIntersectionSplittingResult> {
    const startTime = Date.now();
    
    try {
      if (this.config.verbose) {
        console.log('🔗 Starting iterative multipoint intersection splitting...');
        console.log(`   📊 Configuration:`);
        console.log(`      - Tolerance: ${this.config.toleranceMeters}m`);
        console.log(`      - Min trail length: ${this.config.minTrailLengthMeters}m`);
        console.log(`      - Max intersection points: ${this.config.maxIntersectionPoints}`);
        console.log(`      - Max iterations: ${this.config.maxIterations}`);
      }

      let totalIntersectionsProcessed = 0;
      let totalSegmentsCreated = 0;
      let totalTrailsSplit = 0;
      let totalXIntersections = 0;
      let totalPIntersections = 0;
      let iteration = 1;
      let hasMoreIntersections = true;
      const failedIntersections = new Set<string>(); // Track consistently failing intersections

      // Iterative processing: keep splitting until no more multipoint intersections exist
      while (hasMoreIntersections && iteration <= this.config.maxIterations) {
        if (this.config.verbose) {
          console.log(`\n   🔄 Iteration ${iteration}/${this.config.maxIterations}:`);
        }

        // Step 1: Detect multipoint intersections in current state
        const intersections = await this.detectMultipointIntersections();
        
        if (intersections.length === 0) {
          if (this.config.verbose) {
            console.log(`   ✅ No more multipoint intersections found after ${iteration - 1} iterations`);
          }
          hasMoreIntersections = false;
          break;
        }

        if (this.config.verbose) {
          console.log(`   🔍 Found ${intersections.length} multipoint intersections:`);
          const xCount = intersections.filter(i => i.intersectionType === 'x_intersection').length;
          const pCount = intersections.filter(i => i.intersectionType === 'p_intersection').length;
          console.log(`      - X-Intersections (2 points): ${xCount}`);
          console.log(`      - P-Intersections (3+ points): ${pCount}`);
        }

        // Step 2: Process ONE intersection at a time (the most complex one first)
        const intersectionToProcess = this.selectIntersectionToProcess(intersections, failedIntersections);
        
        if (!intersectionToProcess) {
          if (this.config.verbose) {
            console.log(`   ⚠️ All remaining intersections have failed previously, stopping processing`);
          }
          hasMoreIntersections = false;
          break;
        }
        
        const intersectionKey = `${intersectionToProcess.trail1Uuid}-${intersectionToProcess.trail2Uuid}`;
        
        if (this.config.verbose) {
          console.log(`   🔧 Processing ${intersectionToProcess.intersectionType}: ${intersectionToProcess.trail1Name} ↔ ${intersectionToProcess.trail2Name} (${intersectionToProcess.pointCount} points)`);
        }

        const splitResult = await this.splitMultipointIntersection(intersectionToProcess);
        
        if (splitResult.success) {
          totalSegmentsCreated += splitResult.segmentsCreated;
          totalIntersectionsProcessed++;
          
          if (intersectionToProcess.intersectionType === 'x_intersection') {
            totalXIntersections++;
          } else {
            totalPIntersections++;
          }

          if (this.config.verbose) {
            console.log(`   ✅ Split successful: ${splitResult.segmentsCreated} segments created`);
          }
        } else {
          console.warn(`   ⚠️ Failed to split ${intersectionToProcess.intersectionType}: ${splitResult.error}`);
          // Mark this intersection as failed to avoid infinite loops
          failedIntersections.add(intersectionKey);
          
          if (this.config.verbose) {
            console.log(`   🚫 Marked intersection as failed to prevent infinite loops`);
          }
        }

        iteration++;
      }

      if (iteration > this.config.maxIterations) {
        console.warn(`   ⚠️ Reached maximum iterations (${this.config.maxIterations}). Some intersections may remain.`);
      }

      const processingTime = Date.now() - startTime;

      if (this.config.verbose) {
        console.log(`\n   ✅ Iterative multipoint intersection splitting completed:`);
        console.log(`      📊 Total intersections processed: ${totalIntersectionsProcessed}`);
        console.log(`      🔄 Total segments created: ${totalSegmentsCreated}`);
        console.log(`      🔄 Iterations completed: ${iteration - 1}`);
        console.log(`      ⏱️ Total processing time: ${processingTime}ms`);
      }

      return {
        success: true,
        intersectionsProcessed: totalIntersectionsProcessed,
        segmentsCreated: totalSegmentsCreated,
        trailsSplit: totalTrailsSplit,
        details: {
          xIntersections: totalXIntersections,
          pIntersections: totalPIntersections,
          toleranceUsed: this.config.toleranceMeters,
          processingTimeMs: processingTime
        }
      };

    } catch (error) {
      console.error('❌ Error in iterative multipoint intersection splitting:', error);
      return {
        success: false,
        intersectionsProcessed: 0,
        segmentsCreated: 0,
        trailsSplit: 0,
        error: error instanceof Error ? error.message : String(error),
        details: {
          xIntersections: 0,
          pIntersections: 0,
          toleranceUsed: this.config.toleranceMeters,
          processingTimeMs: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Select which intersection to process next (prioritize most complex ones, skip failed ones)
   */
  private selectIntersectionToProcess(
    intersections: MultipointIntersection[], 
    failedIntersections: Set<string>
  ): MultipointIntersection | null {
    // Filter out failed intersections
    const availableIntersections = intersections.filter(intersection => {
      const intersectionKey = `${intersection.trail1Uuid}-${intersection.trail2Uuid}`;
      return !failedIntersections.has(intersectionKey);
    });
    
    if (availableIntersections.length === 0) {
      return null;
    }
    
    // Sort by complexity: P-intersections first, then by point count (descending)
    return availableIntersections.sort((a, b) => {
      // P-intersections (3+ points) before X-intersections (2 points)
      if (a.intersectionType === 'p_intersection' && b.intersectionType === 'x_intersection') {
        return -1;
      }
      if (a.intersectionType === 'x_intersection' && b.intersectionType === 'p_intersection') {
        return 1;
      }
      // Within same type, sort by point count (descending)
      return b.pointCount - a.pointCount;
    })[0];
  }

  /**
   * Detect all multipoint intersections in the staging trails
   * Enhanced to properly distinguish between endpoint intersections and X-intersections
   */
  private async detectMultipointIntersections(): Promise<MultipointIntersection[]> {
    const query = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t1.geometry as trail1_geom,
          t2.geometry as trail2_geom,
          ST_StartPoint(t1.geometry) as trail1_start,
          ST_EndPoint(t1.geometry) as trail1_end,
          ST_StartPoint(t2.geometry) as trail2_start,
          ST_EndPoint(t2.geometry) as trail2_end
        FROM ${this.config.stagingSchema}.trails t1
        JOIN ${this.config.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE 
          ST_Length(t1.geometry::geography) >= $1
          AND ST_Length(t2.geometry::geography) >= $1
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND t1.app_uuid != t2.app_uuid  -- Exclude self-intersections
      ),
      intersections AS (
        SELECT 
          trail1_uuid,
          trail1_name,
          trail2_uuid,
          trail2_name,
          trail1_geom,
          trail2_geom,
          trail1_start,
          trail1_end,
          trail2_start,
          trail2_end,
          ST_Force3D(ST_Intersection(trail1_geom, trail2_geom)) as intersection_geom,
          ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) as intersection_type
        FROM trail_pairs
        WHERE ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) = 'ST_MultiPoint'
      ),
      point_counts AS (
        SELECT 
          *,
          ST_NumGeometries(intersection_geom) as point_count
        FROM intersections
      ),
      intersection_analysis AS (
        SELECT 
          *,
    -- Check if any intersection points are near trail endpoints (within 1.0 meter - reasonable tolerance)
    EXISTS(
      SELECT 1 FROM (
        SELECT (ST_Dump(intersection_geom)).geom as point_geom
      ) points
      WHERE ST_DWithin(points.point_geom, trail1_start, 1.0) 
         OR ST_DWithin(points.point_geom, trail1_end, 1.0)
         OR ST_DWithin(points.point_geom, trail2_start, 1.0)
         OR ST_DWithin(points.point_geom, trail2_end, 1.0)
    ) as has_endpoint_intersection,
    -- Check if any intersection points are in the middle of trails (not very close to endpoints)
    EXISTS(
      SELECT 1 FROM (
        SELECT (ST_Dump(intersection_geom)).geom as point_geom
      ) points
      WHERE NOT ST_DWithin(points.point_geom, trail1_start, 1.0) 
        AND NOT ST_DWithin(points.point_geom, trail1_end, 1.0)
        AND NOT ST_DWithin(points.point_geom, trail2_start, 1.0)
        AND NOT ST_DWithin(points.point_geom, trail2_end, 1.0)
    ) as has_middle_intersection
        FROM point_counts
      )
      SELECT 
        trail1_uuid,
        trail1_name,
        trail2_uuid,
        trail2_name,
        intersection_geom,
        point_count,
        has_endpoint_intersection,
        has_middle_intersection,
        CASE 
          WHEN point_count = 2 AND has_endpoint_intersection AND has_middle_intersection THEN 'dual_intersection'
          WHEN point_count = 2 AND has_endpoint_intersection THEN 'endpoint_intersection'
          WHEN point_count = 2 AND has_middle_intersection THEN 'x_intersection'
          WHEN point_count > 2 THEN 'p_intersection'
          ELSE 'unknown'
        END as intersection_type
      FROM intersection_analysis
      WHERE point_count >= 2 AND point_count <= $2
        -- Include all multipoint intersections: X-intersections, P-intersections, endpoint intersections, and dual intersections
        AND (
          (point_count = 2 AND has_middle_intersection) OR  -- X-intersections (middle crossings)
          (point_count > 2 AND has_middle_intersection) OR  -- P-intersections (complex crossings)
          (point_count = 2 AND has_endpoint_intersection AND has_middle_intersection) OR  -- dual intersections (endpoint + middle)
          (point_count = 2 AND has_endpoint_intersection AND NOT has_middle_intersection)  -- pure endpoint intersections
        )
      ORDER BY point_count DESC, trail1_name, trail2_name
    `;

    const result = await this.pgClient.query(query, [
      this.config.minTrailLengthMeters,
      this.config.maxIntersectionPoints
    ]);

    const intersections: MultipointIntersection[] = [];

    for (const row of result.rows) {
      // Extract individual points from the MultiPoint geometry
      const pointsResult = await this.pgClient.query(`
        SELECT 
          (ST_Dump($1::geometry)).geom as point_geom,
          (ST_Dump($1::geometry)).path as point_path
      `, [row.intersection_geom]);

      const intersectionPoints = pointsResult.rows.map(pointRow => ({
        point: pointRow.point_geom,
        path: pointRow.point_path
      }));

      intersections.push({
        trail1Uuid: row.trail1_uuid,
        trail1Name: row.trail1_name,
        trail2Uuid: row.trail2_uuid,
        trail2Name: row.trail2_name,
        intersectionType: row.intersection_type,
        pointCount: row.point_count,
        intersectionPoints,
        distanceMeters: 0 // Will be calculated during splitting
      });
    }

    return intersections;
  }

  /**
   * Split trails at a specific multipoint intersection
   */
  private async splitMultipointIntersection(intersection: MultipointIntersection): Promise<{ success: boolean; segmentsCreated: number; error?: string }> {
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');

      // Get the original trail geometries
      const trail1Result = await client.query(`
        SELECT geometry FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1
      `, [intersection.trail1Uuid]);

      const trail2Result = await client.query(`
        SELECT geometry FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1
      `, [intersection.trail2Uuid]);

      if (trail1Result.rows.length === 0 || trail2Result.rows.length === 0) {
        throw new Error(`Trail not found: ${intersection.trail1Uuid} or ${intersection.trail2Uuid}`);
      }

      const trail1Geom = trail1Result.rows[0].geometry;
      const trail2Geom = trail2Result.rows[0].geometry;

      let segmentsCreated = 0;

      // Split trail1 at all intersection points
      const trail1Segments = await this.splitTrailAtMultiPoint(client, intersection.trail1Uuid, trail1Geom, intersection.intersectionPoints);
      segmentsCreated += trail1Segments;

      // Split trail2 at all intersection points
      const trail2Segments = await this.splitTrailAtMultiPoint(client, intersection.trail2Uuid, trail2Geom, intersection.intersectionPoints);
      segmentsCreated += trail2Segments;

      await client.query('COMMIT');

      return {
        success: true,
        segmentsCreated
      };

    } catch (error) {
      await client.query('ROLLBACK');
      return {
        success: false,
        segmentsCreated: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      client.release();
    }
  }

  /**
   * Split trails at multipoint intersections using the MultiPoint geometry directly
   * This is more reliable than trying to collect individual points
   * PRESERVES 3D COORDINATES throughout the splitting process
   */
  private async splitTrailAtMultiPoint(
    client: PoolClient, 
    trailUuid: string, 
    trailGeom: any, 
    intersectionPoints: Array<{ point: any; path: number[] }>
  ): Promise<number> {
    // Get the original trail data first
    const originalTrailResult = await client.query(`
      SELECT * FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1
    `, [trailUuid]);

    if (originalTrailResult.rows.length === 0) {
      return 0;
    }

    const originalTrail = originalTrailResult.rows[0];
    
    if (intersectionPoints.length < 2) {
      // Not enough points to create segments
      return 0;
    }

    let segmentCount = 0;
    
    // Create a MultiPoint geometry from the intersection points
    const multiPointGeom = intersectionPoints.map(p => p.point);
    
    // Use ST_Split with the MultiPoint geometry to split at all intersection points
    const splitResult = await client.query(`
      SELECT ST_Split($1::geometry, ST_Collect($2::geometry[])) as split_geom
    `, [trailGeom, multiPointGeom]);
    
    if (splitResult.rows.length > 0 && splitResult.rows[0].split_geom) {
      const splitGeom = splitResult.rows[0].split_geom;
      
      // Extract individual segments from the split geometry
      const segmentsResult = await client.query(`
        SELECT 
          (ST_Dump($1::geometry)).geom as segment_geom,
          (ST_Dump($1::geometry)).path as segment_path
        FROM (SELECT $1::geometry as geom) as g
      `, [splitGeom]);
      
      // Process each segment
      for (const segmentRow of segmentsResult.rows) {
        const segmentGeom = segmentRow.segment_geom;
        
        // Ensure 3D coordinates are preserved
        const segment3DResult = await client.query(`
          SELECT ST_Force3D($1::geometry) as segment_3d_geom
        `, [segmentGeom]);
        
        if (segment3DResult.rows.length > 0) {
          const segment3DGeom = segment3DResult.rows[0].segment_3d_geom;
          
          // Check if the segment is long enough
          const lengthMeters = await client.query(`
            SELECT ST_Length($1::geography) as length_m
          `, [segment3DGeom]);
          
          const lengthM = parseFloat(lengthMeters.rows[0].length_m);
          
          if (lengthM >= this.config.minTrailLengthMeters) {
            const segmentUuid = `${trailUuid}_segment_${segmentCount + 1}`;
            
            await client.query(`
              INSERT INTO ${this.config.stagingSchema}.trails (
                app_uuid, original_trail_uuid, osm_id, name, trail_type, surface, difficulty,
                source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
                source, geometry
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
              )
            `, [
              segmentUuid,
              originalTrail.original_trail_uuid || trailUuid,
              originalTrail.osm_id,
              `${originalTrail.name} (segment ${segmentCount + 1})`,
              originalTrail.trail_type,
              originalTrail.surface,
              originalTrail.difficulty,
              originalTrail.source_tags,
              originalTrail.bbox_min_lng,
              originalTrail.bbox_max_lng,
              originalTrail.bbox_min_lat,
              originalTrail.bbox_max_lat,
              lengthM / 1000, // Convert to km
              originalTrail.elevation_gain,
              originalTrail.elevation_loss,
              originalTrail.max_elevation,
              originalTrail.min_elevation,
              originalTrail.avg_elevation,
              originalTrail.source,
              segment3DGeom  // Use 3D geometry
            ]);
            
            segmentCount++;
          }
        }
      }
    }

    // Delete the original trail only if we created segments
    if (segmentCount > 0) {
      await client.query(`
        DELETE FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1
      `, [trailUuid]);
    }

    return segmentCount;
  }

  /**
   * Sort intersection points by their position along the trail
   */
  private async sortIntersectionPointsAlongTrail(
    client: PoolClient,
    trailGeom: any,
    intersectionPoints: Array<{ point: any; path: number[] }>
  ): Promise<Array<{ point: any; path: number[]; distance: number }>> {
    const pointsWithDistance = [];
    
    for (const pointData of intersectionPoints) {
      const distanceResult = await client.query(`
        SELECT ST_LineLocatePoint($1::geometry, $2::geometry) as distance
      `, [trailGeom, pointData.point]);
      
      const distance = parseFloat(distanceResult.rows[0].distance);
      pointsWithDistance.push({
        ...pointData,
        distance
      });
    }
    
    // Sort by distance along the trail
    return pointsWithDistance.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Validate the service configuration
   */
  private validateConfig(): void {
    if (!this.config.stagingSchema) {
      throw new Error('stagingSchema is required');
    }
    if (this.config.toleranceMeters <= 0) {
      throw new Error('toleranceMeters must be positive');
    }
    if (this.config.minTrailLengthMeters <= 0) {
      throw new Error('minTrailLengthMeters must be positive');
    }
    if (this.config.maxIntersectionPoints < 2) {
      throw new Error('maxIntersectionPoints must be at least 2');
    }
    if (this.config.maxIterations <= 0) {
      throw new Error('maxIterations must be positive');
    }
  }

  /**
   * Get statistics about current multipoint intersections in the staging schema
   */
  async getIntersectionStatistics(): Promise<{
    totalIntersections: number;
    xIntersections: number;
    pIntersections: number;
    maxPointCount: number;
    avgPointCount: number;
  }> {
    const query = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t1.geometry as trail1_geom,
          t2.geometry as trail2_geom
        FROM ${this.config.stagingSchema}.trails t1
        JOIN ${this.config.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE 
          ST_Length(t1.geometry::geography) >= $1
          AND ST_Length(t2.geometry::geography) >= $1
          AND ST_Intersects(t1.geometry, t2.geometry)
      ),
      intersections AS (
        SELECT 
          ST_Force3D(ST_Intersection(trail1_geom, trail2_geom)) as intersection_geom,
          ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) as intersection_type
        FROM trail_pairs
        WHERE ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) = 'ST_MultiPoint'
      ),
      point_counts AS (
        SELECT 
          ST_NumGeometries(intersection_geom) as point_count
        FROM intersections
      )
      SELECT 
        COUNT(*) as total_intersections,
        COUNT(CASE WHEN point_count = 2 THEN 1 END) as x_intersections,
        COUNT(CASE WHEN point_count > 2 THEN 1 END) as p_intersections,
        MAX(point_count) as max_point_count,
        AVG(point_count) as avg_point_count
      FROM point_counts
      WHERE point_count >= 2 AND point_count <= $2
    `;

    const result = await this.pgClient.query(query, [
      this.config.minTrailLengthMeters,
      this.config.maxIntersectionPoints
    ]);

    const row = result.rows[0];
    return {
      totalIntersections: parseInt(row.total_intersections) || 0,
      xIntersections: parseInt(row.x_intersections) || 0,
      pIntersections: parseInt(row.p_intersections) || 0,
      maxPointCount: parseInt(row.max_point_count) || 0,
      avgPointCount: parseFloat(row.avg_point_count) || 0
    };
  }
}
