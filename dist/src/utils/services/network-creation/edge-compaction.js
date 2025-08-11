"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEdgeCompaction = runEdgeCompaction;
/**
 * Merge degree-2 chains into single edges.
 * This function looks for pairs of edges connected through degree-2 vertices
 * and merges them into single continuous edges.
 */
async function runEdgeCompaction(pgClient, stagingSchema) {
    try {
        console.log('🔍 Looking for simple degree-2 chains...');
        // Find simple degree-2 chains (two edges connected through a degree-2 vertex)
        const simpleChainsResult = await pgClient.query(`
      WITH deg AS (
        SELECT id, cnt FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      simple_chains AS (
        SELECT 
          e1.id as edge1_id,
          e2.id as edge2_id,
          e1.source as start_vertex,
          e2.target as end_vertex,
          e1.the_geom as geom1,
          e2.the_geom as geom2,
          e1.name as name1,
          e2.name as name2
        FROM ${stagingSchema}.ways_noded e1
        JOIN ${stagingSchema}.ways_noded e2 ON (
          e1.target = e2.source OR 
          e1.source = e2.target OR 
          e1.target = e2.target OR 
          e1.source = e2.source
        )
        JOIN deg d ON (
          (e1.target = e2.source AND d.id = e1.target) OR
          (e1.source = e2.target AND d.id = e1.source) OR
          (e1.target = e2.target AND d.id = e1.target) OR
          (e1.source = e2.source AND d.id = e1.source)
        )
        WHERE d.cnt = 2 
          AND e1.id < e2.id
          AND e1.name = e2.name  -- Only merge edges with same trail name
      )
      SELECT COUNT(*) as simple_chains_found
      FROM simple_chains
    `);
        const simpleChainsFound = simpleChainsResult.rows[0]?.simple_chains_found || 0;
        console.log(`🔍 Found ${simpleChainsFound} simple degree-2 chains`);
        if (simpleChainsFound > 0) {
            // Perform simple degree-2 chain merging
            console.log('🔗 Merging simple degree-2 chains...');
            // Create merged edges from simple chains
            await pgClient.query(`
        DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_merged_simple;
        CREATE TABLE ${stagingSchema}.ways_noded_merged_simple AS
        WITH deg AS (
          SELECT id, cnt FROM ${stagingSchema}.ways_noded_vertices_pgr
        ),
        -- Find simple degree-2 chains (pairs of edges)
        simple_chains AS (
          SELECT 
            e1.id as edge1_id,
            e2.id as edge2_id,
            e1.source as start_vertex,
            e2.target as end_vertex,
            e1.the_geom as geom1,
            e2.the_geom as geom2,
            e1.name as name1,
            e2.name as name2
          FROM ${stagingSchema}.ways_noded e1
          JOIN ${stagingSchema}.ways_noded e2 ON (
            e1.target = e2.source AND e1.name = e2.name
          )
          JOIN deg d ON d.id = e1.target
          WHERE d.cnt = 2 
            AND e1.id < e2.id
        ),
        merged_edges AS (
          SELECT 
            row_number() OVER () AS id,
            start_vertex as source,
            end_vertex as target,
            ST_LineMerge(ST_Union(ST_SnapToGrid(geom1, 1e-7), ST_SnapToGrid(geom2, 1e-7)))::geometry(LINESTRING,4326) AS the_geom,
            ST_Length(ST_LineMerge(ST_Union(ST_SnapToGrid(geom1, 1e-7), ST_SnapToGrid(geom2, 1e-7)))) / 1000.0 AS length_km,
            name1 as name
          FROM simple_chains
        ),
        remaining_edges AS (
          SELECT 
            w.id,
            w.source,
            w.target,
            w.the_geom,
            ST_Length(w.the_geom::geography) / 1000.0 AS length_km,
            w.app_uuid,
            w.name,
            w.elevation_gain,
            w.elevation_loss,
            w.old_id,
            w.sub_id
          FROM ${stagingSchema}.ways_noded w
          WHERE NOT EXISTS (
            SELECT 1 FROM simple_chains sc 
            WHERE w.id = sc.edge1_id OR w.id = sc.edge2_id
          )
        )
        SELECT 
          row_number() OVER () AS id,
          source,
          target,
          the_geom,
          length_km,
          NULL::text AS app_uuid,
          name,
          0.0::double precision AS elevation_gain,
          0.0::double precision AS elevation_loss,
          NULL::bigint AS old_id,
          1::int AS sub_id
        FROM merged_edges
        UNION ALL
        SELECT 
          (SELECT COUNT(*) FROM merged_edges) + row_number() OVER (ORDER BY id) AS id,
          source,
          target,
          the_geom,
          length_km,
          app_uuid,
          name,
          elevation_gain,
          elevation_loss,
          old_id,
          sub_id
        FROM remaining_edges
      `);
            // Replace the original table
            await pgClient.query(`
        DROP TABLE IF EXISTS ${stagingSchema}.ways_noded;
        ALTER TABLE ${stagingSchema}.ways_noded_merged_simple RENAME TO ways_noded;
      `);
            // Rebuild vertices and refresh degree counts
            await pgClient.query(`
        DROP TABLE IF EXISTS ${stagingSchema}.ways_noded_vertices_pgr;
        CREATE TABLE ${stagingSchema}.ways_noded_vertices_pgr AS
        SELECT 
          row_number() OVER () AS id,
          geom AS the_geom,
          0::int AS cnt,
          0::int AS chk,
          0::int AS ein,
          0::int AS eout
        FROM (
          SELECT DISTINCT ST_StartPoint(the_geom) AS geom FROM ${stagingSchema}.ways_noded
          UNION ALL
          SELECT DISTINCT ST_EndPoint(the_geom)   AS geom FROM ${stagingSchema}.ways_noded
        ) pts;
      `);
            // Add source/target columns and populate them
            await pgClient.query(`
        ALTER TABLE ${stagingSchema}.ways_noded DROP COLUMN IF EXISTS source;
        ALTER TABLE ${stagingSchema}.ways_noded DROP COLUMN IF EXISTS target;
        ALTER TABLE ${stagingSchema}.ways_noded ADD COLUMN source integer, ADD COLUMN target integer;
      `);
            await pgClient.query(`
        WITH start_nearest AS (
          SELECT wn.id AS edge_id,
                 (
                   SELECT v.id
                   FROM ${stagingSchema}.ways_noded_vertices_pgr v
                   ORDER BY ST_Distance(v.the_geom::geography, ST_StartPoint(wn.the_geom)::geography) ASC
                   LIMIT 1
                 ) AS node_id
          FROM ${stagingSchema}.ways_noded wn
        ),
        end_nearest AS (
          SELECT wn.id AS edge_id,
                 (
                   SELECT v.id
                   FROM ${stagingSchema}.ways_noded_vertices_pgr v
                   ORDER BY ST_Distance(v.the_geom::geography, ST_EndPoint(wn.the_geom)::geography) ASC
                   LIMIT 1
                 ) AS node_id
          FROM ${stagingSchema}.ways_noded wn
        )
        UPDATE ${stagingSchema}.ways_noded wn
        SET source = sn.node_id,
            target = en.node_id
        FROM start_nearest sn
        JOIN end_nearest en ON en.edge_id = sn.edge_id
        WHERE wn.id = sn.edge_id;
      `);
            // Update degree counts
            await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*)
          FROM ${stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        );
      `);
            // Get final counts
            const finalCounts = await pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as final_edges,
          ${simpleChainsFound} as chains_created,
          ${simpleChainsFound * 2} as edges_compacted
      `);
            const finalEdges = finalCounts.rows[0]?.final_edges || 0;
            const chainsCreated = finalCounts.rows[0]?.chains_created || 0;
            const edgesCompacted = finalCounts.rows[0]?.edges_compacted || 0;
            console.log(`✅ Simple degree-2 chain merge complete: ${chainsCreated} chains created, ${edgesCompacted} edges compacted, ${finalEdges} final edges`);
            return {
                chainsCreated,
                edgesCompacted,
                edgesRemaining: finalEdges - chainsCreated,
                finalEdges
            };
        }
        else {
            console.log('ℹ️ No simple degree-2 chains found to merge');
            return {
                chainsCreated: 0,
                edgesCompacted: 0,
                edgesRemaining: 0,
                finalEdges: 0
            };
        }
    }
    catch (error) {
        console.error('❌ Error in edge compaction:', error);
        return {
            chainsCreated: 0,
            edgesCompacted: 0,
            edgesRemaining: 0,
            finalEdges: 0
        };
    }
}
//# sourceMappingURL=edge-compaction.js.map