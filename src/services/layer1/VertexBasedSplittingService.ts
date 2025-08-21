import { Pool } from 'pg';

export interface VertexBasedSplittingResult {
  verticesExtracted: number;
  trailsSplit: number;
  segmentsCreated: number;
  duplicatesRemoved: number;
  finalSegments: number;
}

export class VertexBasedSplittingService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config: any
  ) {}

  /**
   * Apply vertex-based trail splitting to create a proper routing network
   * This extracts all vertices, splits trails at intersection points, and deduplicates segments
   */
  async applyVertexBasedSplitting(): Promise<VertexBasedSplittingResult> {
    console.log('🔗 Applying vertex-based trail splitting...');
    
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');
      
      // Step 1: Extract all vertices from trail geometries
      console.log('   📍 Step 1: Extracting all vertices from trail geometries...');
      
      // First check if we have trails to work with
      const trailCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL AND ST_IsValid(geometry)`);
      console.log(`   📊 Found ${trailCount.rows[0].count} valid trails to process`);
      
      if (trailCount.rows[0].count === 0) {
        throw new Error('No valid trails found in staging schema');
      }
      
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trail_vertices`);
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.trail_vertices AS
        WITH vertex_dump AS (
          SELECT 
            t.id as trail_id,
            t.app_uuid as trail_uuid,
            t.name as trail_name,
            (ST_DumpPoints(t.geometry)).geom as vertex_point,
            (ST_DumpPoints(t.geometry)).path[1] as vertex_order
          FROM ${this.stagingSchema}.trails t
          WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        )
        SELECT 
          trail_id,
          trail_uuid,
          trail_name,
          ST_Force2D(vertex_point) as vertex_point,
          vertex_order,
          ST_X(ST_Force2D(vertex_point)) as lng,
          ST_Y(ST_Force2D(vertex_point)) as lat
        FROM vertex_dump
        WHERE ST_GeometryType(vertex_point) = 'ST_Point'
      `);
      
      const verticesCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trail_vertices`);
      console.log(`   📍 Extracted ${verticesCount.rows[0].count} vertices`);
      
      // Step 2: Find intersection vertices (vertices that appear in multiple trails)
      console.log('   🔍 Step 2: Finding intersection vertices...');
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.intersection_vertices`);
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.intersection_vertices AS
        WITH vertex_clusters AS (
          SELECT 
            ST_SnapToGrid(vertex_point, 0.00001) as snapped_point,
            COUNT(DISTINCT trail_uuid) as trail_count,
            ARRAY_AGG(DISTINCT trail_uuid) as connected_trails,
            ARRAY_AGG(DISTINCT trail_name) as connected_names
          FROM ${this.stagingSchema}.trail_vertices
          GROUP BY ST_SnapToGrid(vertex_point, 0.00001)
          HAVING COUNT(DISTINCT trail_uuid) > 1
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          snapped_point as intersection_point,
          trail_count,
          connected_trails,
          connected_names
        FROM vertex_clusters
      `);
      
      const intersectionCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.intersection_vertices`);
      console.log(`   🔍 Found ${intersectionCount.rows[0].count} intersection vertices`);
      
      // Step 3: Split trails at all intersection vertices
      console.log('   ✂️ Step 3: Splitting trails at intersection vertices...');
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.split_trail_segments`);
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.split_trail_segments AS
        WITH trail_intersections AS (
          SELECT 
            t.id as trail_id,
            t.app_uuid as trail_uuid,
            t.name as trail_name,
            t.trail_type,
            t.surface,
            t.difficulty,
            t.elevation_gain,
            t.elevation_loss,
            t.max_elevation,
            t.min_elevation,
            t.avg_elevation,
            t.source,
            t.source_tags,
            t.osm_id,
            t.bbox_min_lng,
            t.bbox_max_lng,
            t.bbox_min_lat,
            t.bbox_max_lat,
            t.geometry,
            iv.intersection_point
          FROM ${this.stagingSchema}.trails t
          CROSS JOIN ${this.stagingSchema}.intersection_vertices iv
          WHERE ST_DWithin(t.geometry, iv.intersection_point, 0.001)
            AND ST_Length(t.geometry::geography) > 50  -- Minimum trail length
        ),
        split_segments AS (
          SELECT 
            trail_id,
            trail_uuid,
            trail_name,
            trail_type,
            surface,
            difficulty,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            source_tags,
            osm_id,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            (ST_Dump(ST_Split(geometry, intersection_point))).geom as segment_geometry,
            (ST_Dump(ST_Split(geometry, intersection_point))).path[1] as segment_order
          FROM trail_intersections
        ),
        valid_segments AS (
          SELECT *
          FROM split_segments
          WHERE ST_GeometryType(segment_geometry) = 'ST_LineString'
            AND ST_Length(segment_geometry::geography) > 50  -- Minimum segment length
            AND ST_NumPoints(segment_geometry) > 1
        )
        SELECT 
          ROW_NUMBER() OVER () as id,
          trail_id,
          trail_uuid as original_trail_uuid,
          trail_name,
          trail_type,
          surface,
          difficulty,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          source,
          source_tags,
          osm_id,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          segment_geometry as geometry,
          ST_Length(segment_geometry::geography) / 1000.0 as length_km,
          segment_order
        FROM valid_segments
      `);
      
      const segmentsCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trail_segments`);
      console.log(`   ✂️ Created ${segmentsCount.rows[0].count} split segments`);
      
      // Step 4: Add trails that don't have intersections (keep original geometry)
      console.log('   ➕ Step 4: Adding trails without intersections...');
      await client.query(`
        INSERT INTO ${this.stagingSchema}.split_trail_segments (
          trail_id, original_trail_uuid, trail_name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry, length_km, segment_order
        )
        SELECT 
          t.id as trail_id,
          t.app_uuid as original_trail_uuid,
          t.name as trail_name,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          t.source,
          t.source_tags,
          t.osm_id,
          t.bbox_min_lng,
          t.bbox_max_lng,
          t.bbox_min_lat,
          t.bbox_max_lat,
          t.geometry,
          t.length_km,
          1 as segment_order
        FROM ${this.stagingSchema}.trails t
        WHERE t.app_uuid NOT IN (
          SELECT DISTINCT original_trail_uuid FROM ${this.stagingSchema}.split_trail_segments
        )
        AND ST_Length(t.geometry::geography) > 50
      `);
      
      const totalSegments = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trail_segments`);
      console.log(`   ➕ Total segments after adding non-intersecting trails: ${totalSegments.rows[0].count}`);
      
      // Step 5: Deduplicate segments by geometry
      console.log('   🔄 Step 5: Deduplicating segments by geometry...');
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.deduplicated_segments`);
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.deduplicated_segments AS
        SELECT DISTINCT ON (ST_AsText(geometry)) 
          id,
          trail_id,
          original_trail_uuid,
          trail_name,
          trail_type,
          surface,
          difficulty,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          source,
          source_tags,
          osm_id,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          geometry,
          length_km,
          segment_order
        FROM ${this.stagingSchema}.split_trail_segments
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ORDER BY ST_AsText(geometry), id
      `);
      
      const deduplicatedCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.deduplicated_segments`);
      const duplicatesRemoved = totalSegments.rows[0].count - deduplicatedCount.rows[0].count;
      console.log(`   🔄 Removed ${duplicatesRemoved} duplicate segments`);
      
      // Step 6: Replace original trails table with split and deduplicated segments
      console.log('   🔄 Step 6: Replacing original trails with split segments...');
      await client.query(`DELETE FROM ${this.stagingSchema}.trails`);
      await client.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          id, app_uuid, original_trail_uuid, osm_id, name, trail_type, surface, difficulty,
          source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, geometry
        )
        SELECT 
          id,
          gen_random_uuid()::uuid as app_uuid,
          original_trail_uuid,
          osm_id,
          CASE 
            WHEN segment_order = 1 THEN trail_name
            ELSE trail_name || ' (Segment ' || segment_order || ')'
          END as name,
          trail_type,
          surface,
          difficulty,
          source_tags,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          source,
          geometry
        FROM ${this.stagingSchema}.deduplicated_segments
      `);
      
      const finalCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
      console.log(`   🔄 Final trail count: ${finalCount.rows[0].count}`);
      
      // Step 7: Create spatial indexes for performance
      console.log('   📍 Step 7: Creating spatial indexes...');
      await client.query(`CREATE INDEX IF NOT EXISTS idx_trails_geometry_vertex_split ON ${this.stagingSchema}.trails USING GIST(geometry)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_trails_app_uuid_vertex_split ON ${this.stagingSchema}.trails(app_uuid)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_intersection_vertices ON ${this.stagingSchema}.intersection_vertices USING GIST(intersection_point)`);
      
      // Commit the transaction
      await client.query('COMMIT');
      
      return {
        verticesExtracted: verticesCount.rows[0].count,
        trailsSplit: intersectionCount.rows[0].count,
        segmentsCreated: segmentsCount.rows[0].count,
        duplicatesRemoved,
        finalSegments: finalCount.rows[0].count
      };
      
    } catch (error) {
      // Rollback on error
      await client.query('ROLLBACK');
      console.error('❌ Error in vertex-based splitting:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}
