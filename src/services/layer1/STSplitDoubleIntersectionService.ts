import { Pool } from 'pg';

export interface STSplitDoubleIntersectionConfig {
  stagingSchema: string;
  pgClient: Pool;
  minTrailLengthMeters?: number;
}

export interface STSplitDoubleIntersectionResult {
  trailsProcessed: number;
  segmentsCreated: number;
  intersectionPairsFound: number;
}

export class STSplitDoubleIntersectionService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: STSplitDoubleIntersectionConfig;

  constructor(config: STSplitDoubleIntersectionConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
  }

  /**
   * Split trails at their intersection points using ST_Split
   * This creates proper network topology by splitting trails exactly where they intersect
   * Retains self-intersecting loops by not deleting the original trail
   */
  async splitTrailsAtIntersections(): Promise<STSplitDoubleIntersectionResult> {
    console.log('🔗 ST_Split Double Intersection Service: Splitting trails at intersection points...');
    
    const result: STSplitDoubleIntersectionResult = {
      trailsProcessed: 0,
      segmentsCreated: 0,
      intersectionPairsFound: 0
    };

    const minLength = this.config.minTrailLengthMeters || 5.0;

    try {
      // Step 1: Find all trail intersections (both between trails and self-intersections)
      console.log('   🔍 Finding trail intersections...');
      const intersectionResult = await this.pgClient.query(`
        WITH trail_intersections AS (
          -- Intersections between different trails
          SELECT DISTINCT
            t1.app_uuid as trail1_uuid,
            t2.app_uuid as trail2_uuid,
            ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
            ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_text
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND NOT ST_Touches(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
        ),
        self_intersections AS (
          -- Self-intersections within trails (loops)
          SELECT DISTINCT
            t.app_uuid as trail_uuid,
            ST_Intersection(t.geometry, t.geometry) as intersection_point,
            ST_AsText(ST_Intersection(t.geometry, t.geometry)) as intersection_text
          FROM ${this.stagingSchema}.trails t
          WHERE ST_IsSimple(t.geometry) = false
            AND ST_GeometryType(ST_Intersection(t.geometry, t.geometry)) = 'ST_Point'
        )
        SELECT 
          'cross' as intersection_type,
          trail1_uuid as trail_uuid,
          intersection_point,
          intersection_text
        FROM trail_intersections
        UNION ALL
        SELECT 
          'self' as intersection_type,
          trail_uuid,
          intersection_point,
          intersection_text
        FROM self_intersections
        ORDER BY trail_uuid, intersection_text
      `);

      const intersections = intersectionResult.rows;
      console.log(`   📊 Found ${intersections.length} intersection points`);

      // Step 2: Split trails at intersection points
      for (const intersection of intersections) {
        try {
          const splitResult = await this.pgClient.query(`
            WITH trail_to_split AS (
              SELECT 
                app_uuid,
                name,
                geometry,
                source,
                elevation_gain,
                elevation_loss,
                difficulty,
                surface_type,
                trail_type,
                created_at,
                updated_at
              FROM ${this.stagingSchema}.trails 
              WHERE app_uuid = $1
            ),
            split_segments AS (
              SELECT 
                app_uuid,
                name,
                (ST_Dump(ST_Split(geometry, $2::geometry))).geom as segment_geometry,
                source,
                elevation_gain,
                elevation_loss,
                difficulty,
                surface_type,
                trail_type,
                created_at,
                updated_at
              FROM trail_to_split
            )
            INSERT INTO ${this.stagingSchema}.trails (
              app_uuid, name, geometry, source, elevation_gain, elevation_loss, 
              difficulty, surface_type, trail_type, created_at, updated_at
            )
            SELECT 
              app_uuid || '-split-' || generate_series(1, 1000) as app_uuid,
              name || ' (split)' as name,
              segment_geometry as geometry,
              source,
              elevation_gain,
              elevation_loss,
              difficulty,
              surface_type,
              trail_type,
              created_at,
              updated_at
            FROM split_segments
            WHERE ST_Length(segment_geometry::geography) >= $3
            AND ST_GeometryType(segment_geometry) = 'ST_LineString'
          `, [intersection.trail_uuid, intersection.intersection_text, minLength]);

          result.segmentsCreated += splitResult.rowCount || 0;
          result.trailsProcessed++;
          
          console.log(`   ✅ Split trail ${intersection.trail_uuid} at ${intersection.intersection_text} (${splitResult.rowCount || 0} segments)`);
        } catch (error) {
          console.warn(`   ⚠️ Failed to split trail ${intersection.trail_uuid}:`, error instanceof Error ? error.message : String(error));
        }
      }

      result.intersectionPairsFound = intersections.length;
      console.log(`✅ ST_Split Double Intersection Service completed:`);
      console.log(`   📊 Trails processed: ${result.trailsProcessed}`);
      console.log(`   📊 Segments created: ${result.segmentsCreated}`);
      console.log(`   📊 Intersection pairs found: ${result.intersectionPairsFound}`);

      return result;
    } catch (error) {
      console.error('❌ ST_Split Double Intersection Service failed:', error);
      throw error;
    }
  }
}
