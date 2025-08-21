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
            'cross' as intersection_type
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t1.geometry::geography) > $1
            AND ST_Length(t2.geometry::geography) > $1
          
          UNION ALL
          
          -- Self-intersections (loops)
          SELECT DISTINCT
            t.app_uuid as trail1_uuid,
            t.app_uuid as trail2_uuid,
            ST_Intersection(t.geometry, t.geometry) as intersection_point,
            'self' as intersection_type
          FROM ${this.stagingSchema}.trails t
          WHERE NOT ST_IsSimple(t.geometry)
            AND ST_GeometryType(ST_Intersection(t.geometry, t.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t.geometry::geography) > $1
        )
        SELECT 
          trail1_uuid,
          trail2_uuid,
          ST_AsText(intersection_point) as intersection_text,
          ST_GeometryType(intersection_point) as intersection_type,
          intersection_type as intersection_category
        FROM trail_intersections
        ORDER BY trail1_uuid, trail2_uuid
      `, [minLength]);

      result.intersectionPairsFound = intersectionResult.rows.length;
      console.log(`   ✅ Found ${result.intersectionPairsFound} trail intersection pairs`);

      if (result.intersectionPairsFound === 0) {
        console.log('   ℹ️ No intersections found, skipping splitting');
        return result;
      }

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
          
          UNION ALL
          
          -- Self-intersections (loops)
          SELECT DISTINCT
            t.app_uuid as trail1_uuid,
            t.app_uuid as trail2_uuid,
            ST_Intersection(t.geometry, t.geometry) as intersection_point,
            'self' as intersection_type
          FROM ${this.stagingSchema}.trails t
          WHERE NOT ST_IsSimple(t.geometry)
            AND ST_GeometryType(ST_Intersection(t.geometry, t.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t.geometry::geography) > $1
        ),
        split_trails AS (
          SELECT
            t.id, t.app_uuid, t.name, t.geometry,
            t.trail_type, t.surface, t.difficulty,
            t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
            t.source, t.source_tags, t.osm_id,
            t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
            (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
            (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order,
            ti.intersection_type
          FROM ${this.stagingSchema}.trails t
          JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
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

      // Step 4: Replace original trails with split segments
      console.log('   🔄 Replacing original trails with split segments...');
      
      // Delete original trails that were split
      const trailsToDelete = await this.pgClient.query(`
        SELECT DISTINCT t.app_uuid
        FROM ${this.stagingSchema}.trails t
        JOIN (
          -- Cross-intersections between different trails
          SELECT DISTINCT
            t1.app_uuid as trail1_uuid,
            t2.app_uuid as trail2_uuid
          FROM ${this.stagingSchema}.trails t1
          JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t1.geometry::geography) > $1
            AND ST_Length(t2.geometry::geography) > $1
          
          UNION
          
          -- Self-intersecting trails (loops)
          SELECT DISTINCT
            t.app_uuid as trail1_uuid,
            t.app_uuid as trail2_uuid
          FROM ${this.stagingSchema}.trails t
          WHERE NOT ST_IsSimple(t.geometry)
            AND ST_GeometryType(ST_Intersection(t.geometry, t.geometry)) IN ('ST_Point', 'ST_MultiPoint')
            AND ST_Length(t.geometry::geography) > $1
        ) intersections ON t.app_uuid IN (intersections.trail1_uuid, intersections.trail2_uuid)
      `, [minLength]);

      const trailsToDeleteUuids = trailsToDelete.rows.map(row => row.app_uuid);
      result.trailsProcessed = trailsToDeleteUuids.length;

      if (trailsToDeleteUuids.length > 0) {
        await this.pgClient.query(`
          DELETE FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = ANY($1)
        `, [trailsToDeleteUuids]);
        console.log(`   🗑️ Deleted ${trailsToDeleteUuids.length} original trails that were split`);
      }

      // Insert split segments
      for (const row of splitResult.rows) {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, trail_type, surface, difficulty,
            elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            geometry
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
          )
        `, [
          row.app_uuid,
          row.segment_order === 1 ? row.name : `${row.name} (Segment ${row.segment_order})`,
          row.trail_type, row.surface, row.difficulty,
          row.elevation_gain, row.elevation_loss, row.max_elevation, row.min_elevation, row.avg_elevation,
          row.source, row.source_tags, row.osm_id,
          row.bbox_min_lng, row.bbox_max_lng, row.bbox_min_lat, row.bbox_max_lat,
          JSON.stringify(row.geometry)
        ]);
      }

      console.log(`   ✅ Inserted ${splitResult.rows.length} split segments`);

      // Step 5: Show summary
      const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      console.log(`   📊 Final trail count: ${finalCount.rows[0].count}`);

      console.log(`✅ ST_Split Double Intersection Service complete:`);
      console.log(`   - Processed ${result.trailsProcessed} trails`);
      console.log(`   - Found ${result.intersectionPairsFound} intersection pairs`);
      console.log(`   - Created ${result.segmentsCreated} segments`);

      return result;

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
