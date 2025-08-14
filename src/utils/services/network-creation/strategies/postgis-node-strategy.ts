import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';
import { runGapMidpointBridging } from '../gap-midpoint-bridging';
import { runTrailLevelBridging } from '../trail-level-bridging';
import { runPostNodingSnap } from '../post-noding-snap';
import { runConnectorEdgeSpanning } from '../connector-edge-spanning';
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
        SELECT id AS old_id, ST_Force2D(the_geom) AS geom, app_uuid, name, length_km, elevation_gain, elevation_loss
        FROM ${stagingSchema}.ways
        WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
      `);
      
      const ways2dCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_2d`);
      console.log(`📊 Created ways_2d table with ${ways2dCount.rows[0].count} rows`);

      if (diagUnsplit) {
        console.log('🔎 Diagnosing unsplit X crossings (pre-noding)...');
        const diag = await pgClient.query(`
          WITH pairs AS (
            SELECT a.old_id AS a_id, b.old_id AS b_id,
                   ST_Crosses(a.geom, b.geom) AS crosses,
                   ST_Touches(a.geom, b.geom) AS touches
            FROM ${stagingSchema}.ways_2d a
            JOIN ${stagingSchema}.ways_2d b ON a.old_id < b.old_id
          )
          SELECT COUNT(*)::int AS unsplit_count FROM pairs WHERE crosses AND NOT touches
        `);
        console.log(`🧭 Unsplit crossings before ST_Node: ${diag.rows[0].unsplit_count}`);
      }

      // Perform global noding to split edges at ALL intersections (not just self-intersections)
      console.log('🔗 Performing global noding to split edges at intersections...');
      
      // First, create a temporary table with all geometries for global noding
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.temp_noded_geometries`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.temp_noded_geometries AS
        SELECT 
          (ST_Dump(ST_Node(ST_Collect(geom)))).*
        FROM ${stagingSchema}.ways_2d
      `);
      
      // Now create the split trails table with proper intersection splitting
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.split_trails_noded`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.split_trails_noded AS
        SELECT 
          row_number() OVER () AS id,
          tng.geom::geometry(LINESTRING,4326) AS the_geom,
          w.old_id,
          w.app_uuid,
          w.name,
          ST_Length(tng.geom::geography)/1000.0 AS length_km,
          w.elevation_gain,
          w.elevation_loss
        FROM ${stagingSchema}.temp_noded_geometries tng
        JOIN ${stagingSchema}.ways_2d w ON ST_Intersects(tng.geom, w.geom)
        WHERE GeometryType(tng.geom) = 'LINESTRING' 
          AND ST_NumPoints(tng.geom) > 1
          AND ST_Length(tng.geom::geography) > 0
        ORDER BY w.old_id, tng.path
      `);
      
      // Clean up temporary table
      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.temp_noded_geometries`);

      // Build routing tables
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
          old_id,
          1 AS sub_id
        FROM ${stagingSchema}.split_trails_noded
        WHERE the_geom IS NOT NULL AND ST_NumPoints(the_geom) > 1
      `);
      await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom)`);
      
      // Initialize edge trail composition tracking immediately after ways_noded is created
      console.log('📋 Initializing edge trail composition tracking...');
      const { EdgeCompositionTracking } = await import('../edge-composition-tracking');
      const compositionTracking = new EdgeCompositionTracking(stagingSchema, pgClient);
      await compositionTracking.createCompositionTable();
      const compositionCount = await compositionTracking.initializeCompositionFromSplitTrails();
      console.log(`✅ Initialized composition tracking for ${compositionCount} edge-trail relationships`);
      
      // Validate composition data integrity
      const compositionValidation = await compositionTracking.validateComposition();
      if (!compositionValidation.valid) {
        console.warn(`⚠️ Composition validation issues: ${compositionValidation.issues.join(', ')}`);
      } else {
        console.log('✅ Composition data integrity validated');
      }
      
      // Simplify edge geometries to reduce complexity while preserving shape
      // This helps reduce the number of points in edges created by the noding process
      try {
        console.log('🔧 Simplifying edge geometries...');
        const simplificationConfig = getBridgingConfig();
        const toleranceDegrees = simplificationConfig.geometrySimplification?.simplificationToleranceDegrees || 0.00001;
        const minPoints = simplificationConfig.geometrySimplification?.minPointsForSimplification || 10;
        
        await pgClient.query(`
          UPDATE ${stagingSchema}.ways_noded 
          SET the_geom = ST_SimplifyPreserveTopology(the_geom, $1)
          WHERE ST_NumPoints(the_geom) > $2
        `, [toleranceDegrees, minPoints]);
        
        // Recalculate length after simplification
        await pgClient.query(`
          UPDATE ${stagingSchema}.ways_noded 
          SET length_km = ST_Length(the_geom::geography) / 1000.0
        `);
        
        console.log(`✅ Edge geometry simplification completed (tolerance: ${toleranceDegrees}°, min points: ${minPoints})`);
      } catch (e) {
        console.warn('⚠️ Edge geometry simplification skipped due to error:', e instanceof Error ? e.message : e);
      }

      // Post-spanning vertex reconciliation to eliminate near-duplicate vertices
      try {
        const reconTolMeters = Number(getBridgingConfig().edgeSnapToleranceMeters);
        const reconTolDegrees = reconTolMeters / 111320.0;
        // Snap edges to vertex union again
        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded SET the_geom = ST_Snap(
              the_geom,
              (SELECT ST_UnaryUnion(ST_Collect(the_geom)) FROM ${stagingSchema}.ways_noded_vertices_pgr),
              $1
           )`,
          [reconTolDegrees]
        );
        // Merge vertices within tolerance and remap endpoints
        const vmerge = await runPostNodingVertexMerge(pgClient, stagingSchema, reconTolMeters);
        console.log(`🔧 Post-span vertex merge: merged=${vmerge.mergedVertices}, remapSrc=${vmerge.remappedSources}, remapTgt=${vmerge.remappedTargets}, deletedOrphans=${vmerge.deletedOrphans}`);
      } catch (e) {
        console.warn('⚠️ Post-span vertex reconciliation skipped due to error:', e instanceof Error ? e.message : e);
      }

      await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr`);
      await pgClient.query(`
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          row_number() OVER () AS id,
          ST_Force2D(geom)::geometry(Point,4326) AS the_geom,
          0::int AS cnt,
          0::int AS chk,
          0::int AS ein,
          0::int AS eout
        FROM (
          SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_noded
          UNION ALL
          SELECT DISTINCT ST_EndPoint(the_geom)   AS geom FROM ${stagingSchema}.ways_noded
        ) pts
      `);

      await pgClient.query(`ALTER TABLE ${stagingSchema}.ways_noded ADD COLUMN source integer, ADD COLUMN target integer`);
      // Assign nearest vertex IDs to every edge endpoint with distance validation
      // Build nearest start/end vertex maps using temp tables (avoid WITH-UPDATE syntax issues)
      const mergeCfg = getBridgingConfig();
      const vertexAssignmentTolerance = Number(mergeCfg.edgeSnapToleranceMeters) / 111320.0; // search radius from config
      const maxConnectionDistance = Number(mergeCfg.edgeSnapToleranceMeters) / 111320.0; // gate from config
      await pgClient.query(`DROP TABLE IF EXISTS tmp_start_nearest`);
      await pgClient.query(`CREATE TEMP TABLE tmp_start_nearest AS
        SELECT wn.id AS edge_id,
               (
                 SELECT v.id
                 FROM ${stagingSchema}.ways_noded_vertices_pgr v
                 WHERE ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom)) <= $1
                 ORDER BY ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom)) ASC
                 LIMIT 1
               ) AS node_id,
               (
                 SELECT ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom))
                 FROM ${stagingSchema}.ways_noded_vertices_pgr v
                 WHERE ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom)) <= $1
                 ORDER BY ST_Distance(v.the_geom, ST_StartPoint(wn.the_geom)) ASC
                 LIMIT 1
               ) AS distance
        FROM ${stagingSchema}.ways_noded wn`, [vertexAssignmentTolerance]);
      await pgClient.query(`DROP TABLE IF EXISTS tmp_end_nearest`);
      await pgClient.query(`CREATE TEMP TABLE tmp_end_nearest AS
        SELECT wn.id AS edge_id,
               (
                 SELECT v.id
                 FROM ${stagingSchema}.ways_noded_vertices_pgr v
                 WHERE ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom)) <= $1
                 ORDER BY ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom)) ASC
                 LIMIT 1
               ) AS node_id,
               (
                 SELECT ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom))
                 FROM ${stagingSchema}.ways_noded_vertices_pgr v
                 WHERE ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom)) <= $1
                 ORDER BY ST_Distance(v.the_geom, ST_EndPoint(wn.the_geom)) ASC
                 LIMIT 1
               ) AS distance
        FROM ${stagingSchema}.ways_noded wn`, [vertexAssignmentTolerance]);
      // Apply vertex assignment with distance validation
      const assignmentResult = await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded wn
        SET source = sn.node_id,
            target = en.node_id
        FROM tmp_start_nearest sn
        JOIN tmp_end_nearest en ON en.edge_id = sn.edge_id
        WHERE wn.id = sn.edge_id
          AND sn.distance <= $1  -- Only connect if startpoint is within 1 meter
          AND en.distance <= $1  -- Only connect if endpoint is within 1 meter
        RETURNING wn.id
      `, [maxConnectionDistance]);
      
      // Count rejected connections
      const rejectedResult = await pgClient.query(`
        SELECT COUNT(*) as rejected_count
        FROM ${stagingSchema}.ways_noded wn
        LEFT JOIN tmp_start_nearest sn ON wn.id = sn.edge_id
        LEFT JOIN tmp_end_nearest en ON wn.id = en.edge_id
        WHERE (sn.distance > $1 OR en.distance > $1 OR sn.node_id IS NULL OR en.node_id IS NULL)
      `, [maxConnectionDistance]);
      
      console.log(`🔗 Vertex assignment: connected=${assignmentResult.rowCount}, rejected=${rejectedResult.rows[0].rejected_count} (distance > 1m)`);

      // Remove degenerate/self-loop/invalid edges before proceeding
      await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE the_geom IS NULL OR ST_NumPoints(the_geom) < 2 OR ST_Length(the_geom::geography) = 0`);
      await pgClient.query(`DELETE FROM ${stagingSchema}.ways_noded WHERE source IS NULL OR target IS NULL OR source = target`);

      // Recompute node degree after cleanup (ignore edges <= 1m)
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
          WHERE (e.source = v.id OR e.target = v.id)
            AND ST_Length(e.the_geom::geography) > 1.0
        )
      `);

      // Recompute node degree (cnt) to ensure accuracy before contraction (ignore edges <= 1m)
      await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
          WHERE (e.source = v.id OR e.target = v.id)
            AND ST_Length(e.the_geom::geography) > 1.0
        )
      `);

      // Harden 2D everywhere prior to snapping/welding
      await pgClient.query(`UPDATE ${stagingSchema}.ways_noded SET the_geom = ST_Force2D(the_geom)`);
      await pgClient.query(`UPDATE ${stagingSchema}.ways_noded_vertices_pgr SET the_geom = ST_Force2D(the_geom)`);

      // (Old complex chain-walk removed in favor of final greedy spanning below)

      // Trail-level bridging moved to Layer 1 - this is Layer 2 (node/edge processing only)
      console.log('🧵 Trail-level bridging: DISABLED - this is Layer 2 (node/edge processing only)');

      // Post-noding snap to ensure connectors align with vertices (defaults from config)
      try {
        const bridgingCfg = getBridgingConfig();
        // Use edge snap/weld tolerance (meters) for post-noding snap/merge/spanning steps
        const tolMeters = Number(bridgingCfg.edgeSnapToleranceMeters);
        
        // OPTIMIZATION: Add missing spatial indices before expensive spatial operations
        console.log('🔍 Adding spatial indices for post-noding snap optimization...');
        await pgClient.query(`
          CREATE INDEX IF NOT EXISTS idx_ways_noded_geom ON ${stagingSchema}.ways_noded USING GIST(the_geom);
          CREATE INDEX IF NOT EXISTS idx_ways_noded_vertices_geom ON ${stagingSchema}.ways_noded_vertices_pgr USING GIST(the_geom);
          CREATE INDEX IF NOT EXISTS idx_ways_noded_source ON ${stagingSchema}.ways_noded(source);
          CREATE INDEX IF NOT EXISTS idx_ways_noded_target ON ${stagingSchema}.ways_noded(target);
        `);
        console.log('✅ Spatial indices created for optimization');
        
        const snapRes = await runPostNodingSnap(pgClient, stagingSchema, tolMeters);
        console.log(`🔧 Post-noding snap: start=${snapRes.snappedStart}, end=${snapRes.snappedEnd}`);

        // Ensure an explicit connector-spanning edge exists between nearest vertices
        const spanRes = await runConnectorEdgeSpanning(pgClient, stagingSchema, tolMeters);
        console.log(`🧵 Connector edge spanning: matched=${spanRes.matched}, inserted=${spanRes.inserted}`);

        // Collapse connectors early so they don't create artificial degree-3 decisions
        try {
          const earlyCollapseRes = await runConnectorEdgeCollapse(pgClient, stagingSchema);
          console.log(`🧵 Early connector collapse: collapsed=${earlyCollapseRes.collapsed}, deleted=${earlyCollapseRes.deletedConnectors}`);
        } catch (e) {
          console.warn('⚠️ Early connector collapse skipped due to error:', e instanceof Error ? e.message : e);
        }

        // KNN-based vertex snap/merge (no DBSCAN dependency)
        const epsDeg = Number(getBridgingConfig().edgeSnapToleranceMeters) / 111320.0;
        await pgClient.query(`DROP TABLE IF EXISTS "__vertex_rep_map"`);
        await pgClient.query(
          `CREATE TEMP TABLE "__vertex_rep_map" AS
           SELECT v.id AS vertex_id,
                  COALESCE(
                    (
                      SELECT MIN(v2.id)
                      FROM ${stagingSchema}.ways_noded_vertices_pgr v2
                      WHERE ST_DWithin(v.the_geom, v2.the_geom, $1)
                    ),
                    v.id
                  ) AS rep_id
           FROM ${stagingSchema}.ways_noded_vertices_pgr v`,
          [epsDeg]
        );

        await pgClient.query(`DROP TABLE IF EXISTS "__vertex_reps"`);
        await pgClient.query(
          `CREATE TEMP TABLE "__vertex_reps" AS
           SELECT m.rep_id,
                  vrep.the_geom AS rep_geom
           FROM (SELECT DISTINCT rep_id FROM "__vertex_rep_map") m
           JOIN ${stagingSchema}.ways_noded_vertices_pgr vrep ON vrep.id = m.rep_id`
        );

        // Update representative vertex geometry
        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
           SET the_geom = r.rep_geom
           FROM "__vertex_reps" r
           WHERE v.id = r.rep_id`
        );

        // Remap edges' source/target to representative ids
        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded e
           SET source = m.rep_id
           FROM "__vertex_rep_map" m
           WHERE e.source = m.vertex_id AND e.source <> m.rep_id`
        );
        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded e
           SET target = m.rep_id
           FROM "__vertex_rep_map" m
           WHERE e.target = m.vertex_id AND e.target <> m.rep_id`
        );

        // Recompute cnt after KNN merge (ignore edges <= 1m)
        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
           SET cnt = (
             SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
             WHERE (e.source = v.id OR e.target = v.id)
               AND ST_Length(e.the_geom::geography) > 1.0
           )`
        );

        // Post-KNN re-snap edges to updated vertex positions and recompute endpoints
        try {
          const resnapTolDeg = Number(getBridgingConfig().edgeSnapToleranceMeters) / 111320.0;
          await pgClient.query(
            `UPDATE ${stagingSchema}.ways_noded
             SET the_geom = ST_Snap(
               the_geom,
               (SELECT ST_UnaryUnion(ST_Collect(the_geom)) FROM ${stagingSchema}.ways_noded_vertices_pgr),
               $1
             )`,
            [resnapTolDeg]
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

          await pgClient.query(
            `UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
             SET cnt = (
               SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
               WHERE e.source = v.id OR e.target = v.id
             )`
          );
          console.log('🔧 Post-KNN re-snap and endpoint recompute completed');
        } catch (e) {
          console.warn('⚠️ Post-KNN re-snap skipped due to error:', e instanceof Error ? e.message : e);
        }
      } catch (e) {
        console.warn('⚠️ Post-noding snap step skipped due to error:', e instanceof Error ? e.message : e);
      }

      // Always run degree-2 chain compaction, even if the snap block above failed
      try {
        const compactRes = await runEdgeCompaction(pgClient, stagingSchema);
        console.log(`🧱 Edge compaction: chains=${compactRes.chainsCreated}, compacted=${compactRes.edgesCompacted}, remaining=${compactRes.edgesRemaining}, finalEdges=${compactRes.finalEdges}`);
      } catch (e) {
        console.warn('⚠️ Edge compaction skipped:', e instanceof Error ? e.message : e);
      }

      // Deduplicate edges first (prerequisite for correct vertex degree calculation)
      try {
        const edgeDeduplicationResult = await deduplicateEdges(pgClient, stagingSchema);
        console.log(`🔄 Edge deduplication: duplicatesRemoved=${edgeDeduplicationResult.duplicatesRemoved}, finalEdges=${edgeDeduplicationResult.finalEdges}`);
      } catch (e) {
        console.warn('⚠️ Edge deduplication skipped:', e instanceof Error ? e.message : e);
      }

      // Merge coincident vertices next (prerequisite for proper degree-2 chain merging)
      try {
        const mergeConfig = getBridgingConfig();
        const toleranceMeters = Number(mergeConfig.edgeSnapToleranceMeters);
        const coincidentResult = await mergeCoincidentVertices(pgClient, stagingSchema, toleranceMeters);
        console.log(`🔗 Coincident vertex merge: verticesMerged=${coincidentResult.verticesMerged}, finalVertices=${coincidentResult.finalVertices}, finalEdges=${coincidentResult.finalEdges}`);
      } catch (e) {
        console.warn('⚠️ Coincident vertex merge skipped:', e instanceof Error ? e.message : e);
      }

      // Clean up short connectors to dead-end nodes (prevents artificial degree-3 vertices)
      try {
        const scCfg = getBridgingConfig();
        const shortConnectorResult = await cleanupShortConnectors(
          pgClient,
          stagingSchema,
          Number(scCfg.shortConnectorMaxLengthMeters)
        );
        console.log(`🧹 Short connector cleanup: connectorsRemoved=${shortConnectorResult.connectorsRemoved}, deadEndNodesRemoved=${shortConnectorResult.deadEndNodesRemoved}, finalEdges=${shortConnectorResult.finalEdges}`);
      } catch (e) {
        console.warn('⚠️ Short connector cleanup skipped:', e instanceof Error ? e.message : e);
      }

      // Merge degree-2 chains (geometry-only solution) with atomic fixpoint loop
      // RE-ENABLED: Complex degree-2 merging needed for chains through degree-3 vertices
      try {
        console.log('🔄 Starting atomic multi-pass degree-2 chain merge...');
        let totalChainsMerged = 0;
        let totalEdgesRemoved = 0;
        let iteration = 0;
        const maxIterations = 8; // Prevent infinite loops

        // Get a dedicated client for the atomic transaction
        const client = await pgClient.connect();
        
        try {
          // Begin single atomic transaction for entire fixpoint loop
          await client.query('BEGIN');
          console.log('🔒 Started atomic transaction for degree-2 chain merging');
          
          while (iteration < maxIterations) {
            iteration++;
            console.log(`🔗 Degree-2 chain merge pass ${iteration}...`);
            
            const chainMergeResult = await mergeDegree2Chains(client, stagingSchema);
            console.log(`   Pass ${iteration}: chainsMerged=${chainMergeResult.chainsMerged}, edgesRemoved=${chainMergeResult.edgesRemoved}, finalEdges=${chainMergeResult.finalEdges}`);
            
            totalChainsMerged += chainMergeResult.chainsMerged;
            totalEdgesRemoved += chainMergeResult.edgesRemoved;
            
            // Stop if no more chains were merged (fixpoint reached)
            if (chainMergeResult.chainsMerged === 0) {
              console.log(`✅ Fixpoint reached after ${iteration} passes - no more chains to merge`);
              break;
            }
          }
          
          if (iteration >= maxIterations) {
            console.log(`⚠️ Stopped after ${maxIterations} iterations to prevent infinite loops`);
          }
          
          // Commit the entire atomic transaction
          await client.query('COMMIT');
          console.log('✅ Committed atomic transaction for degree-2 chain merging');
          
          console.log(`🔗 Atomic multi-pass degree-2 chain merge complete: totalChainsMerged=${totalChainsMerged}, totalEdgesRemoved=${totalEdgesRemoved}`);
          
        } catch (error) {
          // Rollback on any error
          await client.query('ROLLBACK');
          console.error('❌ Rolled back degree-2 chain merge transaction due to error:', error);
          throw error;
        } finally {
          // Always release the client
          client.release();
        }
        
      } catch (e) {
        console.warn('⚠️ Degree-2 chain merge skipped:', e instanceof Error ? e.message : e);
      }



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

        await pgClient.query(
          `UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
           SET cnt = (
             SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
             WHERE e.source = v.id OR e.target = v.id
           )`
        );
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


