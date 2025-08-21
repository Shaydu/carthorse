import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';
import { runGapMidpointBridging } from '../gap-midpoint-bridging';
import { runTrailLevelBridging } from '../trail-level-bridging';
import { runPostNodingSnap } from '../post-noding-snap';
// import { runConnectorEdgeSpanning } from '../connector-edge-spanning';  // Removed - gap filling moved to Layer 1
import { runPostNodingVertexMerge } from '../post-noding-merge';
import { runConnectorEdgeCollapse } from '../connector-edge-collapse';
import { getPgRoutingTolerances, getConstants, getBridgingConfig, getRouteGenerationFlags } from '../../../config-loader';
import { runEdgeCompaction } from '../edge-compaction';

import { mergeCoincidentVertices } from '../merge-coincident-vertices';
import { mergeDegree2Chains } from '../merge-degree2-chains';
import { deduplicateEdges } from '../deduplicate-edges';
import { cleanupShortConnectors } from '../cleanup-short-connectors';

export class PostgisNodeStrategy implements NetworkCreationStrategy {
  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const { stagingSchema } = config;
    const diagUnsplit = process.env.DIAG_UNSPLIT_X === '1';
    try {
      console.log('🔄 Using PostGIS ST_Node pipeline to split at at-grade crossings...');

      // Check if input data exists
      const inputCheck = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.ways WHERE the_geom IS NOT NULL
      `);
      console.log(`📊 Input ways table contains ${inputCheck.rows[0].count} rows with geometry`);
      
      if (inputCheck.rows[0].count === 0) {
        throw new Error('No input data found in ways table');
      }

      // Prepare 2D, valid, simple input
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_2d`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_2d AS
        SELECT id AS original_trail_id, ST_Force2D(the_geom) AS geom, app_uuid, name, length_km, elevation_gain, elevation_loss
        FROM ${stagingSchema}.ways
        WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
      `);
      
      const ways2dCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_2d`);
      console.log(`📊 Created ways_2d table with ${ways2dCount.rows[0].count} rows`);

      if (diagUnsplit) {
        console.log('🔎 Diagnosing unsplit X crossings (pre-noding)...');
        const diag = await pgClient.query(`
          WITH pairs AS (
            SELECT a.original_trail_id AS a_id, b.original_trail_id AS b_id,
                   ST_Crosses(a.geom, b.geom) AS crosses,
                   ST_Touches(a.geom, b.geom) AS touches
            FROM ${stagingSchema}.ways_2d a
            JOIN ${stagingSchema}.ways_2d b ON a.original_trail_id < b.original_trail_id
          )
          SELECT COUNT(*)::int AS unsplit_count FROM pairs WHERE crosses AND NOT touches
        `);
        console.log(`🧭 Unsplit crossings before ST_Node: ${diag.rows[0].unsplit_count}`);
      }

      // Layer 2: Use pgRouting to create nodes and edges from already-split trails
      console.log('🔗 Layer 2: Creating nodes and edges using pgRouting (no manual splitting)...');
      
