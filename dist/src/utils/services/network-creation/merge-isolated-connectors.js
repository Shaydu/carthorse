"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeIsolatedConnectors = mergeIsolatedConnectors;
/**
 * Merge isolated connector endpoints into neighboring edges.
 * This specifically targets the issue where connector nodes appear as isolated endpoints
 * instead of being merged into continuous trails.
 */
async function mergeIsolatedConnectors(pgClient, stagingSchema) {
    console.log('🔗 Merging isolated connector endpoints...');
    try {
        const mergeResult = await pgClient.query(`
      WITH isolated_connector_vertices AS (
        -- Find vertices that are connected to exactly one edge and are at connector locations
        SELECT DISTINCT v.id AS vertex_id, v.the_geom, v.cnt
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        JOIN ${stagingSchema}.trails t ON ST_DWithin(v.the_geom, t.the_geom, 0.001)
        WHERE v.cnt = 1  -- degree 1 (endpoint)
          AND t.trail_type = 'connector'
      ),
      
      connector_edges AS (
        -- Find edges connected to these isolated connector vertices
        SELECT DISTINCT 
          e.id AS edge_id,
          e.source,
          e.target,
          e.the_geom,
          e.app_uuid,
          e.name,
          e.length_km,
          e.elevation_gain,
          e.elevation_loss,
          CASE 
            WHEN icv_src.vertex_id IS NOT NULL THEN icv_src.vertex_id
            WHEN icv_tgt.vertex_id IS NOT NULL THEN icv_tgt.vertex_id
            ELSE NULL
          END AS connector_vertex,
          CASE 
            WHEN icv_src.vertex_id IS NOT NULL THEN e.target
            WHEN icv_tgt.vertex_id IS NOT NULL THEN e.source
            ELSE NULL
          END AS other_vertex
        FROM ${stagingSchema}.ways_noded e
        LEFT JOIN isolated_connector_vertices icv_src ON e.source = icv_src.vertex_id
        LEFT JOIN isolated_connector_vertices icv_tgt ON e.target = icv_tgt.vertex_id
        WHERE icv_src.vertex_id IS NOT NULL OR icv_tgt.vertex_id IS NOT NULL
      ),
      
      -- Find neighboring edges that can be extended to absorb the connector
      neighbor_edges AS (
        SELECT 
          ce.edge_id AS connector_edge_id,
          ce.connector_vertex,
          ce.other_vertex,
          ne.id AS neighbor_edge_id,
          ne.source AS neighbor_source,
          ne.target AS neighbor_target,
          ne.the_geom AS neighbor_geom,
          ne.app_uuid AS neighbor_app_uuid,
          ne.name AS neighbor_name,
          ne.length_km AS neighbor_length,
          ne.elevation_gain AS neighbor_elevation_gain,
          ne.elevation_loss AS neighbor_elevation_loss,
          ce.the_geom AS connector_geom,
          ce.length_km AS connector_length,
          ce.elevation_gain AS connector_elevation_gain,
          ce.elevation_loss AS connector_elevation_loss
        FROM connector_edges ce
        JOIN ${stagingSchema}.ways_noded ne ON 
          (ne.source = ce.other_vertex OR ne.target = ce.other_vertex)
          AND ne.id <> ce.edge_id
        -- Prefer longer, more established trails over short connectors
        WHERE ne.app_uuid IS NOT NULL AND ne.length_km > ce.length_km * 2
      ),
      
      -- Create merged edges (extend neighbor edges to include connector geometry)
      merged_edges AS (
        SELECT DISTINCT ON (connector_edge_id)
          connector_edge_id,
          neighbor_edge_id,
          connector_vertex,
          neighbor_source,
          neighbor_target,
          -- Determine the proper endpoints for the merged edge
          CASE 
            WHEN neighbor_source = ce.other_vertex THEN ce.connector_vertex
            ELSE neighbor_source
          END AS new_source,
          CASE 
            WHEN neighbor_target = ce.other_vertex THEN ce.connector_vertex  
            ELSE neighbor_target
          END AS new_target,
          -- Merge geometries
          CASE
            WHEN neighbor_source = ce.other_vertex THEN 
              ST_LineMerge(ST_MakeLine(ce.connector_geom, ne.neighbor_geom))
            WHEN neighbor_target = ce.other_vertex THEN
              ST_LineMerge(ST_MakeLine(ne.neighbor_geom, ce.connector_geom))
            ELSE ne.neighbor_geom  -- fallback
          END AS merged_geom,
          ne.neighbor_length + ce.connector_length AS merged_length,
          ne.neighbor_elevation_gain + ce.connector_elevation_gain AS merged_elevation_gain,
          ne.neighbor_elevation_loss + ce.connector_elevation_loss AS merged_elevation_loss,
          ne.neighbor_app_uuid,
          ne.neighbor_name
        FROM neighbor_edges ne
        JOIN connector_edges ce ON ce.edge_id = ne.connector_edge_id
        ORDER BY connector_edge_id, ne.neighbor_length DESC  -- prefer longer neighbors
      ),
      
      -- Insert the merged edges
      inserted AS (
        INSERT INTO ${stagingSchema}.ways_noded (
          id, source, target, the_geom, length_km, elevation_gain, elevation_loss,
          app_uuid, name, old_id
        )
        SELECT 
          (SELECT COALESCE(MAX(id), 0) + ROW_NUMBER() OVER () FROM ${stagingSchema}.ways_noded) AS id,
          new_source,
          new_target, 
          merged_geom,
          merged_length,
          merged_elevation_gain,
          merged_elevation_loss,
          neighbor_app_uuid,
          'merged-connector-' || neighbor_name AS name,
          NULL::bigint AS old_id
        FROM merged_edges
        RETURNING id
      ),
      
      -- Delete the original edges that were merged
      deleted_connectors AS (
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE id IN (SELECT connector_edge_id FROM merged_edges)
        RETURNING id
      ),
      
      deleted_neighbors AS (
        DELETE FROM ${stagingSchema}.ways_noded 
        WHERE id IN (SELECT neighbor_edge_id FROM merged_edges)  
        RETURNING id
      )
      
      SELECT 
        (SELECT COUNT(*) FROM inserted) AS merged,
        (SELECT COUNT(*) FROM deleted_connectors) + (SELECT COUNT(*) FROM deleted_neighbors) AS deleted;
    `);
        const merged = Number(mergeResult.rows[0]?.merged || 0);
        const deleted = Number(mergeResult.rows[0]?.deleted || 0);
        // Recompute vertex degrees after merging
        if (merged > 0) {
            await pgClient.query(`
        UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      `);
            console.log(`🔗 Merged ${merged} isolated connector endpoints into ${merged} extended edges`);
        }
        else {
            console.log('ℹ️ No isolated connector endpoints found to merge');
        }
        return { merged, deleted };
    }
    catch (error) {
        console.error('❌ Error merging isolated connectors:', error);
        throw error;
    }
}
//# sourceMappingURL=merge-isolated-connectors.js.map