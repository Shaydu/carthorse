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
   * This splits trails at their actual intersection points rather than arbitrary intervals
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
        intersectionsFound: 0
      };
    }

    // Step 2: Create backup of original trails
    console.log('   💾 Creating backup of original trails...');
    await this.pgClient.query(`
      CREATE TEMP TABLE enhanced_split_backup AS
      SELECT * FROM ${this.stagingSchema}.trails
    `);

    // Step 3: Apply enhanced splitting
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
          t.id, t.app_uuid, t.name, t.trail_type, t.surface, t.difficulty,
          t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
          t.source, t.source_tags, t.osm_id, t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
          t.geometry,
          (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
          (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order
        FROM ${this.stagingSchema}.trails t
        JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
      )
      SELECT 
        id, app_uuid, name, trail_type, surface, difficulty,
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

    // Step 4: Replace original trails with split segments
    console.log('   🔄 Replacing original trails with split segments...');
    
    // Clear original trails
    await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.trails`);
    
    // Insert split segments
    for (const row of splitResult.rows) {
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 
          ST_XMin($14), ST_XMax($14), ST_YMin($14), ST_YMax($14), $14
        )
      `, [
        row.app_uuid,
        row.segment_order === 1 ? row.name : `${row.name} (Segment ${row.segment_order})`,
        row.trail_type, row.surface, row.difficulty,
        row.elevation_gain, row.elevation_loss, row.max_elevation, row.min_elevation, row.avg_elevation,
        row.source, row.source_tags, row.osm_id,
        row.split_geometry
      ]);
    }

    // Step 5: Add back trails that weren't involved in intersections
    console.log('   🔄 Adding back trails without intersections...');
    const nonIntersectingResult = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, name, trail_type, surface, difficulty,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        geometry
      )
      SELECT 
        t.app_uuid, t.name, t.trail_type, t.surface, t.difficulty,
        t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
        t.source, t.source_tags, t.osm_id, t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
        t.geometry
      FROM enhanced_split_backup t
      WHERE NOT EXISTS (
        SELECT 1 FROM enhanced_split_backup t2
        WHERE t2.id != t.id
          AND ST_Intersects(t.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      )
    `, [minLength]);

    const trailsProcessed = nonIntersectingResult.rowCount || 0;
    console.log(`   ✅ Added back ${trailsProcessed} trails without intersections`);

    // Step 6: Show summary
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    console.log(`   📊 Final trail count: ${finalCount.rows[0].count}`);

    console.log('   ✅ Enhanced intersection splitting complete');

    return {
      trailsProcessed: trailsProcessed,
      segmentsCreated: segmentsCreated,
      intersectionsFound: intersectionsFound
    };
  }
}
