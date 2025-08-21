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
   */
  async splitTrailsAtIntersections(): Promise<STSplitDoubleIntersectionResult> {
    const result: STSplitDoubleIntersectionResult = {
      trailsProcessed: 0,
      intersectionPairsFound: 0,
      segmentsCreated: 0
    };

    try {
      const minLength = this.config.minTrailLengthMeters || 5.0;
      
      console.log('   🔍 Finding trail intersections...');
      
      // Step 1: Find intersection pairs
      const intersectionResult = await this.pgClient.query(`
        SELECT COUNT(*) as count
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      `, [minLength]);

      result.intersectionPairsFound = parseInt(intersectionResult.rows[0].count);
      console.log(`   ✅ Found ${result.intersectionPairsFound} trail intersection pairs`);

      if (result.intersectionPairsFound === 0) {
        console.log('   ⏭️ No intersections found, skipping splitting');
        return result;
      }

      // Start transaction for atomic operations
      await this.pgClient.query('BEGIN');
      console.log('   🔒 Started database transaction');

      try {
        // Step 2: Create backup of original trails
        console.log('   💾 Creating backup of original trails...');
        await this.pgClient.query(`
          CREATE TEMP TABLE trails_before_splitting AS 
          SELECT * FROM ${this.stagingSchema}.trails
        `);

        // Step 3: Split trails at intersection points
        console.log('   ✂️ Splitting trails at intersection points...');
        const splitResult = await this.pgClient.query(`
          WITH trail_intersections AS (
            -- Intersections between different trails
            SELECT DISTINCT
              t1.app_uuid as trail1_uuid,
              t2.app_uuid as trail2_uuid,
              ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
              'cross' as intersection_type
            FROM ${this.stagingSchema}.trails t1
            JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
              AND ST_Length(t1.geometry::geography) > $1
              AND ST_Length(t2.geometry::geography) > $1
          ),
          cross_split_trails AS (
            -- Split trails at cross-intersections
            SELECT
              t.id, t.app_uuid, t.name, t.geometry,
              t.trail_type, t.surface, t.difficulty,
              t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
              t.source, t.source_tags, t.osm_id,
              t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
              (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
              (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order,
              'cross' as intersection_type
            FROM ${this.stagingSchema}.trails t
            JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
          ),
          self_split_trails AS (
            -- Split self-intersecting loops into 2 segments using ST_LineSubstring
            SELECT
              t.id, t.app_uuid, t.name, t.geometry,
              t.trail_type, t.surface, t.difficulty,
              t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
              t.source, t.source_tags, t.osm_id,
              t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
              ST_LineSubstring(t.geometry, 
                CASE 
                  WHEN generate_series = 1 THEN 0.0
                  WHEN generate_series = 2 THEN 0.5
                END,
                CASE 
                  WHEN generate_series = 1 THEN 0.5
                  WHEN generate_series = 2 THEN 1.0
                END
              ) as split_geometry,
              generate_series as segment_order,
              'self' as intersection_type
            FROM ${this.stagingSchema}.trails t
            CROSS JOIN generate_series(1, 2)
            WHERE NOT ST_IsSimple(t.geometry)
              AND ST_Length(t.geometry::geography) > $1
          ),
          split_trails AS (
            SELECT * FROM cross_split_trails
            UNION ALL
            SELECT * FROM self_split_trails
          )
          SELECT 
            id, app_uuid, name, segment_order,
            trail_type, surface, difficulty,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            source, source_tags, osm_id,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            ST_GeometryType(split_geometry) as geometry_type,
            ST_Length(split_geometry::geography) as length_meters,
            ST_AsGeoJSON(split_geometry)::json as geometry,
            intersection_type
          FROM split_trails
          WHERE ST_GeometryType(split_geometry) = 'ST_LineString'
            AND ST_Length(split_geometry::geography) > $1
          ORDER BY name, segment_order
        `, [minLength]);

        result.segmentsCreated = splitResult.rows.length;
        console.log(`   ✅ Created ${result.segmentsCreated} segments from splitting`);

        // Step 4: Insert split segments with new UUIDs and original_trail_uuid tracking
        console.log('   🔄 Inserting split segments...');
        for (const row of splitResult.rows) {
          await this.pgClient.query(`
            INSERT INTO ${this.stagingSchema}.trails (
              app_uuid, name, trail_type, surface, difficulty,
              elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
              source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
              geometry, original_trail_uuid
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
            )
          `, [
            row.segment_order === 1 ? row.name : `${row.name} (Segment ${row.segment_order})`,
            row.trail_type, row.surface, row.difficulty,
            row.elevation_gain, row.elevation_loss, row.max_elevation, row.min_elevation, row.avg_elevation,
            row.source, row.source_tags, row.osm_id,
            row.bbox_min_lng, row.bbox_max_lng, row.bbox_min_lat, row.bbox_max_lat,
            JSON.stringify(row.geometry),
            row.app_uuid // Store the original trail's UUID
          ]);
        }

        console.log(`   ✅ Inserted ${splitResult.rows.length} split segments`);

        // Step 5: Delete original trails that were split (whose UUIDs are now in original_trail_uuid)
        console.log('   🗑️ Deleting original trails that were split...');
        const trailsToDelete = await this.pgClient.query(`
          SELECT DISTINCT t.app_uuid
          FROM ${this.stagingSchema}.trails t
          WHERE t.app_uuid IN (
            SELECT DISTINCT original_trail_uuid 
            FROM ${this.stagingSchema}.trails 
            WHERE original_trail_uuid IS NOT NULL
          )
        `);

        const trailsToDeleteUuids = trailsToDelete.rows.map(row => row.app_uuid);
        result.trailsProcessed = trailsToDeleteUuids.length;

        if (trailsToDeleteUuids.length > 0) {
          await this.pgClient.query(`
            DELETE FROM ${this.stagingSchema}.trails 
            WHERE app_uuid = ANY($1)
          `, [trailsToDeleteUuids]);
          console.log(`   🗑️ Deleted ${trailsToDeleteUuids.length} original trails that were split`);
        }

                 // Step 6: Clean up truly overlapping/duplicate geometries (very conservative)
         console.log('   🧹 Cleaning up duplicate geometries...');
         const cleanupResult = await this.pgClient.query(`
           WITH exact_duplicates AS (
             SELECT DISTINCT
               t1.id as id1, t1.app_uuid as uuid1, t1.name as name1, 
               ST_Length(t1.geometry::geography) as length1,
               t2.id as id2, t2.app_uuid as uuid2, t2.name as name2,
               ST_Length(t2.geometry::geography) as length2
             FROM ${this.stagingSchema}.trails t1
             JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
             WHERE ST_Equals(t1.geometry, t2.geometry)
               AND t1.name = t2.name
               AND ABS(ST_Length(t1.geometry::geography) - ST_Length(t2.geometry::geography)) < 1.0
           ),
           to_delete AS (
             SELECT 
               CASE 
                 WHEN length1 < length2 THEN uuid1
                 ELSE uuid2
               END as uuid_to_delete,
               CASE 
                 WHEN length1 < length2 THEN name1
                 ELSE name2
               END as name_to_delete,
               CASE 
                 WHEN length1 < length2 THEN length1
                 ELSE length2
               END as length_to_delete
             FROM exact_duplicates
           )
           SELECT uuid_to_delete, name_to_delete, length_to_delete
           FROM to_delete
         `);

        if (cleanupResult.rows.length > 0) {
          const uuidsToDelete = cleanupResult.rows.map(row => row.uuid_to_delete);
          await this.pgClient.query(`
            DELETE FROM ${this.stagingSchema}.trails 
            WHERE app_uuid = ANY($1)
          `, [uuidsToDelete]);
          console.log(`   🧹 Deleted ${cleanupResult.rows.length} overlapping trails (kept shorter ones)`);
          
          // Log details of what was deleted
          for (const row of cleanupResult.rows) {
            console.log(`     - Deleted: ${row.name_to_delete} (${row.length_to_delete.toFixed(1)}m)`);
          }
        } else {
          console.log('   ✅ No overlapping geometries found');
        }

        // Commit transaction
        await this.pgClient.query('COMMIT');
        console.log('   ✅ Transaction committed successfully');

        // Step 7: Show summary
        const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
        console.log(`   📊 Final trail count: ${finalCount.rows[0].count}`);

        console.log(`✅ ST_Split Double Intersection Service complete:`);
        console.log(`   - Processed ${result.trailsProcessed} trails`);
        console.log(`   - Found ${result.intersectionPairsFound} intersection pairs`);
        console.log(`   - Created ${result.segmentsCreated} segments`);
        console.log(`   - Cleaned up ${cleanupResult.rows.length} overlapping geometries`);

        return result;

      } catch (error) {
        // Rollback transaction on error
        await this.pgClient.query('ROLLBACK');
        console.error('   ❌ Transaction rolled back due to error');
        throw error;
      }

    } catch (error) {
      console.error('❌ Error in ST_Split Double Intersection Service:', error);
      throw error;
    }
  }

  /**
   * Get detailed information about intersections for debugging
   */
  async getIntersectionDetails(): Promise<any[]> {
    const minLength = this.config.minTrailLengthMeters || 5.0;
    
    const result = await this.pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_Length(t1.geometry::geography) as trail1_length,
        ST_Length(t2.geometry::geography) as trail2_length
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > $1
        AND ST_Length(t2.geometry::geography) > $1
      ORDER BY t1.name, t2.name
    `, [minLength]);

    return result.rows;
  }
}
