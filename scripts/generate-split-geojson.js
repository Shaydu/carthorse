const { Pool } = require('pg');
const fs = require('fs');

const pgClient = new Pool({
  host: 'localhost',
  user: 'shaydu',
  password: '',
  database: 'trail_master_db',
  port: 5432
});

async function generateSplitGeoJSON() {
  try {
    console.log('🔍 Generating GeoJSON from staging schema...');
    
    // Get all trails from the staging schema
    const result = await pgClient.query(`
      SELECT 
        name,
        app_uuid,
        ST_AsGeoJSON(geometry) as geojson,
        ST_Length(geometry::geography) as length_meters,
        ST_GeometryType(geometry) as geom_type
      FROM carthorse_1755438128069.trails
      WHERE ST_GeometryType(geometry) = 'ST_LineString'
        AND ST_Length(geometry::geography) > 0
      ORDER BY name
    `);
    
    console.log(`📊 Found ${result.rows.length} valid trail segments`);
    
    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map(row => ({
        type: 'Feature',
        properties: {
          name: row.name,
          app_uuid: row.app_uuid,
          length_meters: Math.round(row.length_meters * 100) / 100,
          geom_type: row.geom_type
        },
        geometry: JSON.parse(row.geojson)
      }))
    };
    
    // Write to file
    const outputPath = '/Users/shaydu/dev/carthorse/test-output/split-results.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ GeoJSON written to: ${outputPath}`);
    console.log(`📊 Total features: ${geojson.features.length}`);
    
    // Show Enchanted Mesa and Kohler results
    const enchantedResults = result.rows.filter(r => r.name.includes('Enchanted'));
    const kohlerResults = result.rows.filter(r => r.name.includes('Kohler'));
    
    console.log('\n🔍 Enchanted Mesa segments:');
    enchantedResults.forEach(r => {
      console.log(`   - ${r.name}: ${Math.round(r.length_meters * 100) / 100}m`);
    });
    
    console.log('\n🔍 Kohler segments:');
    kohlerResults.forEach(r => {
      console.log(`   - ${r.name}: ${Math.round(r.length_meters * 100) / 100}m`);
    });
    
  } catch (error) {
    console.error('❌ Error generating GeoJSON:', error);
  } finally {
    await pgClient.end();
  }
}

generateSplitGeoJSON();
