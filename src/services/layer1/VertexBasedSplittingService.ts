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
   * Apply node-based trail splitting to create a proper routing network
   * This splits trails at ALL intersection nodes with exactly 1 split per node location
   */
  async applyVertexBasedSplitting(): Promise<VertexBasedSplittingResult> {
    console.log('🔗 Applying node-based trail splitting...');
    
    const client = await this.pgClient.connect();
    
    try {
      await client.query('BEGIN');
      
      // Step 1: Check if trails are already split to avoid oversplitting
      console.log('   🔍 Step 1: Checking if trails are already split...');
      const existingSplitCheck = await client.query(`
        SELECT COUNT(*) as split_count
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.original_trail_uuid = t2.original_trail_uuid
        WHERE t1.id != t2.id AND t1.original_trail_uuid IS NOT NULL
        LIMIT 1
      `);
      
      if (existingSplitCheck.rows[0].split_count > 0) {
        console.log('   ⚠️ Trails appear to already be split, skipping splitting process');
        return {
          verticesExtracted: 0,
          trailsSplit: 0,
          segmentsCreated: 0,
          duplicatesRemoved: 0,
          finalSegments: 0
        };
      }
      
      // Step 2: Create intersection nodes from trail crossings
      console.log('   📍 Step 2: Creating intersection nodes from trail crossings...');
      
      // First check if we have trails to work with
      const trailCount = await client.query(`
        SELECT COUNT(*) as count 
        FROM ${this.stagingSchema}.trails 
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      `);
      console.log(`   📊 Found ${trailCount.rows[0].count} valid trails to process`);
      
      if (trailCount.rows[0].count === 0) {
        throw new Error('No valid trails found in staging schema');
      }
      
      // Create intersection nodes using native pgRouting pgr_extractvertices
      console.log('   📍 Step 2: Creating intersection nodes using native pgRouting pgr_extractvertices...');
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.intersection_nodes`);
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.intersection_nodes AS
        SELECT 
          id as node_id,
          geom as node_geometry,
          x,
          y,
          in_edges,
          out_edges
        FROM pgr_extractvertices('SELECT id, geometry as geom FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL')
      `);
      
      const nodeCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.intersection_nodes`);
      console.log(`   📍 Created ${nodeCount.rows[0].count} intersection nodes`);
      
      // Step 3: Snap nodes to trails for clean splits
      console.log('   🔗 Step 3: Snapping nodes to trails...');
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.snapped_nodes`);
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.snapped_nodes AS
        SELECT 
          n.node_id,
          n.node_geometry,
          -- Snap the node to the closest point on each trail it intersects
          ST_ClosestPoint(t.geometry, n.node_geometry) as snapped_geometry,
          t.id as trail_id,
          t.app_uuid as trail_uuid,
          t.name as trail_name,
          ST_LineLocatePoint(t.geometry, n.node_geometry) as location_ratio
        FROM ${this.stagingSchema}.intersection_nodes n
        JOIN ${this.stagingSchema}.trails t ON ST_DWithin(t.geometry, n.node_geometry, 0.00001)
        WHERE ST_Length(t.geometry::geography) > 5.0
        ORDER BY n.node_id, location_ratio
      `);
      
      const snappedCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.snapped_nodes`);
      console.log(`   🔗 Created ${snappedCount.rows[0].count} snapped node-trail relationships`);
      
      // Step 4: Split trails at snapped nodes (ensuring exactly 1 split per node location)
      console.log('   ✂️ Step 4: Splitting trails at snapped nodes...');
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.split_trail_segments`);
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.split_trail_segments AS
        WITH trail_splits AS (
          SELECT 
            t.id as original_trail_id,
            t.app_uuid as original_trail_uuid,
            t.name as original_trail_name,
            t.geometry as original_geometry,
            t.length_km,
            t.elevation_gain,
            t.elevation_loss,
            t.trail_type,
            t.surface,
            t.difficulty,
            t.source,
            -- Collect all snapped nodes for this trail, ordered by position
            ARRAY_AGG(sn.snapped_geometry ORDER BY sn.location_ratio) as split_points
          FROM ${this.stagingSchema}.trails t
          LEFT JOIN ${this.stagingSchema}.snapped_nodes sn ON t.id = sn.trail_id
          WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
            AND ST_Length(t.geometry::geography) > 5.0
          GROUP BY t.id, t.app_uuid, t.name, t.geometry, t.length_km, t.elevation_gain, t.elevation_loss, t.trail_type, t.surface, t.difficulty, t.source
        ),
        -- First handle trails that need to be split
        split_segments AS (
          SELECT 
            ts.original_trail_id,
            ts.original_trail_uuid,
            ts.original_trail_name,
            ts.length_km,
            ts.elevation_gain,
            ts.elevation_loss,
            ts.trail_type,
            ts.surface,
            ts.difficulty,
            ts.source,
            (ST_Dump(ST_Split(ts.original_geometry, ST_Union(ts.split_points)))).geom as geometry
          FROM trail_splits ts
          WHERE array_length(ts.split_points, 1) IS NOT NULL AND array_length(ts.split_points, 1) > 0
        ),
        -- Then handle trails that don't need splitting
        unsplit_trails AS (
          SELECT 
            ts.original_trail_id,
            ts.original_trail_uuid,
            ts.original_trail_name,
            ts.length_km,
            ts.elevation_gain,
            ts.elevation_loss,
            ts.trail_type,
            ts.surface,
            ts.difficulty,
            ts.source,
            ts.original_geometry as geometry
          FROM trail_splits ts
          WHERE array_length(ts.split_points, 1) IS NULL OR array_length(ts.split_points, 1) = 0
        )
        -- Combine both split and unsplit trails
        SELECT 
          original_trail_id,
          original_trail_uuid,
          original_trail_name,
          geometry,
          length_km,
          elevation_gain,
          elevation_loss,
          trail_type,
          surface,
          difficulty,
          source,
          ST_Length(geometry::geography) as segment_length_m
        FROM split_segments
        WHERE ST_Length(geometry::geography) > 5.0
        
        UNION ALL
        
        SELECT 
          original_trail_id,
          original_trail_uuid,
          original_trail_name,
          geometry,
          length_km,
          elevation_gain,
          elevation_loss,
          trail_type,
          surface,
          difficulty,
          source,
          ST_Length(geometry::geography) as segment_length_m
        FROM unsplit_trails
        WHERE ST_Length(geometry::geography) > 5.0
      `);
      
      const segmentsCreated = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trail_segments`);
      console.log(`   ✂️ Created ${segmentsCreated.rows[0].count} split segments`);
      
      // Step 5: Add trails without intersections
      console.log('   ➕ Step 5: Adding trails without intersections...');
      await client.query(`
        INSERT INTO ${this.stagingSchema}.split_trail_segments (
          original_trail_id, original_trail_uuid, original_trail_name, geometry,
          length_km, elevation_gain, elevation_loss, trail_type, surface, difficulty, source, segment_length_m
        )
        SELECT 
          t.id,
          t.app_uuid,
          t.name,
          t.geometry,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.source,
          ST_Length(t.geometry::geography) as segment_length_m
        FROM ${this.stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL 
          AND ST_IsValid(t.geometry)
          AND ST_Length(t.geometry::geography) > 5.0
          AND t.id NOT IN (
            SELECT DISTINCT original_trail_id 
            FROM ${this.stagingSchema}.split_trail_segments
          )
      `);
      
      const totalSegments = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trail_segments`);
      console.log(`   ➕ Total segments after adding non-intersecting trails: ${totalSegments.rows[0].count}`);
      
      // Step 6: Deduplicate segments by geometry
      console.log('   🔄 Step 6: Deduplicating segments by geometry...');
      await client.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.deduplicated_segments`);
      await client.query(`
        CREATE TABLE ${this.stagingSchema}.deduplicated_segments AS
        SELECT DISTINCT ON (ST_AsText(geometry)) 
          original_trail_id,
          original_trail_uuid,
          original_trail_name,
          trail_type,
          surface,
          difficulty,
          elevation_gain,
          elevation_loss,
          length_km,
          source,
          geometry,
          segment_length_m
        FROM ${this.stagingSchema}.split_trail_segments
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ORDER BY ST_AsText(geometry), original_trail_id
      `);
      
      const finalSegments = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.deduplicated_segments`);
      const duplicatesRemoved = totalSegments.rows[0].count - finalSegments.rows[0].count;
      console.log(`   🔄 Removed ${duplicatesRemoved} duplicate segments`);
      
      // Step 7: Replace original trails with split segments
      console.log('   🔄 Step 7: Replacing original trails with split segments...');
      await client.query(`DELETE FROM ${this.stagingSchema}.trails`);
      await client.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
          trail_type, surface, difficulty, source, original_trail_uuid
        )
        SELECT 
          gen_random_uuid()::uuid as app_uuid,
          original_trail_name as name,
          geometry,
          ST_Length(geometry::geography) / 1000.0 as length_km,
          elevation_gain,
          elevation_loss,
          trail_type,
          surface,
          difficulty,
          source,
          original_trail_uuid
        FROM ${this.stagingSchema}.deduplicated_segments
        ORDER BY original_trail_id, segment_length_m DESC
      `);
      
      // Step 8: Create spatial indexes
      console.log('   📍 Step 8: Creating spatial indexes...');
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_geometry ON ${this.stagingSchema}.trails USING GIST (geometry)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_bbox ON ${this.stagingSchema}.trails (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat)`);
      
      await client.query('COMMIT');
      
      console.log(`📊 Node-based splitting results:`);
      console.log(`   📍 Intersection nodes created: ${nodeCount.rows[0].count}`);
      console.log(`   🔗 Snapped node-trail relationships: ${snappedCount.rows[0].count}`);
      console.log(`   ✂️ Segments created: ${segmentsCreated.rows[0].count}`);
      console.log(`   🔄 Duplicates removed: ${duplicatesRemoved}`);
      console.log(`   📊 Final segments: ${finalSegments.rows[0].count}`);
      
      return {
        verticesExtracted: nodeCount.rows[0].count,
        trailsSplit: trailCount.rows[0].count,
        segmentsCreated: segmentsCreated.rows[0].count,
        duplicatesRemoved,
        finalSegments: finalSegments.rows[0].count
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error in node-based trail splitting:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}
