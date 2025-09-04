import { Pool } from 'pg';

export interface IntersectionBasedSplittingResult {
  success: boolean;
  trailsSplit: number;
  segmentsCreated: number;
  intersectionPointsUsed: number;
  error?: string;
}

export interface IntersectionBasedSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  minSegmentLengthMeters: number;
  verbose?: boolean;
}

/**
 * Service to split trails at detected intersection points
 * This ensures that trails are properly split where they intersect each other
 */
export class IntersectionBasedTrailSplitter {
  constructor(private config: IntersectionBasedSplittingConfig) {}

  /**
   * Split trails at all detected intersection points
   */
  async splitTrailsAtIntersections(): Promise<IntersectionBasedSplittingResult> {
    console.log('🔗 Splitting trails at detected intersection points...');
    
    try {
      const { stagingSchema, pgClient, minSegmentLengthMeters, verbose = false } = this.config;
      
      // Step 1: Get all intersection points
      const intersectionPoints = await pgClient.query(`
        SELECT 
          intersection_point,
          intersection_point_3d,
          connected_trail_names,
          node_type
        FROM ${stagingSchema}.intersection_points
        WHERE node_type = 'intersection'
        ORDER BY intersection_point
      `);

      if (intersectionPoints.rows.length === 0) {
        console.log('   ℹ️ No intersection points found to split trails at');
        return {
          success: true,
          trailsSplit: 0,
          segmentsCreated: 0,
          intersectionPointsUsed: 0
        };
      }

      console.log(`   📍 Found ${intersectionPoints.rows.length} intersection points to process`);

      let totalTrailsSplit = 0;
      let totalSegmentsCreated = 0;
      let intersectionPointsUsed = 0;

      // Step 2: For each intersection point, find trails that pass through it and split them
      for (const intersection of intersectionPoints.rows) {
        const intersectionPoint = intersection.intersection_point;
        const connectedTrailNames = intersection.connected_trail_names;
        
        if (verbose) {
          console.log(`   🔍 Processing intersection: ${connectedTrailNames.join(' × ')}`);
        }

        // Find trails that pass through this intersection point
        const trailsToSplit = await pgClient.query(`
          SELECT 
            app_uuid,
            name,
            geometry,
            trail_type,
            surface,
            difficulty,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            source,
            source_tags,
            osm_id
          FROM ${stagingSchema}.trails
          WHERE ST_Intersects(geometry, $1)
            AND ST_Length(geometry::geography) > $2
        `, [intersectionPoint, minSegmentLengthMeters]);

        if (trailsToSplit.rows.length === 0) {
          if (verbose) {
            console.log(`      ⚠️ No trails found to split at this intersection`);
          }
          continue;
        }

        if (verbose) {
          console.log(`      📍 Found ${trailsToSplit.rows.length} trails to split`);
        }

        // Split each trail at the intersection point
        for (const trail of trailsToSplit.rows) {
          const splitResult = await this.splitTrailAtPoint(trail, intersectionPoint);
          
          if (splitResult.success) {
            totalTrailsSplit++;
            totalSegmentsCreated += splitResult.segmentsCreated;
            
            if (verbose) {
              console.log(`      ✂️ Split ${trail.name}: ${splitResult.segmentsCreated} segments created`);
            }
          }
        }

        intersectionPointsUsed++;
      }

      console.log(`✅ Intersection-based splitting completed:`);
      console.log(`   📍 Intersection points processed: ${intersectionPointsUsed}`);
      console.log(`   ✂️ Trails split: ${totalTrailsSplit}`);
      console.log(`   📊 Segments created: ${totalSegmentsCreated}`);

      return {
        success: true,
        trailsSplit: totalTrailsSplit,
        segmentsCreated: totalSegmentsCreated,
        intersectionPointsUsed
      };

    } catch (error) {
      console.error('❌ Error in intersection-based trail splitting:', error);
      return {
        success: false,
        trailsSplit: 0,
        segmentsCreated: 0,
        intersectionPointsUsed: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Split a single trail at a specific intersection point
   */
  private async splitTrailAtPoint(trail: any, intersectionPoint: any): Promise<{success: boolean, segmentsCreated: number}> {
    const { stagingSchema, pgClient, minSegmentLengthMeters } = this.config;

    try {
      // Split the trail geometry at the intersection point
      const splitResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
      `, [trail.geometry, intersectionPoint]);

      if (splitResult.rows.length <= 1) {
        // No splitting occurred (trail doesn't pass through the point or only one segment)
        return { success: false, segmentsCreated: 0 };
      }

      // Filter out segments that are too short
      const validSegments = [];
      for (const row of splitResult.rows) {
        const segment = row.segment;
        const lengthResult = await pgClient.query(`
          SELECT ST_Length($1::geography) as length_m
        `, [segment]);
        
        if (lengthResult.rows[0].length_m >= minSegmentLengthMeters) {
          validSegments.push({
            geometry: segment,
            length_m: lengthResult.rows[0].length_m
          });
        }
      }

      if (validSegments.length <= 1) {
        // No valid segments to create (all too short)
        return { success: false, segmentsCreated: 0 };
      }

      // Delete the original trail
      await pgClient.query(`
        DELETE FROM ${stagingSchema}.trails WHERE app_uuid = $1
      `, [trail.app_uuid]);

      // Insert the split segments
      for (let i = 0; i < validSegments.length; i++) {
        const segment = validSegments[i];
        await pgClient.query(`
          INSERT INTO ${stagingSchema}.trails (
            app_uuid, name, trail_type, surface, difficulty,
            geometry, length_km, elevation_gain, elevation_loss,
            max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            source, source_tags, osm_id
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4,
            ST_Force3D($5::geometry), $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18
          )
        `, [
          `${trail.name} Segment ${i + 1}`,
          trail.trail_type,
          trail.surface,
          trail.difficulty,
          segment.geometry,
          segment.length_m / 1000.0, // Convert to km
          trail.elevation_gain,
          trail.elevation_loss,
          trail.max_elevation,
          trail.min_elevation,
          trail.avg_elevation,
          trail.bbox_min_lng,
          trail.bbox_max_lng,
          trail.bbox_min_lat,
          trail.bbox_max_lat,
          trail.source,
          trail.source_tags,
          trail.osm_id
        ]);
      }

      return { success: true, segmentsCreated: validSegments.length };

    } catch (error) {
      console.error(`❌ Error splitting trail ${trail.name}:`, error);
      return { success: false, segmentsCreated: 0 };
    }
  }
}