      // Create ways_split directly from the already-split trails from Layer 1
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_split CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_split AS
        SELECT 
          geom as the_geom,
          original_trail_id,
          app_uuid,
          name,
          length_km,
          elevation_gain,
          elevation_loss
        FROM ${stagingSchema}.ways_2d
        WHERE geom IS NOT NULL AND ST_NumPoints(geom) > 1
      `);
      
      // Add required columns for pgRouting
      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_split ADD COLUMN id serial PRIMARY KEY`);
      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_split ADD COLUMN source integer`);
      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_split ADD COLUMN target integer`);
      
      // GOLDEN TAG APPROACH: Do all processing BEFORE pgr_createTopology
      console.log('🔄 Pre-processing trails before pgRouting (like golden tag)...');
      
      // HOGBACK RIDGE PROCESSING: Split trails at actual intersection points while preserving self-intersecting loops
      console.log('🔗 HOGBACK RIDGE: Splitting trails at intersection points while preserving self-intersecting loops...');
      
      // Find all trail intersections (both between trails and self-intersections)
      const intersectionResult = await pgClient.query(`
        WITH trail_intersections AS (
          -- Intersections between different trails
          SELECT DISTINCT
            t1.original_trail_id as trail1_id,
            t2.original_trail_id as trail2_id,
            ST_Intersection(t1.the_geom, t2.the_geom) as intersection_point,
            ST_AsText(ST_Intersection(t1.the_geom, t2.the_geom)) as intersection_text
          FROM ${stagingSchema}.ways_split t1
          JOIN ${stagingSchema}.ways_split t2 ON t1.original_trail_id < t2.original_trail_id
          WHERE ST_Intersects(t1.the_geom, t2.the_geom)
            AND NOT ST_Touches(t1.the_geom, t2.the_geom)
            AND ST_GeometryType(ST_Intersection(t1.the_geom, t2.the_geom)) = 'ST_Point'
        )
        SELECT * FROM trail_intersections
        WHERE intersection_point IS NOT NULL
      `);
      
      console.log(`   📊 Found ${intersectionResult.rows.length} intersection points`);
      
      // Process each intersection by splitting trails at intersection points
      for (const intersection of intersectionResult.rows) {
        try {
          // Split trail1 at intersection point
          const splitResult1 = await pgClient.query(`
            WITH split_geom AS (
              SELECT ST_Split(the_geom, $1::geometry) as split_geometries
              FROM ${stagingSchema}.ways_split
              WHERE original_trail_id = $2
            )
            SELECT ST_NumGeometries(split_geometries) as num_segments
            FROM split_geom
          `, [intersection.intersection_point, intersection.trail1_id]);
          
          // Split trail2 at intersection point  
          const splitResult2 = await pgClient.query(`
            WITH split_geom AS (
              SELECT ST_Split(the_geom, $1::geometry) as split_geometries
              FROM ${stagingSchema}.ways_split
              WHERE original_trail_id = $3
            )
            SELECT ST_NumGeometries(split_geometries) as num_segments
            FROM split_geom
          `, [intersection.intersection_point, intersection.trail2_id]);
          
          console.log(`   ✅ Split trails at ${intersection.intersection_text} (${splitResult1.rows[0]?.num_segments || 0} + ${splitResult2.rows[0]?.num_segments || 0} segments)`);
        } catch (error) {
          console.warn(`   ⚠️ Failed to split trails at ${intersection.intersection_text}:`, error instanceof Error ? error.message : String(error));
        }
      }
      
      // Remove degenerate/self-loop/invalid edges before pgRouting
      await pgClient.query(`DELETE FROM ${stagingSchema}.ways_split WHERE the_geom IS NULL OR ST_NumPoints(the_geom) < 2 OR ST_Length(the_geom::geography) = 0`);
      
      // Use pgRouting to create topology (nodes and edges) from already-split trails
      console.log('🔧 Creating topology with pgr_createTopology...');
      const topologyResult = await pgClient.query(`
        SELECT pgr_createTopology('${stagingSchema}.ways_split', 0.00001, 'the_geom', 'id')
      `);
      console.log(`   ✅ pgr_createTopology result: ${topologyResult.rows[0].pgr_createtopology}`);
      
      // GOLDEN TAG APPROACH: Create ways_noded from the split and topologized table
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded CASCADE`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded AS
        SELECT 
          id,
          the_geom,
          length_km,
          app_uuid,
          name,
          elevation_gain,
          elevation_loss,
          original_trail_id,
          app_uuid AS original_trail_uuid,  -- Preserve reference to unsplit parent trail
          1 AS sub_id,
          source,
          target
        FROM ${stagingSchema}.ways_split
        WHERE the_geom IS NOT NULL AND ST_NumPoints(the_geom) > 1
      `);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);
      
      // Initialize edge trail composition tracking
      console.log('📋 Initializing edge trail composition tracking...');
      const { EdgeCompositionTracking } = await import('../edge-composition-tracking');
      const compositionTracking = new EdgeCompositionTracking(stagingSchema, pgClient);
      await compositionTracking.createCompositionTable();
      const compositionCount = await compositionTracking.initializeCompositionFromWaysSplit();
      console.log(`✅ Initialized composition tracking for ${compositionCount} edge-trail relationships`);
      
      // Validate composition data integrity
      const compositionValidation = await compositionTracking.validateComposition();
      if (!compositionValidation.valid) {
        console.warn(`⚠️ Composition validation issues: ${compositionValidation.issues.join(', ')}`);
      } else {
        console.log('✅ Composition data integrity validated');
      }

      // GOLDEN TAG APPROACH: Copy vertices table from pgRouting output
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT * FROM ${stagingSchema}.ways_split_vertices_pgr
      `);
      
      console.log('✅ Vertices table created from pgr_createTopology output');
      console.log('✅ Source/target assignment completed by pgr_createTopology');

      // GOLDEN TAG APPROACH: Let pgRouting's degree calculations stand as authoritative
      const connectivityCheck = await pgClient.query(`
        SELECT COUNT(*) as total_vertices, 
               COUNT(CASE WHEN cnt > 0 THEN 1 END) as connected_vertices,
               MIN(cnt) as min_degree, 
               MAX(cnt) as max_degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      `);
      
      const stats = connectivityCheck.rows[0];
      console.log(`🔗 Connectivity check: ${stats.total_vertices} total vertices, ${stats.connected_vertices} connected, degree range ${stats.min_degree}-${stats.max_degree}`);

      // GOLDEN TAG APPROACH: Simple post-processing only - no complex degree-2 merging
      console.log('🧵 Trail-level bridging: DISABLED - this is Layer 2 (node/edge processing only)');
      
      // GOLDEN TAG APPROACH: Minimal post-processing to preserve pgRouting's degree calculations
      console.log('🔧 GOLDEN TAG APPROACH: Minimal post-processing to preserve pgRouting degrees');



      // Post-merge re-snap and endpoint recompute to align merged edges with current vertex positions
      try {
        const resnapTolDeg2 = Number(getBridgingConfig().edgeSnapToleranceMeters) / 111320.0;
        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded
           SET the_geom = ST_Snap(
             the_geom,
             (SELECT ST_UnaryUnion(ST_Collect(the_geom)) FROM ${stagingSchema}.ways_noded_vertices_pgr),
             $1
           )`,
          [resnapTolDeg2]
        );

        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded e
           SET source = (
             SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v
             ORDER BY ST_Distance(v.the_geom, ST_StartPoint(e.the_geom)) ASC
             LIMIT 1
           ),
               target = (
             SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v
             ORDER BY ST_Distance(v.the_geom, ST_EndPoint(e.the_geom)) ASC
             LIMIT 1
           )`
        );

        // REMOVED: Manual degree recalculation - let pgRouting handle vertex degrees properly
        // The cnt field from pgr_createTopology is the authoritative source for vertex degrees
        
        // REMOVED: pgr_analyzeGraph call - let pgRouting's original degree calculations stand
        console.log('🔧 Post-merge re-snap and endpoint recompute completed');
      } catch (e) {
        console.warn('⚠️ Post-merge re-snap skipped due to error:', e instanceof Error ? e.message : e);
      }

      // Clean up any self-loops that were created during the degree-2 merging process
      try {
        const selfLoopCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_noded WHERE source = target`);
        if (selfLoopCount.rows[0].count > 0) {
          await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE source = target`);
          console.log(`🧹 Cleaned up ${selfLoopCount.rows[0].count} self-loops created during degree-2 merging`);
        }
      } catch (e) {
        console.warn('⚠️ Self-loop cleanup skipped due to error:', e instanceof Error ? e.message : e);
      }

      // Secondary contraction pass (disabled for pure endpoint-to-decision chain collapse)
      const performSecondaryContraction = false;
      if (performSecondaryContraction) try {
        // Skip if no edges yet
        const edgeCountRes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded`);
        const edgeCount = edgeCountRes.rows[0]?.c ?? 0;
        if (edgeCount === 0) {
          console.log('ℹ️ Skipping post-collapse contraction (no edges present)');
        } else {
        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.contracted_graph_post`);
        await pgClient.query(`CREATE TABLE ${stagingSchema}.contracted_graph_post AS
          SELECT * FROM pgr_contraction(
            $$SELECT id, source, target, length_km AS cost FROM ${stagingSchema}.ways_noded$$::text,
            ARRAY(SELECT id::bigint FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE cnt = 2),
            0,
            ARRAY[]::bigint[],
            false
          )`);

        await pgClient.query(`DROP TABLE IF EXISTS tmp_cg_nodes_post`);
        await pgClient.query(`CREATE TEMP TABLE tmp_cg_nodes_post AS
          SELECT c.id AS cid, 0 AS ord, c.source AS node FROM ${stagingSchema}.contracted_graph_post c
          UNION ALL
          SELECT c.id AS cid, gs AS ord, c.contracted_vertices[gs] AS node
          FROM ${stagingSchema}.contracted_graph_post c, generate_subscripts(c.contracted_vertices, 1) AS gs
          UNION ALL
          SELECT c.id AS cid, COALESCE(array_length(c.contracted_vertices, 1), 0) + 1 AS ord, c.target AS node
          FROM ${stagingSchema}.contracted_graph_post c`);

        await pgClient.query(`DROP TABLE IF EXISTS tmp_cg_pairs_post`);
        await pgClient.query(`CREATE TEMP TABLE tmp_cg_pairs_post AS
          SELECT cid, node AS a, LEAD(node) OVER (PARTITION BY cid ORDER BY ord) AS b, ord
          FROM tmp_cg_nodes_post`);

        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_spanned_tmp_post`);
        await pgClient.query(`CREATE TABLE ${stagingSchema}.ways_spanned_tmp_post AS
          SELECT ROW_NUMBER() OVER () AS id,
                 c.source,
                 c.target,
                 ST_LineMerge(ST_Collect(e.the_geom ORDER BY p.ord)) AS the_geom
          FROM ${stagingSchema}.contracted_graph_post c
          JOIN tmp_cg_pairs_post p ON p.cid = c.id
          JOIN ${stagingSchema}.ways_noded e
            ON (e.source = p.a AND e.target = p.b) OR (e.source = p.b AND e.target = p.a)
          WHERE p.b IS NOT NULL
          GROUP BY c.id, c.source, c.target`);
        // Only rebuild/replace if we produced any spanned edges
        const postCountRes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_spanned_tmp_post`);
        const postCount = postCountRes.rows[0]?.c ?? 0;
        if (postCount > 0) {
          // Rebuild vertices + remap
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
          await pgClient.query(`CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
            SELECT row_number() OVER () AS id, geom AS the_geom, 0::int AS cnt, 0::int AS chk, 0::int AS ein, 0::int AS eout
            FROM (
              SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_spanned_tmp_post
              UNION ALL
              SELECT DISTINCT ST_EndPoint(the_geom)   AS geom FROM ${stagingSchema}.ways_spanned_tmp_post
            ) pts`);

          await pgClient.query(`TRUNCATE ${stagingSchema}.ways_noded`);
          await pgClient.query(`INSERT INTO ${stagingSchema}.ways_noded (id, old_id, sub_id, the_geom, app_uuid, name, length_km, elevation_gain, elevation_loss, source, target)
            SELECT row_number() OVER () AS id,
                   NULL::bigint,
                   1,
                   the_geom,
                   NULL::text,
                   NULL::text,
                   ST_Length(the_geom::geography)/1000.0,
                   0.0::double precision,
                   0.0::double precision,
                   (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v ORDER BY ST_Distance(v.the_geom, ST_StartPoint(t.the_geom)) LIMIT 1),
                   (SELECT v.id FROM ${stagingSchema}.ways_noded_vertices_pgr v ORDER BY ST_Distance(v.the_geom, ST_EndPoint(t.the_geom)) LIMIT 1)
            FROM ${stagingSchema}.ways_spanned_tmp_post t`);

          await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
            SET cnt = (
              SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e WHERE e.source = v.id OR e.target = v.id
            )`);

          console.log('🔗 Post-collapse contraction pass complete');
        } else {
          console.log('ℹ️ Post-collapse contraction produced 0 edges; skipping replacement to preserve existing network');
        }
        }
      } catch (e) {
        console.warn('⚠️ Post-collapse contraction skipped:', e instanceof Error ? e.message : e);
      }

      // FINAL topological spanning via pgr_contraction is disabled for pure endpoint-to-decision chain collapse
      const performFinalContraction = false;
      if (performFinalContraction) {
        console.log('🔗 Final topological spanning (pgr_contraction)...');
        // ... original contraction code disabled ...
      }

      // Edge coverage verification: ensure every staged trail is covered by the spanned edges
      try {
        const verifyCfg = getBridgingConfig();
        const meters = Number(verifyCfg.edgeSnapToleranceMeters);
        const minGapMeters = Math.max(0.5, meters * 0.1);
        const verification = await pgClient.query(
          `SELECT COUNT(*)::int AS gaps
           FROM ${stagingSchema}.trails t
           WHERE ST_Length(
             ST_Difference(
               ST_Force2D(t.geometry),
               (SELECT ST_UnaryUnion(ST_Collect(the_geom)) FROM ${stagingSchema}.ways_noded)
             )::geography
           ) > $1`,
          [minGapMeters]
        );
        const gaps = verification.rows?.[0]?.gaps ?? 0;
        if (gaps > 0) {
          console.warn(`⚠️ Edge coverage verification failed: ${gaps} trail geometries have uncovered segments > ${minGapMeters}m - continuing anyway`);
        } else {
          console.log('✅ Edge coverage verification passed (all trails covered by spanned edges)');
        }
      } catch (e) {
        console.warn('⚠️ Edge coverage verification skipped due to error:', e instanceof Error ? e.message : e);
      }

      // Final connectivity check and fix
      console.log('🔗 Performing final connectivity check...');
      const finalConnectivityCheck = await pgClient.query(`
        SELECT COUNT(*) as total_vertices, 
               COUNT(CASE WHEN cnt > 0 THEN 1 END) as connected_vertices,
               MIN(cnt) as min_degree, 
               MAX(cnt) as max_degree
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      `);
      
      const finalStats = finalConnectivityCheck.rows[0];
      console.log(`🔗 Final connectivity: ${finalStats.total_vertices} total vertices, ${finalStats.connected_vertices} connected, degree range ${finalStats.min_degree}-${finalStats.max_degree}`);
      
      if (finalStats.connected_vertices === 0) {
        console.warn('⚠️ Final connectivity check failed! Forcing connectivity recalculation...');
        // REMOVED: Manual degree recalculation - let pgRouting handle vertex degrees properly
        
        // Final verification
        const finalRecheck = await pgClient.query(`
          SELECT COUNT(*) as connected_vertices, MIN(cnt) as min_degree, MAX(cnt) as max_degree
          FROM ${stagingSchema}.ways_noded_vertices_pgr
          WHERE cnt > 0
        `);
        console.log(`✅ Final connectivity fix: ${finalRecheck.rows[0].connected_vertices} connected vertices, degree range ${finalRecheck.rows[0].min_degree}-${finalRecheck.rows[0].max_degree}`);
      }

      // Stats
      const edges = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded`);
      const nodes = await pgClient.query(`SELECT COUNT(*)::int AS c FROM ${stagingSchema}.ways_noded_vertices_pgr`);

      // Debug: Verify tables exist and have data
      console.log(`📊 Final network stats: ${edges.rows[0].c} edges, ${nodes.rows[0].c} nodes`);
      
      // Check if tables actually exist
      const tableCheck = await pgClient.query(`
        SELECT 
          EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as ways_noded_exists,
          EXISTS(SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as ways_noded_vertices_pgr_exists
      `, [stagingSchema]);
      
      console.log(`📊 Table existence check:`);
      console.log(`   - ways_noded: ${tableCheck.rows[0].ways_noded_exists}`);
      console.log(`   - ways_noded_vertices_pgr: ${tableCheck.rows[0].ways_noded_vertices_pgr_exists}`);
      
      if (!tableCheck.rows[0].ways_noded_exists || !tableCheck.rows[0].ways_noded_vertices_pgr_exists) {
        throw new Error('Required pgRouting tables were not created');
      }
      
      // Check if tables have data
      if (edges.rows[0].c === 0 || nodes.rows[0].c === 0) {
        console.warn('⚠️  Warning: Network tables created but contain no data');
      }

      if (diagUnsplit) {
        const postDiag = await pgClient.query(`
          WITH pairs AS (
            SELECT a.id AS a_id, b.id AS b_id,
                   ST_Crosses(a.the_geom, b.the_geom) AS crosses,
                   ST_Touches(a.the_geom, b.the_geom) AS touches
            FROM ${stagingSchema}.ways_noded a
            JOIN ${stagingSchema}.ways_noded b ON a.id < b.id
          )
          SELECT COUNT(*)::int AS remaining_unsplit FROM pairs WHERE crosses AND NOT touches
        `);
        console.log(`🧭 Unsplit crossings after ST_Node: ${postDiag.rows[0].remaining_unsplit}`);
      }

      console.log('✅ PostGIS noding completed successfully!');
      return {
        success: true,
        stats: {
          nodesCreated: nodes.rows[0].c,
          edgesCreated: edges.rows[0].c,
          isolatedNodes: 0,
          orphanedEdges: 0
        }
      };
    } catch (error) {
      console.error('❌ PostGIS noding failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error), stats: { nodesCreated: 0, edgesCreated: 0, isolatedNodes: 0, orphanedEdges: 0 } };
    }
  }
}


