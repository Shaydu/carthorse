const { Pool } = require('pg');

async function testGeometryGeneration() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'your_password'
  });

  try {
    const stagingSchema = 'carthorse_1755648570518';
    
    // Test with a specific out-and-back route
    const routeEdges = ["79", "479", "148", "149"];
    
    console.log('Testing geometry generation with edge IDs:', routeEdges);
    
    // Convert edge IDs to integers
    const edgeIds = routeEdges.map(edge => parseInt(edge, 10));
    console.log('Converted to integers:', edgeIds);
    
    // Test the geometry generation query
    const result = await pgClient.query(`
      WITH path(edge_id, ord) AS (
        SELECT edge_id::bigint, ord::int
        FROM unnest($1::bigint[]) WITH ORDINALITY AS u(edge_id, ord)
      ),
      ordered_edges AS (
        SELECT w.the_geom, p.ord
        FROM path p
        JOIN ${stagingSchema}.ways_noded w ON w.id = p.edge_id
        WHERE w.the_geom IS NOT NULL AND ST_IsValid(w.the_geom)
        ORDER BY p.ord
      ),
      outbound_geometry AS (
        SELECT ST_Force3D(ST_MakeLine(the_geom ORDER BY ord)) AS outbound_geom
        FROM ordered_edges
      ),
      return_geometry AS (
        SELECT ST_Reverse(outbound_geom) AS return_geom
        FROM outbound_geometry
      ),
      complete_route AS (
        SELECT 
          CASE 
            WHEN outbound_geom IS NOT NULL AND return_geom IS NOT NULL THEN
              ST_Force3D(ST_LineMerge(ST_Collect(outbound_geom, return_geom)))
            ELSE
              outbound_geom
          END AS route_geometry
        FROM outbound_geometry, return_geometry
      )
      SELECT 
        route_geometry IS NOT NULL as has_geometry,
        ST_IsValid(route_geometry) as is_valid,
        ST_AsText(route_geometry) as geometry_text
      FROM complete_route
      WHERE route_geometry IS NOT NULL AND NOT ST_IsEmpty(route_geometry) AND ST_IsValid(route_geometry)
    `, [edgeIds]);
    
    console.log('Geometry generation result:', result.rows[0]);
    
    if (result.rows[0]?.has_geometry) {
      console.log('✅ Geometry generated successfully!');
    } else {
      console.log('❌ No geometry generated');
    }
    
  } catch (error) {
    console.error('❌ Error testing geometry generation:', error);
  } finally {
    await pgClient.end();
  }
}

testGeometryGeneration();
