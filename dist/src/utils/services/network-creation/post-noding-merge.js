"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPostNodingVertexMerge = runPostNodingVertexMerge;
/**
 * Merge vertices within a tolerance so adjacent edges share the same vertex ID.
 * This resolves tiny gaps where endpoints are near-coincident but not identical.
 */
async function runPostNodingVertexMerge(pgClient, stagingSchema, toleranceMeters) {
    const tolDegrees = toleranceMeters / 111320; // approximate for small distances in EPSG:4326
    // Build mapping from each vertex to its canonical vertex (min id in cluster)
    // Build clusters in temp tables (unqualified temp names)
    await pgClient.query(`CREATE TEMP TABLE __vertex_clusters ON COMMIT DROP AS
     SELECT id, the_geom,
            ST_ClusterDBSCAN(the_geom, $1, 2) OVER () AS cid
     FROM ${stagingSchema}.ways_noded_vertices_pgr`, [tolDegrees]);
    await pgClient.query(`CREATE TEMP TABLE __vertex_merge_map ON COMMIT DROP AS
     WITH canon AS (
       SELECT cid, MIN(id) AS canonical_id
       FROM __vertex_clusters
       WHERE cid IS NOT NULL
       GROUP BY cid
     )
     SELECT vc.id AS vertex_id, c.canonical_id
     FROM __vertex_clusters vc
     JOIN canon c ON vc.cid = c.cid`);
    await pgClient.query(`CREATE INDEX ON __vertex_merge_map(vertex_id)`);
    await pgClient.query(`CREATE INDEX ON __vertex_merge_map(canonical_id)`);
    // Remap sources/targets to canonical ids
    const srcRes = await pgClient.query(`
    WITH upd AS (
      UPDATE ${stagingSchema}.ways_noded w
      SET source = m.canonical_id
      FROM __vertex_merge_map m
      WHERE w.source = m.vertex_id AND w.source <> m.canonical_id
      RETURNING 1
    ) SELECT COUNT(*)::int AS c FROM upd;
  `);
    const tgtRes = await pgClient.query(`
    WITH upd AS (
      UPDATE ${stagingSchema}.ways_noded w
      SET target = m.canonical_id
      FROM __vertex_merge_map m
      WHERE w.target = m.vertex_id AND w.target <> m.canonical_id
      RETURNING 1
    ) SELECT COUNT(*)::int AS c FROM upd;
  `);
    // Recompute degrees
    await pgClient.query(`
    UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
    SET cnt = (
      SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e WHERE e.source = v.id OR e.target = v.id
    );
  `);
    // Delete orphan vertices that are no longer referenced
    const delRes = await pgClient.query(`
    WITH del AS (
      DELETE FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded e WHERE e.source = v.id OR e.target = v.id
      )
      RETURNING 1
    ) SELECT COUNT(*)::int AS c FROM del;
  `);
    // Count merged vertices = number of non-canonical remapped at least once (approx: deleted orphans + distinct remapped ids)
    const mergedVertices = delRes.rows[0]?.c || 0;
    return {
        mergedVertices,
        remappedSources: srcRes.rows[0]?.c || 0,
        remappedTargets: tgtRes.rows[0]?.c || 0,
        deletedOrphans: delRes.rows[0]?.c || 0
    };
}
//# sourceMappingURL=post-noding-merge.js.map