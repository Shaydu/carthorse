"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeCoincidentVertices = mergeCoincidentVertices;
/**
 * Merge vertices that are geometrically coincident (within tolerance) but have different IDs.
 * This is a prerequisite for proper degree-2 chain merging.
 *
 * @param pgClient - PostgreSQL client
 * @param stagingSchema - Staging schema name
 * @param toleranceMeters - Tolerance in meters for merging vertices (default: 5m)
 */
async function mergeCoincidentVertices(pgClient, stagingSchema, toleranceMeters = 5.0) {
    console.log(`🔗 Merging coincident vertices within ${toleranceMeters}m tolerance...`);
    const toleranceDegrees = toleranceMeters / 111320.0; // Convert meters to degrees
    try {
        // Step 1: Find coincident vertex pairs
        const coincidentResult = await pgClient.query(`
      WITH coincident_pairs AS (
        SELECT
          v1.id as id1,
          v2.id as id2,
          ST_Distance(v1.the_geom::geography, v2.the_geom::geography) as distance_meters
        FROM ${stagingSchema}.ways_noded_vertices_pgr v1
        JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON v1.id < v2.id
        WHERE ST_DWithin(v1.the_geom, v2.the_geom, $1)
          AND ST_Distance(v1.the_geom::geography, v2.the_geom::geography) <= $2
      )
      SELECT COUNT(*) as pairs_found
      FROM coincident_pairs
    `, [toleranceDegrees, toleranceMeters]);
        const pairsFound = coincidentResult.rows[0]?.pairs_found || 0;
        if (pairsFound === 0) {
            console.log('ℹ️ No coincident vertices found within tolerance');
            return {
                verticesMerged: 0,
                edgesMerged: 0,
                finalVertices: 0,
                finalEdges: 0
            };
        }
        console.log(`🔗 Found ${pairsFound} coincident vertex pairs to merge`);
        // Step 2: Create a mapping table for vertex merging
        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.coincident_vertex_merge_map`);
        // First create the coincident pairs
        await pgClient.query(`
      CREATE TEMP TABLE temp_coincident_pairs AS
      SELECT
        v1.id as id1,
        v2.id as id2,
        ST_Distance(v1.the_geom::geography, v2.the_geom::geography) as distance_meters
      FROM ${stagingSchema}.ways_noded_vertices_pgr v1
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v2 ON v1.id < v2.id
      WHERE ST_DWithin(v1.the_geom, v2.the_geom, $1)
        AND ST_Distance(v1.the_geom::geography, v2.the_geom::geography) <= $2
    `, [toleranceDegrees, toleranceMeters]);
        // Then create the merge map
        await pgClient.query(`
      CREATE TABLE ${stagingSchema}.coincident_vertex_merge_map AS
      SELECT
        id1 as vertex_id,
        LEAST(id1, id2) as rep_id,
        ST_Centroid(ST_Collect(
          (SELECT the_geom FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id = id1),
          (SELECT the_geom FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id = id2)
        )) as rep_geom
      FROM temp_coincident_pairs
      UNION ALL
      SELECT
        id2 as vertex_id,
        LEAST(id1, id2) as rep_id,
        ST_Centroid(ST_Collect(
          (SELECT the_geom FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id = id1),
          (SELECT the_geom FROM ${stagingSchema}.ways_noded_vertices_pgr WHERE id = id2)
        )) as rep_geom
      FROM temp_coincident_pairs
    `);
        // Step 3: Update vertex geometries to the representative point
        await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET the_geom = m.rep_geom
      FROM ${stagingSchema}.coincident_vertex_merge_map m
      WHERE v.id = m.vertex_id AND v.id != m.rep_id
    `);
        // Step 4: Update edge source/target to point to representative vertices
        await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded e
      SET source = m.rep_id
      FROM ${stagingSchema}.coincident_vertex_merge_map m
      WHERE e.source = m.vertex_id AND e.source != m.rep_id
    `);
        await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded e
      SET target = m.rep_id
      FROM ${stagingSchema}.coincident_vertex_merge_map m
      WHERE e.target = m.vertex_id AND e.target != m.rep_id
    `);
        // Step 5: Remove duplicate vertices (keep only representatives)
        await pgClient.query(`
      DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE EXISTS (
        SELECT 1 FROM ${stagingSchema}.coincident_vertex_merge_map m
        WHERE v.id = m.vertex_id AND v.id != m.rep_id
      )
    `);
        // Step 6: Remove self-loops that may have been created
        await pgClient.query(`
      DELETE FROM ${stagingSchema}.ways_noded
      WHERE source = target
    `);
        // Step 7: Recompute vertex degrees
        await pgClient.query(`
      UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
        // Step 8: Get final counts
        const finalCounts = await pgClient.query(`
      SELECT
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as final_vertices,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as final_edges
    `);
        const finalVertices = finalCounts.rows[0]?.final_vertices || 0;
        const finalEdges = finalCounts.rows[0]?.final_edges || 0;
        // Clean up
        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.coincident_vertex_merge_map`);
        console.log(`✅ Merged ${pairsFound} coincident vertex pairs, resulting in ${finalVertices} vertices and ${finalEdges} edges`);
        return {
            verticesMerged: pairsFound,
            edgesMerged: 0, // We don't merge edges, just vertices
            finalVertices,
            finalEdges
        };
    }
    catch (error) {
        console.error('❌ Error merging coincident vertices:', error);
        throw error;
    }
}
//# sourceMappingURL=merge-coincident-vertices.js.map