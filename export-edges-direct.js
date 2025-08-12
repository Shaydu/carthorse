const { Pool } = require('pg');
const fs = require('fs');

async function exportEdgesDirect() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'tester'
  });

  try {
    // Use the latest carthorse schema
    const latestSchema = 'carthorse_1754957819090';
    console.log(`📊 Using schema: ${latestSchema}`);

    // Check if ways_noded has edges
    const countResult = await pool.query(`
      SELECT COUNT(*) as edge_count FROM ${latestSchema}.ways_noded
    `);
    console.log(`🔍 Found ${countResult.rows[0].edge_count} edges in ways_noded`);

    // Export edges directly
    const edgesResult = await pool.query(`
      SELECT 
        id,
        source,
        target,
        app_uuid as trail_id,
        name as trail_name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_AsGeoJSON(the_geom, 6, 0) AS geojson
      FROM ${latestSchema}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
      ORDER BY id
    `);

    console.log(`📤 Exporting ${edgesResult.rows.length} edges...`);

    const geojson = {
      type: 'FeatureCollection',
      features: edgesResult.rows.map(row => ({
        type: 'Feature',
        properties: {
          layer: 'edges',
          id: row.id,
          source: row.source,
          target: row.target,
          trail_id: row.trail_id,
          trail_name: row.trail_name,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          color: '#4169E1',
          stroke: '#4169E1',
          'stroke-width': 2
        },
        geometry: JSON.parse(row.geojson)
      }))
    };

    const filename = 'direct-edges-export.geojson';
    fs.writeFileSync(filename, JSON.stringify(geojson, null, 2));
    console.log(`✅ Exported ${geojson.features.length} edges to ${filename}`);

    // Show some sample edges
    console.log('\n📋 Sample edges:');
    edgesResult.rows.slice(0, 5).forEach(edge => {
      console.log(`  - Edge ${edge.id}: ${edge.trail_name} (${edge.source} → ${edge.target})`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

exportEdgesDirect();
