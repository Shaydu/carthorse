const { Pool } = require('pg');

async function visualizeVertex14() {
  const pool = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'tester',
    password: 'your_password_here',
    port: 5432,
  });

  try {
    // Get the 3 edges connected to vertex 14
    const result = await pool.query(`
      SELECT 
        id, 
        source, 
        target, 
        name, 
        ST_AsGeoJSON(the_geom) as geometry
      FROM carthorse_1754960048020.ways_noded 
      WHERE source = 14 OR target = 14
      ORDER BY id
    `);

    // Get vertex 14 location
    const vertexResult = await pool.query(`
      SELECT 
        id, 
        cnt as degree, 
        ST_AsGeoJSON(the_geom) as geometry
      FROM carthorse_1754960048020.ways_noded_vertices_pgr 
      WHERE id = 14
    `);

    // Create GeoJSON features
    const features = result.rows.map(row => ({
      type: 'Feature',
      geometry: JSON.parse(row.geometry),
      properties: {
        id: row.id,
        source: row.source,
        target: row.target,
        name: row.name,
        type: 'edge'
      }
    }));

    // Add vertex 14 as a point feature
    if (vertexResult.rows.length > 0) {
      const vertex = vertexResult.rows[0];
      features.push({
        type: 'Feature',
        geometry: JSON.parse(vertex.geometry),
        properties: {
          id: vertex.id,
          degree: vertex.degree,
          type: 'vertex',
          name: 'Vertex 14 (Mesa Trail Intersection)'
        }
      });
    }

    const geojson = {
      type: 'FeatureCollection',
      features: features
    };

    // Write to file
    const fs = require('fs');
    fs.writeFileSync('test-output/vertex-14-visualization.geojson', JSON.stringify(geojson, null, 2));
    
    console.log('✅ Vertex 14 visualization created: test-output/vertex-14-visualization.geojson');
    console.log(`📊 Found ${result.rows.length} edges connected to vertex 14:`);
    result.rows.forEach(row => {
      console.log(`   - Edge ${row.id}: ${row.name} (${row.source} → ${row.target})`);
    });
    
    if (vertexResult.rows.length > 0) {
      const vertex = vertexResult.rows[0];
      console.log(`📍 Vertex 14: degree ${vertex.degree} at ${JSON.parse(vertex.geometry).coordinates.join(', ')}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

visualizeVertex14();
