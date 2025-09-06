import { Pool } from 'pg';
import { CentralizedTrailSplitManager, CentralizedSplitConfig } from '../../utils/services/network-creation/centralized-trail-split-manager';
import { validateUUIDConsistency, ensureUUIDConsistency } from '../../utils/uuid-utils';

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
      
      // DEBUG: Check if Enchanted Mesa Trail exists in staging
      const enchantedMesaCheck = await client.query(`
        SELECT app_uuid, name, ST_Length(geometry::geography) as length_m, ST_IsValid(geometry) as is_valid
        FROM ${this.stagingSchema}.trails 
        WHERE name ILIKE '%enchanted mesa%'
      `);
      console.log(`   🔍 DEBUG: Enchanted Mesa Trail in staging: ${enchantedMesaCheck.rows.length} found`);
      enchantedMesaCheck.rows.forEach((row, i) => {
        console.log(`      ${i + 1}. ${row.name} (${row.app_uuid}): ${row.length_m.toFixed(2)}m, Valid: ${row.is_valid}`);
      });
      
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
            AND sn.trail_id IS NOT NULL -- Only include trails that have snapped nodes
          GROUP BY t.id, t.app_uuid, t.name, t.geometry, t.length_km, t.elevation_gain, t.elevation_loss, t.trail_type, t.surface, t.difficulty, t.source
          -- Only process trails that have intersection points (snapped nodes)
          HAVING COUNT(sn.snapped_geometry) > 0
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
            -- Snap intersection points to trail before splitting to prevent geometry corruption
            (ST_Dump(ST_Split(ts.original_geometry, snapped_points.snapped_union))).geom as geometry
          FROM trail_splits ts,
          LATERAL (
            SELECT ST_Union(snapped_point) as snapped_union
            FROM unnest(ts.split_points) as split_point,
            LATERAL (SELECT ST_ClosestPoint(ts.original_geometry, split_point) as snapped_point) sp
          ) snapped_points
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
      
      // DEBUG: Check if Enchanted Mesa Trail was split
      const enchantedMesaSplitCheck = await client.query(`
        SELECT original_trail_name, COUNT(*) as segment_count, 
               SUM(ST_Length(geometry::geography)) as total_length_m
        FROM ${this.stagingSchema}.split_trail_segments 
        WHERE original_trail_name ILIKE '%enchanted mesa%'
        GROUP BY original_trail_name
      `);
      console.log(`   🔍 DEBUG: Enchanted Mesa Trail after splitting: ${enchantedMesaSplitCheck.rows.length} found`);
      enchantedMesaSplitCheck.rows.forEach((row, i) => {
        console.log(`      ${i + 1}. ${row.original_trail_name}: ${row.segment_count} segments, ${row.total_length_m.toFixed(2)}m total`);
      });
      
      // DETAILED SPLITTING BREAKDOWN: Show which trails were split and how many segments each created
      console.log('   📊 DETAILED SPLITTING BREAKDOWN:');
      const splittingBreakdown = await client.query(`
        SELECT 
          original_trail_name,
          COUNT(*) as segment_count,
          SUM(segment_length_m) / 1000.0 as total_length_km,
          MIN(segment_length_m) / 1000.0 as min_segment_km,
          MAX(segment_length_m) / 1000.0 as max_segment_km,
          AVG(segment_length_m) / 1000.0 as avg_segment_km
        FROM ${this.stagingSchema}.split_trail_segments
        GROUP BY original_trail_name, original_trail_uuid
        ORDER BY segment_count DESC, original_trail_name
      `);
      
      let breakdownTotalSegments = 0;
      let breakdownTotalLength = 0;
      splittingBreakdown.rows.forEach((row, i) => {
        breakdownTotalSegments += parseInt(row.segment_count);
        breakdownTotalLength += parseFloat(row.total_length_km);
        const splitIndicator = row.segment_count > 1 ? ` → ${row.segment_count} segments` : ' (no splits)';
        console.log(`      ${i + 1}. ${row.original_trail_name}: ${row.total_length_km.toFixed(3)}km${splitIndicator}`);
        if (row.segment_count > 1) {
          console.log(`         └─ Segments: ${row.min_segment_km.toFixed(3)}km - ${row.max_segment_km.toFixed(3)}km (avg: ${row.avg_segment_km.toFixed(3)}km)`);
        }
      });
      console.log(`   📊 SUMMARY: ${breakdownTotalSegments} total segments from ${splittingBreakdown.rows.length} trails (${breakdownTotalLength.toFixed(3)}km total)`);
      
      // CRITICAL VALIDATION: Ensure split geometries match parent geometries within tolerance
      console.log('   🔍 CRITICAL VALIDATION: Checking geometry integrity...');
      const geometryValidation = await client.query(`
        WITH original_trails AS (
          SELECT 
            app_uuid,
            name,
            geometry as original_geometry,
            ST_Length(geometry::geography) as original_length_m
          FROM ${this.stagingSchema}.trails
        ),
        split_aggregates AS (
          SELECT 
            original_trail_uuid,
            original_trail_name,
            ST_Union(geometry) as combined_geometry,
            SUM(ST_Length(geometry::geography)) as total_split_length_m,
            COUNT(*) as segment_count
          FROM ${this.stagingSchema}.split_trail_segments
          GROUP BY original_trail_uuid, original_trail_name
        ),
        geometry_comparison AS (
          SELECT 
            ot.app_uuid,
            ot.name,
            ot.original_length_m,
            sa.total_split_length_m,
            sa.segment_count,
            ABS(ot.original_length_m - sa.total_split_length_m) as length_difference_m,
            (ABS(ot.original_length_m - sa.total_split_length_m) / ot.original_length_m * 100) as length_difference_percent,
            ST_Area(ST_Difference(ot.original_geometry, sa.combined_geometry)) as missing_area,
            ST_Area(ST_Difference(sa.combined_geometry, ot.original_geometry)) as extra_area
          FROM original_trails ot
          JOIN split_aggregates sa ON ot.app_uuid = sa.original_trail_uuid
        )
        SELECT 
          app_uuid,
          name,
          original_length_m,
          total_split_length_m,
          segment_count,
          length_difference_m,
          length_difference_percent,
          missing_area,
          extra_area,
          (length_difference_percent <= 5.0 AND missing_area <= 1.0 AND extra_area <= 1.0) as geometry_valid
        FROM geometry_comparison
        ORDER BY length_difference_m DESC
      `);
      
      const validationResults = geometryValidation.rows;
      let failedValidations = 0;
      let totalLengthDifference = 0;
      
      console.log('   🔍 GEOMETRY VALIDATION RESULTS:');
      for (let i = 0; i < validationResults.length; i++) {
        const result = validationResults[i];
        const status = result.geometry_valid ? '✅' : '❌';
        const lengthDiff = result.length_difference_m.toFixed(2);
        const percentDiff = result.length_difference_percent.toFixed(2);
        
        console.log(`      ${i + 1}. ${status} ${result.name}: ${result.original_length_m.toFixed(1)}m → ${result.total_split_length_m.toFixed(1)}m (diff: ${lengthDiff}m, ${percentDiff}%)`);
        
        if (!result.geometry_valid) {
          failedValidations++;
          console.log(`         ❌ FAILED: Length diff: ${lengthDiff}m, Missing area: ${result.missing_area.toFixed(2)}, Extra area: ${result.extra_area.toFixed(2)}`);
          
          // Get detailed breakdown of how this trail was split
          const detailedSegments = await client.query(`
            SELECT 
              original_trail_name,
              ST_Length(geometry::geography) as segment_length_m,
              ST_AsText(geometry) as geometry_wkt,
              ST_AsText(ST_StartPoint(geometry)) as start_point,
              ST_AsText(ST_EndPoint(geometry)) as end_point
            FROM ${this.stagingSchema}.split_trail_segments
            WHERE original_trail_uuid = $1
            ORDER BY ST_Length(geometry::geography) DESC
          `, [result.app_uuid]);
          
          console.log(`         🔍 DETAILED SPLIT BREAKDOWN FOR ${result.name}:`);
          detailedSegments.rows.forEach((segment, segIdx) => {
            console.log(`            Segment ${segIdx + 1}: ${segment.segment_length_m.toFixed(2)}m`);
            console.log(`               Start: ${segment.start_point}`);
            console.log(`               End: ${segment.end_point}`);
            console.log(`               Geometry: ${segment.geometry_wkt.substring(0, 100)}...`);
          });
          
          // Also get the original geometry for comparison
          const originalGeometry = await client.query(`
            SELECT 
              ST_AsText(geometry) as original_geometry_wkt,
              ST_AsText(ST_StartPoint(geometry)) as original_start_point,
              ST_AsText(ST_EndPoint(geometry)) as original_end_point
            FROM ${this.stagingSchema}.trails
            WHERE app_uuid = $1
          `, [result.app_uuid]);
          
          if (originalGeometry.rows.length > 0) {
            const orig = originalGeometry.rows[0];
            console.log(`         🔍 ORIGINAL GEOMETRY FOR ${result.name}:`);
            console.log(`            Length: ${result.original_length_m.toFixed(2)}m`);
            console.log(`            Start: ${orig.original_start_point}`);
            console.log(`            End: ${orig.original_end_point}`);
            console.log(`            Geometry: ${orig.original_geometry_wkt.substring(0, 100)}...`);
          }
        } else if (result.segment_count > 1) {
          console.log(`         ✅ SPLIT: ${result.segment_count} segments, geometry preserved`);
        }
        
        totalLengthDifference += result.length_difference_m;
      }
      
      const avgLengthDifference = totalLengthDifference / validationResults.length;
      console.log(`   📊 VALIDATION SUMMARY: ${validationResults.length - failedValidations}/${validationResults.length} trails passed`);
      console.log(`   📊 Average length difference: ${avgLengthDifference.toFixed(2)}m`);
      
      if (failedValidations > 0) {
        console.error(`   ❌ CRITICAL ERROR: ${failedValidations} trails failed geometry validation!`);
        console.error(`   ❌ This indicates geometry corruption during splitting. Aborting.`);
        
        // Get detailed information about all failed trails
        const failedTrails = validationResults.filter(r => !r.geometry_valid);
        
        console.error(`   ❌ FAILED TRAILS DETAILS:`);
        failedTrails.forEach((trail, index) => {
          console.error(`      ${index + 1}. Table: ${this.stagingSchema}.trails`);
          console.error(`         Primary Key (app_uuid): ${trail.app_uuid}`);
          console.error(`         Name: ${trail.name}`);
          console.error(`         Original Length: ${trail.original_length_m.toFixed(2)}m`);
          console.error(`         Split Length: ${trail.total_split_length_m.toFixed(2)}m`);
          console.error(`         Length Difference: ${trail.length_difference_m.toFixed(2)}m (${trail.length_difference_percent.toFixed(2)}%)`);
          console.error(`         Missing Area: ${trail.missing_area.toFixed(2)}`);
          console.error(`         Extra Area: ${trail.extra_area.toFixed(2)}`);
          console.error(`         Segments Created: ${trail.segment_count}`);
          console.error(`         Split Segments Table: ${this.stagingSchema}.split_trail_segments`);
          console.error(`         Query to inspect segments: SELECT * FROM ${this.stagingSchema}.split_trail_segments WHERE original_trail_uuid = '${trail.app_uuid}';`);
        });
        
        const failedTrailNames = failedTrails.map(t => t.name).join(', ');
        const failedTrailUuids = failedTrails.map(t => t.app_uuid).join(', ');
        
        console.error(`   ❌ FAILED TRAIL NAMES: ${failedTrailNames}`);
        console.error(`   ❌ FAILED TRAIL UUIDs: ${failedTrailUuids}`);
        console.error(`   ❌ STACK TRACE:`);
        console.error(new Error().stack);
        
        await client.query('ROLLBACK');
        throw new Error(`Geometry validation failed: ${failedValidations} trails have corrupted geometries after splitting. Failed trails: ${failedTrailNames}. Failed UUIDs: ${failedTrailUuids}. Check detailed breakdown above for segment geometries.`);
      }
      
      console.log(`   ✅ GEOMETRY VALIDATION PASSED: All ${validationResults.length} trails preserved geometry integrity`);
      
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
      
      const totalSegmentsQuery = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.split_trail_segments`);
      console.log(`   ➕ Total segments after adding non-intersecting trails: ${totalSegmentsQuery.rows[0].count}`);
      
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
      const duplicatesRemoved = totalSegmentsQuery.rows[0].count - finalSegments.rows[0].count;
      console.log(`   🔄 Removed ${duplicatesRemoved} duplicate segments`);
      
      // DEBUG: Check if Enchanted Mesa Trail survived deduplication
      const enchantedMesaDedupCheck = await client.query(`
        SELECT original_trail_name, COUNT(*) as segment_count, 
               SUM(ST_Length(geometry::geography)) as total_length_m
        FROM ${this.stagingSchema}.deduplicated_segments 
        WHERE original_trail_name ILIKE '%enchanted mesa%'
        GROUP BY original_trail_name
      `);
      console.log(`   🔍 DEBUG: Enchanted Mesa Trail after deduplication: ${enchantedMesaDedupCheck.rows.length} found`);
      enchantedMesaDedupCheck.rows.forEach((row, i) => {
        console.log(`      ${i + 1}. ${row.original_trail_name}: ${row.segment_count} segments, ${row.total_length_m.toFixed(2)}m total`);
      });
      
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
              original_trail_uuid,
              original_trail_name,
              ST_Union(geometry) as combined_geometry,
              SUM(ST_Length(geometry::geography) / 1000.0) as total_split_length_km,
              COUNT(*) as segment_count
            FROM ${this.stagingSchema}.deduplicated_segments
            GROUP BY original_trail_uuid, original_trail_name
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
            LEFT JOIN split_segments ss ON ot.app_uuid = ss.original_trail_uuid
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
        // Get original trails from the source data, not from staging (which contains split segments)
        // Use the same filters that were used when copying trails to staging
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
            app_uuid as original_trail_uuid
          FROM public.trails
          WHERE region = '${this.config.region || 'boulder'}'
            AND source = '${this.config.sourceFilter || 'cotrex'}'
            ${this.config.bbox ? `AND ST_Intersects(geometry, ST_MakeEnvelope(${this.config.bbox[0] - 0.01}, ${this.config.bbox[1] - 0.01}, ${this.config.bbox[2] + 0.01}, ${this.config.bbox[3] + 0.01}, 4326))` : ''}
        `;
        const originalTrailsResult = await client.query(originalTrailsQuery);
        const originalTrails = originalTrailsResult.rows;
        
        // DEBUG: Check if Enchanted Mesa Trail exists in original source data
        const enchantedMesaSourceCheck = originalTrails.filter(trail => 
          trail.name.toLowerCase().includes('enchanted mesa')
        );
        console.log(`   🔍 DEBUG: Enchanted Mesa Trail in source data: ${enchantedMesaSourceCheck.length} found`);
        enchantedMesaSourceCheck.forEach((trail, i) => {
          console.log(`      ${i + 1}. ${trail.name} (${trail.app_uuid}): ${trail.length_km.toFixed(3)}km`);
        });
        
        // Delete original trails
        console.log(`   🗑️ Deleting ${originalTrails.length} original trails...`);
        await client.query(`DELETE FROM ${this.stagingSchema}.trails`);
        
        // Insert split segments with proper original_trail_uuid preservation
        console.log('   📝 Inserting split segments with preserved metadata...');
        
        // First, let's count what we're about to insert
        const insertCountQuery = `
          SELECT COUNT(*) as count
          FROM ${this.stagingSchema}.deduplicated_segments
        `;
        
        const insertCount = await client.query(insertCountQuery);
        console.log(`   🔍 DEBUG: About to insert ${insertCount.rows[0].count} split segments`);
        
        // Insert split segments with consistent UUID assignment
        await client.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
            trail_type, surface, difficulty, source, source_tags, osm_id,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, original_trail_uuid
          )
          SELECT 
            gen_random_uuid() as app_uuid,  -- Generate new UUID for each split segment
            ds.original_trail_name as name,
            ds.geometry,
            ds.length_km,
            ds.elevation_gain,
            ds.elevation_loss,
            ds.trail_type,
            ds.surface,
            ds.difficulty,
            ds.source,
            ot.source_tags,
            ot.osm_id,
            ST_XMin(ds.geometry) as bbox_min_lng,
            ST_XMax(ds.geometry) as bbox_max_lng,
            ST_YMin(ds.geometry) as bbox_min_lat,
            ST_YMax(ds.geometry) as bbox_max_lat,
            ds.original_trail_uuid
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
          ) ot ON ds.original_trail_uuid = ot.app_uuid
        `);
        
        // Check what was actually inserted
        const insertedCount = await client.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
        console.log(`   🔍 DEBUG: Actually inserted ${insertedCount.rows[0].count} segments`);
        
        // DEBUG: Check if Enchanted Mesa Trail was inserted
        const enchantedMesaFinalCheck = await client.query(`
          SELECT name, original_trail_uuid, ST_Length(geometry::geography) as length_m
          FROM ${this.stagingSchema}.trails 
          WHERE name ILIKE '%enchanted mesa%'
        `);
        console.log(`   🔍 DEBUG: Enchanted Mesa Trail after final insertion: ${enchantedMesaFinalCheck.rows.length} found`);
        enchantedMesaFinalCheck.rows.forEach((row, i) => {
          console.log(`      ${i + 1}. ${row.name} (Original: ${row.original_trail_uuid}): ${row.length_m.toFixed(2)}m`);
        });
        
        // Final validation: ensure all original trails are represented
        console.log('   🔍 DEBUG: Starting final validation...');
        
        // First, let's get detailed counts for debugging
        // The key insight: we need to compare the original source trails with the split segments
        // by matching trail names, since the UUIDs have changed during the staging process
        const debugCountsQuery = `
          WITH original_source_trails AS (
            ${originalTrailsQuery}
          ),
          split_trail_groups AS (
            SELECT 
              name as original_trail_name,
              COUNT(DISTINCT original_trail_uuid) as unique_original_uuids,
              COUNT(*) as total_segments
            FROM ${this.stagingSchema}.trails 
            WHERE original_trail_uuid IS NOT NULL
            GROUP BY name
          ),
          validation_mapping AS (
            SELECT 
              ost.app_uuid as source_uuid,
              ost.name as source_name,
              stg.unique_original_uuids,
              stg.total_segments,
              CASE WHEN stg.original_trail_name IS NOT NULL THEN true ELSE false END as is_represented
            FROM original_source_trails ost
            LEFT JOIN split_trail_groups stg ON ost.name = stg.original_trail_name
          )
          SELECT 
            COUNT(*) as original_trail_count,
            COUNT(CASE WHEN is_represented THEN 1 END) as represented_trail_count,
            SUM(total_segments) as total_segments,
            COUNT(CASE WHEN NOT is_represented THEN 1 END) as missing_trail_count,
            (COUNT(*) = COUNT(CASE WHEN is_represented THEN 1 END)) as all_original_trails_represented
          FROM validation_mapping
        `;
        
        const debugCounts = await client.query(debugCountsQuery);
        const debugResult = debugCounts.rows[0];
        
        console.log(`   🔍 DEBUG: Validation counts:`);
        console.log(`      📊 Original trails (from source): ${debugResult.original_trail_count}`);
        console.log(`      📊 Represented trails (by name): ${debugResult.represented_trail_count}`);
        console.log(`      📊 Total segments: ${debugResult.total_segments}`);
        console.log(`      📊 Missing trails: ${debugResult.missing_trail_count}`);
        console.log(`      📊 All original trails represented: ${debugResult.all_original_trails_represented}`);
        
        // Let's also check what original trails are missing
        const missingTrailsQuery = `
          WITH original_source_trails AS (
            ${originalTrailsQuery}
          ),
          split_trail_names AS (
            SELECT DISTINCT name as original_trail_name 
            FROM ${this.stagingSchema}.trails 
            WHERE original_trail_uuid IS NOT NULL
          )
          SELECT ost.app_uuid, ost.name
          FROM original_source_trails ost
          LEFT JOIN split_trail_names stn ON ost.name = stn.original_trail_name
          WHERE stn.original_trail_name IS NULL
          LIMIT 10
        `;
        
        const missingTrails = await client.query(missingTrailsQuery);
        if (missingTrails.rows.length > 0) {
          console.log(`   🔍 DEBUG: Missing original trails (first 10):`);
          missingTrails.rows.forEach((row, i) => {
            console.log(`      ${i + 1}. ${row.name} (${row.app_uuid})`);
          });
          
          // Let's also check if these missing trails exist in staging but with different UUIDs
          console.log(`   🔍 DEBUG: Checking if missing trails exist in staging with different UUIDs...`);
          for (const missingTrail of missingTrails.rows.slice(0, 5)) {
            const stagingCheck = await client.query(`
              SELECT app_uuid, name, original_trail_uuid, ST_Length(geometry::geography) as length_m
              FROM ${this.stagingSchema}.trails 
              WHERE name = $1
            `, [missingTrail.name]);
            
            if (stagingCheck.rows.length > 0) {
              console.log(`      🔍 Found "${missingTrail.name}" in staging:`);
              stagingCheck.rows.forEach((row, i) => {
                console.log(`         ${i + 1}. UUID: ${row.app_uuid}, Original UUID: ${row.original_trail_uuid}, Length: ${row.length_m.toFixed(2)}m`);
              });
            } else {
              console.log(`      ❌ "${missingTrail.name}" not found in staging at all`);
            }
          }
        }
        
        if (!debugResult.all_original_trails_represented) {
          console.error(`   ❌ FINAL VALIDATION FAILED: Original trails: ${debugResult.original_trail_count}, Represented trails: ${debugResult.represented_trail_count}, Missing: ${debugResult.missing_trail_count}`);
          await client.query('ROLLBACK');
          throw new Error('Final validation failed: Not all original trails are represented in split results');
        }
        
        console.log(`   ✅ Final validation passed: ${debugResult.represented_trail_count}/${debugResult.original_trail_count} original trails represented in ${debugResult.total_segments} total segments`);
        
        // UUID consistency validation and enforcement
        console.log('   🔍 Validating UUID consistency...');
        await ensureUUIDConsistency(client, this.stagingSchema);
        
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
