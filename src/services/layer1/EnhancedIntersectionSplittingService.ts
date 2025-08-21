import { Pool } from 'pg';

export interface EnhancedIntersectionSplittingConfig {
  stagingSchema: string;
  pgClient: Pool;
  minTrailLengthMeters?: number;
}

export interface EnhancedIntersectionSplittingResult {
  trailsProcessed: number;
  segmentsCreated: number;
  intersectionsFound: number;
  originalTrailsDeleted: number;
}

export class EnhancedIntersectionSplittingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: EnhancedIntersectionSplittingConfig;

  constructor(config: EnhancedIntersectionSplittingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
  }

  /**
   * Apply enhanced intersection splitting to trails
   * This splits trails at their actual intersection points and properly deletes unsplit versions
   */
  async applyEnhancedIntersectionSplitting(): Promise<EnhancedIntersectionSplittingResult> {
    console.log('🔗 Applying enhanced intersection splitting...');
    
    const minLength = this.config.minTrailLengthMeters || 5.0;
    
    // Step 1: Find all trail intersections
    console.log('   🔍 Finding trail intersections...');
    const intersectionResult = await this.pgClient.query(`
      WITH trail_intersections AS (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_point
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      )
      SELECT COUNT(*) as intersection_count
      FROM trail_intersections
    `, [minLength]);
    
    const intersectionsFound = parseInt(intersectionResult.rows[0].intersection_count);
    console.log(`   📊 Found ${intersectionsFound} trail intersections`);
    
    if (intersectionsFound === 0) {
      console.log('   ✅ No intersections found, skipping enhanced splitting');
      return {
        trailsProcessed: 0,
        segmentsCreated: 0,
        intersectionsFound: 0,
        originalTrailsDeleted: 0
      };
    }

    // Step 2: Create backup of original trails and identify which ones will be split
    console.log('   💾 Creating backup and identifying trails to split...');
    await this.pgClient.query(`
      CREATE TEMP TABLE enhanced_split_backup AS
      SELECT * FROM ${this.stagingSchema}.trails
    `);

    // Create a table to track which trails were split
    await this.pgClient.query(`
      CREATE TEMP TABLE trails_to_split AS
      SELECT DISTINCT t.app_uuid
      FROM ${this.stagingSchema}.trails t
      JOIN (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      ) intersections ON t.app_uuid IN (intersections.trail1_uuid, intersections.trail2_uuid)
    `, [minLength]);

    // Step 3: Apply enhanced splitting and track original trail UUIDs
    console.log('   🔧 Applying enhanced intersection splitting...');
    const splitResult = await this.pgClient.query(`
      WITH trail_intersections AS (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_point
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      ),
      split_trails AS (
        SELECT
          t.id, t.app_uuid as original_trail_uuid, t.name, t.trail_type, t.surface, t.difficulty,
          t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
          t.source, t.source_tags, t.osm_id, t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
          t.geometry,
          (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
          (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order
        FROM ${this.stagingSchema}.trails t
        JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
      )
      SELECT 
        id, original_trail_uuid, name, trail_type, surface, difficulty,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        segment_order,
        ST_GeometryType(split_geometry) as geometry_type,
        ST_Length(split_geometry::geography) as length_meters,
        split_geometry
      FROM split_trails
      WHERE ST_GeometryType(split_geometry) = 'ST_LineString'
        AND ST_Length(split_geometry::geography) > $1
      ORDER BY name, segment_order
    `, [minLength]);

    const segmentsCreated = splitResult.rows.length;
    console.log(`   📊 Created ${segmentsCreated} segments from intersection splitting`);

    // Step 4: Delete only the original trails that were split
    console.log('   🗑️ Deleting original trails that were split...');
    const deleteResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails
      WHERE app_uuid IN (SELECT app_uuid FROM trails_to_split)
    `);
    
    const originalTrailsDeleted = deleteResult.rowCount || 0;
    console.log(`   🗑️ Deleted ${originalTrailsDeleted} original trails that were split`);

    // Step 5: Insert split segments with new UUIDs and original_trail_uuid reference
    console.log('   ➕ Inserting split segments...');
    for (const row of splitResult.rows) {
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 
          ST_XMin($14), ST_XMax($14), ST_YMin($14), ST_YMax($14), $14
        )
      `, [
        row.original_trail_uuid, // Store reference to original trail
        row.segment_order === 1 ? row.name : `${row.name} (Segment ${row.segment_order})`,
        row.trail_type, row.surface, row.difficulty,
        row.elevation_gain, row.elevation_loss, row.max_elevation, row.min_elevation, row.avg_elevation,
        row.source, row.source_tags, row.osm_id,
        row.split_geometry
      ]);
    }

    // Step 6: Show summary
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    console.log(`   📊 Final trail count: ${finalCount.rows[0].count}`);

    console.log('   ✅ Enhanced intersection splitting complete');

    return {
      trailsProcessed: segmentsCreated,
      segmentsCreated: segmentsCreated,
      intersectionsFound: intersectionsFound,
      originalTrailsDeleted: originalTrailsDeleted
    };
  }
}
