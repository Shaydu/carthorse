import { Pool } from 'pg';
import { CentralizedTrailSplitManager, CentralizedSplitConfig } from '../../utils/services/network-creation/centralized-trail-split-manager';

export interface VertexBasedSplittingResult {
  verticesExtracted: number;
  trailsSplit: number;
  segmentsCreated: number;
  duplicatesRemoved: number;
  finalSegments: number;
}

export class VertexBasedSplittingService {
  private centralizedManager: CentralizedTrailSplitManager;

  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config: any
  ) {
    // Initialize centralized split manager
    const centralizedConfig: CentralizedSplitConfig = {
      stagingSchema: stagingSchema,
      intersectionToleranceMeters: 3.0,
      minSegmentLengthMeters: 5.0,
      preserveOriginalTrailNames: true,
      validationToleranceMeters: 1.0,
      validationTolerancePercentage: 0.1
    };
    
    this.centralizedManager = CentralizedTrailSplitManager.getInstance(pgClient, centralizedConfig);
  }

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
      
      // DEBUG: Track filtered segments for Shadow Canyon Trail
      console.log('   🔍 DEBUG: Checking Shadow Canyon Trail segments...');
      const shadowCanyonSegments = await client.query(`
        SELECT 
          original_trail_name,
          ST_Length(geometry::geography) as segment_length_m,
          ST_NumPoints(geometry) as points,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point
        FROM ${this.stagingSchema}.split_trail_segments
        WHERE original_trail_name = 'Shadow Canyon Trail'
        ORDER BY segment_length_m DESC
      `);
      
      console.log(`   🔍 Shadow Canyon Trail segments found: ${shadowCanyonSegments.rows.length}`);
      shadowCanyonSegments.rows.forEach((segment, i) => {
        console.log(`      ${i + 1}. Length: ${segment.segment_length_m.toFixed(2)}m, Points: ${segment.points}, Start: ${segment.start_point}, End: ${segment.end_point}`);
      });
      
      // Track segments that were filtered out (too short)
      const filteredSegments = await client.query(`
        SELECT 
          original_trail_name,
          ST_Length(geometry::geography) as segment_length_m,
          ST_NumPoints(geometry) as points,
          ST_AsText(geometry) as geometry_wkt
        FROM (
          SELECT 
            ts.original_trail_name,
            (ST_Dump(ST_Split(ts.original_geometry, ST_Union(ts.split_points)))).geom as geometry
          FROM (
            SELECT 
              t.id as original_trail_id,
              t.app_uuid as original_trail_uuid,
              t.name as original_trail_name,
              t.geometry as original_geometry,
              ARRAY_AGG(sn.snapped_geometry ORDER BY sn.location_ratio) as split_points
            FROM ${this.stagingSchema}.trails t
            LEFT JOIN ${this.stagingSchema}.snapped_nodes sn ON t.id = sn.trail_id
            WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
              AND ST_Length(t.geometry::geography) > 5.0
            GROUP BY t.id, t.app_uuid, t.name, t.geometry
          ) ts
          WHERE array_length(ts.split_points, 1) IS NOT NULL AND array_length(ts.split_points, 1) > 0
        ) all_segments
        WHERE ST_Length(geometry::geography) <= 5.0
          AND original_trail_name = 'Shadow Canyon Trail'
      `);
      
      if (filteredSegments.rows.length > 0) {
        console.log(`   🚨 DEBUG: Found ${filteredSegments.rows.length} filtered Shadow Canyon Trail segments (too short):`);
        filteredSegments.rows.forEach((segment, i) => {
          console.log(`      ${i + 1}. Length: ${segment.segment_length_m.toFixed(2)}m, Points: ${segment.points}`);
        });
        
        // Insert filtered segments into deleted_trails table for debugging
        for (const segment of filteredSegments.rows) {
          await client.query(`
            INSERT INTO staging.deleted_trails (
              trail_uuid, name, length_km, geometry, deletion_reason, stack_trace
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5
            )
          `, [
            `Shadow Canyon Trail (Filtered Segment)`,
            segment.segment_length_m / 1000.0,
            segment.geometry_wkt,
            'Filtered out as too short (< 5m) during vertex-based splitting',
            'VertexBasedSplittingService - segment length filter'
          ]);
        }
        console.log(`   📝 Inserted ${filteredSegments.rows.length} filtered segments into deleted_trails table`);
      }
      
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
      
      // Step 7: Replace original trails with split segments (TRANSACTIONAL)
      console.log('   🔄 Step 7: Replacing original trails with split segments...');
      
      // Start transaction for atomic replacement
      await client.query('BEGIN');
      
      try {
        // First, validate that all split segments properly represent the original trails
        console.log('   🔍 Validating split segments before replacement...');
        
        const validationQuery = `
          WITH original_trails AS (
            SELECT 
              app_uuid,
              name,
              geometry,
              ST_Length(geometry::geography) / 1000.0 as original_length_km
            FROM ${this.stagingSchema}.trails
          ),
          split_segments AS (
            SELECT 
              original_trail_id,
              original_trail_name,
              ST_Union(geometry) as combined_geometry,
              SUM(ST_Length(geometry::geography) / 1000.0) as total_split_length_km,
              COUNT(*) as segment_count
            FROM ${this.stagingSchema}.deduplicated_segments
            GROUP BY original_trail_id, original_trail_name
          ),
          validation_results AS (
            SELECT 
              ot.app_uuid,
              ot.name,
              ot.original_length_km,
              ss.total_split_length_km,
              ss.segment_count,
              ABS(ot.original_length_km - ss.total_split_length_km) as length_difference_km,
              (ABS(ot.original_length_km - ss.total_split_length_km) / ot.original_length_km * 100) as length_difference_percent,
              ST_Area(ST_Difference(ot.geometry, ss.combined_geometry)) as geometry_difference_area,
              ST_Area(ST_Difference(ss.combined_geometry, ot.geometry)) as extra_geometry_area
            FROM original_trails ot
            LEFT JOIN split_segments ss ON ot.app_uuid::text = ss.original_trail_id
          )
          SELECT 
            app_uuid,
            name,
            original_length_km,
            total_split_length_km,
            segment_count,
            length_difference_km,
            length_difference_percent,
            geometry_difference_area,
            extra_geometry_area,
            CASE 
              WHEN total_split_length_km IS NULL THEN 'MISSING_SPLIT'
              WHEN length_difference_percent > 5.0 THEN 'LENGTH_MISMATCH'
              WHEN geometry_difference_area > 0.000001 THEN 'GEOMETRY_MISMATCH'
              WHEN extra_geometry_area > 0.000001 THEN 'EXTRA_GEOMETRY'
              ELSE 'VALID'
            END as validation_status
          FROM validation_results
          ORDER BY validation_status, length_difference_percent DESC
        `;
        
        const validationResult = await client.query(validationQuery);
        const validationRows = validationResult.rows;
        
        // Check for validation failures
        const failures = validationRows.filter(row => row.validation_status !== 'VALID');
        if (failures.length > 0) {
          console.error('   ❌ VALIDATION FAILED: Split segments do not properly represent original trails');
          failures.forEach(failure => {
            console.error(`   ❌ ${failure.name} (${failure.app_uuid}): ${failure.validation_status}`);
            console.error(`      Original: ${failure.original_length_km?.toFixed(6)}km, Split: ${failure.total_split_length_km?.toFixed(6)}km`);
            console.error(`      Length diff: ${failure.length_difference_km?.toFixed(6)}km (${failure.length_difference_percent?.toFixed(2)}%)`);
            console.error(`      Geometry diff: ${failure.geometry_difference_area?.toFixed(10)}, Extra: ${failure.extra_geometry_area?.toFixed(10)}`);
          });
          
          await client.query('ROLLBACK');
          throw new Error(`Validation failed for ${failures.length} trails. Split segments do not properly represent original trails.`);
        }
        
        console.log(`   ✅ Validation passed for ${validationRows.length} trails`);
        
        // Store original trail data for restoration if needed
        const originalTrailsQuery = `
          SELECT 
            app_uuid,
            name,
            geometry,
            length_km,
            elevation_gain,
            elevation_loss,
            trail_type,
            surface,
            difficulty,
            source,
            source_tags,
            osm_id,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            original_trail_uuid
          FROM ${this.stagingSchema}.trails
        `;
        const originalTrailsResult = await client.query(originalTrailsQuery);
        const originalTrails = originalTrailsResult.rows;
        
        // Delete original trails
        console.log(`   🗑️ Deleting ${originalTrails.length} original trails...`);
        await client.query(`DELETE FROM ${this.stagingSchema}.trails`);
        
        // Insert split segments with proper original_trail_uuid preservation
        console.log('   📝 Inserting split segments with preserved metadata...');
        await client.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
            trail_type, surface, difficulty, source, source_tags, osm_id,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, original_trail_uuid
          )
          SELECT 
            gen_random_uuid()::uuid as app_uuid,
            ds.original_trail_name as name,
            ds.geometry,
            ST_Length(ds.geometry::geography) / 1000.0 as length_km,
            ot.elevation_gain,
            ot.elevation_loss,
            ot.trail_type,
            ot.surface,
            ot.difficulty,
            ot.source,
            ot.source_tags,
            ot.osm_id,
            ST_XMin(ds.geometry) as bbox_min_lng,
            ST_XMax(ds.geometry) as bbox_max_lng,
            ST_YMin(ds.geometry) as bbox_min_lat,
            ST_YMax(ds.geometry) as bbox_max_lat,
            ot.app_uuid as original_trail_uuid  -- Preserve original trail UUID
          FROM ${this.stagingSchema}.deduplicated_segments ds
          LEFT JOIN (
            SELECT DISTINCT 
              app_uuid,
              elevation_gain,
              elevation_loss,
              trail_type,
              surface,
              difficulty,
              source,
              source_tags,
              osm_id
            FROM ${this.stagingSchema}.trails
          ) ot ON ds.original_trail_id = ot.app_uuid::text
          ORDER BY ds.original_trail_id, ds.segment_length_m DESC
        `);
        
        // Final validation: ensure all original trails are represented
        const finalValidationQuery = `
          WITH original_count AS (
            SELECT COUNT(*) as count FROM (${originalTrailsQuery}) orig
          ),
          split_count AS (
            SELECT COUNT(DISTINCT original_trail_uuid) as count 
            FROM ${this.stagingSchema}.trails 
            WHERE original_trail_uuid IS NOT NULL
          )
          SELECT 
            oc.count as original_trail_count,
            sc.count as split_trail_count,
            (oc.count = sc.count) as count_matches
          FROM original_count oc, split_count sc
        `;
        
        const finalValidation = await client.query(finalValidationQuery);
        const finalResult = finalValidation.rows[0];
        
        if (!finalResult.count_matches) {
          console.error(`   ❌ FINAL VALIDATION FAILED: Original trails: ${finalResult.original_trail_count}, Split trails: ${finalResult.split_trail_count}`);
          await client.query('ROLLBACK');
          throw new Error('Final validation failed: Not all original trails are represented in split results');
        }
        
        console.log(`   ✅ Final validation passed: ${finalResult.split_trail_count} original trails represented`);
        
        // Commit the transaction
        await client.query('COMMIT');
        console.log('   ✅ Transaction committed successfully');
        
      } catch (error) {
        console.error('   ❌ Transaction failed, rolling back...');
        await client.query('ROLLBACK');
        throw error;
      }
      
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
