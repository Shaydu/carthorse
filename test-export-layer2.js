const { Pool } = require('pg');
const fs = require('fs');

async function testExportLayer2() {
  const pool = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu',
    password: ''
  });

  try {
    const stagingSchema = 'carthorse_1755606993498';
    
    // Test the exact query that the export strategy uses
    const result = await pool.query(`
      SELECT 
        id,
        cnt,
        ST_AsGeoJSON(the_geom, 6, 0) as geojson
      FROM ${stagingSchema}.ways_noded_vertices_pgr
      WHERE the_geom IS NOT NULL
      ORDER BY id
    `);
    
    console.log('Query result sample:');
    result.rows.slice(0, 5).forEach(row => {
      console.log(`ID: ${row.id}, cnt: ${row.cnt}, cnt type: ${typeof row.cnt}`);
    });
    
    // Test the degree calculation logic
    const features = result.rows.map((node) => {
      const degree = parseInt(node.cnt) || 0;
      console.log(`Processing node ${node.id}: cnt=${node.cnt}, degree=${degree}`);
      
      let color, stroke, strokeWidth, fillOpacity, radius;
      
      if (degree === 1) {
        color = "#00FF00"; // Green for endpoints
      } else if (degree === 2) {
        color = "#0000FF"; // Blue for connectors
      } else {
        color = "#FF0000"; // Red for intersections
      }
      
      return {
        type: 'Feature',
        properties: {
          id: node.id,
          cnt: degree,
          degree: degree,
          type: 'node',
          color: color
        },
        geometry: JSON.parse(node.geojson)
      };
    });
    
    // Write to test file
    const testFile = 'test-layer2-export.geojson';
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };
    
    fs.writeFileSync(testFile, JSON.stringify(geojson, null, 2));
    console.log(`\nTest export written to ${testFile}`);
    console.log(`Total features: ${features.length}`);
    
    // Check degree distribution
    const degreeCounts = {};
    features.forEach(f => {
      const degree = f.properties.degree;
      degreeCounts[degree] = (degreeCounts[degree] || 0) + 1;
    });
    console.log('Degree distribution:', degreeCounts);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

testExportLayer2();
