import { Pool } from 'pg';

export async function runPostNodingSnap(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ snappedStart: number; snappedEnd: number }> {
  // OPTIMIZATION: Pre-create materialized projected geometries to avoid repeated ST_Transform calls
  console.log('🔍 Creating temporary projected geometry tables for optimization...');
  
  // Create temporary table with pre-projected edge start/end points
  await pgClient.query(`
    CREATE TEMPORARY TABLE temp_edge_points AS
    SELECT 
      id as edge_id,
      ST_Transform(ST_StartPoint(the_geom), 3857) as start_geom,
      ST_Transform(ST_EndPoint(the_geom), 3857) as end_geom,
      source,
      target
    FROM ${stagingSchema}.ways_noded;
    
    CREATE INDEX idx_temp_edge_start ON temp_edge_points USING GIST(start_geom);
    CREATE INDEX idx_temp_edge_end ON temp_edge_points USING GIST(end_geom);
  `);
  
  // Create temporary table with pre-projected vertices
  await pgClient.query(`
    CREATE TEMPORARY TABLE temp_vertices AS
    SELECT 
      id as node_id,
      ST_Transform(the_geom, 3857) as geom_proj
    FROM ${stagingSchema}.ways_noded_vertices_pgr;
    
    CREATE INDEX idx_temp_vertices ON temp_vertices USING GIST(geom_proj);
  `);
  
  console.log('✅ Temporary projected tables created');
  
  const snapStart = await pgClient.query(
    `
    WITH candidates AS (
      SELECT ep.edge_id,
             tv.node_id,
             ST_Distance(tv.geom_proj, ep.start_geom) AS dist
      FROM temp_edge_points ep
      JOIN temp_vertices tv ON ST_DWithin(tv.geom_proj, ep.start_geom, $1)
    ),
    nearest AS (
      SELECT DISTINCT ON (edge_id) edge_id, node_id
      FROM candidates
      ORDER BY edge_id, dist ASC
    )
    UPDATE ${stagingSchema}.ways_noded wn
    SET source = n.node_id
    FROM nearest n
    WHERE wn.id = n.edge_id AND (wn.source IS DISTINCT FROM n.node_id)
    RETURNING 1
    `,
    [toleranceMeters]
  );

  const snapEnd = await pgClient.query(
    `
    WITH candidates AS (
      SELECT ep.edge_id,
             tv.node_id,
             ST_Distance(tv.geom_proj, ep.end_geom) AS dist
      FROM temp_edge_points ep
      JOIN temp_vertices tv ON ST_DWithin(tv.geom_proj, ep.end_geom, $1)
    ),
    nearest AS (
      SELECT DISTINCT ON (edge_id) edge_id, node_id
      FROM candidates
      ORDER BY edge_id, dist ASC
    )
    UPDATE ${stagingSchema}.ways_noded wn
    SET target = n.node_id
    FROM nearest n
    WHERE wn.id = n.edge_id AND (wn.target IS DISTINCT FROM n.node_id)
    RETURNING 1
    `,
    [toleranceMeters]
  );

  // OPTIMIZATION: Use efficient aggregation instead of correlated subquery
  console.log('🔄 Updating vertex degrees efficiently...');
  await pgClient.query(
    `
    WITH vertex_counts AS (
      SELECT vertex_id, COUNT(*) as degree
      FROM (
        SELECT source as vertex_id FROM ${stagingSchema}.ways_noded WHERE source IS NOT NULL
        UNION ALL
        SELECT target as vertex_id FROM ${stagingSchema}.ways_noded WHERE target IS NOT NULL
      ) edge_endpoints
      GROUP BY vertex_id
    )
    UPDATE ${stagingSchema}.ways_noded_vertices_pgr v
    SET cnt = COALESCE(vc.degree, 0)
    FROM vertex_counts vc
    WHERE v.id = vc.vertex_id
    `
  );
  
  // Set cnt=0 for any vertices with no connections
  await pgClient.query(
    `UPDATE ${stagingSchema}.ways_noded_vertices_pgr 
     SET cnt = 0 
     WHERE cnt IS NULL`
  );
  
  console.log('✅ Vertex degrees updated efficiently');

  return {
    snappedStart: snapStart.rowCount || 0,
    snappedEnd: snapEnd.rowCount || 0
  };
}


