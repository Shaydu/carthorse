const { Pool } = require('pg');
const fs = require('fs');

const pgClient = new Pool({
  host: 'localhost',
  user: 'shaydu',
  password: '',
  database: 'trail_master_db',
  port: 5432
});

async function generateLayer1GeoJSON() {
  try {
    console.log('🔍 Generating Layer 1 GeoJSON from latest staging schema...');
    
    // Find the latest staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%'
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schemas found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Get all trails from the staging schema
    const result = await pgClient.query(`
      SELECT 
        name,
        app_uuid,
        source,
        ST_AsGeoJSON(geometry) as geojson,
        ST_Length(geometry::geography) as length_meters,
        ST_GeometryType(geometry) as geom_type
      FROM ${stagingSchema}.trails
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
          source: row.source,
          length_meters: Math.round(row.length_meters * 100) / 100,
          geom_type: row.geom_type
        },
        geometry: JSON.parse(row.geojson)
      }))
    };
    
    // Write to file
    const outputPath = '/Users/shaydu/dev/carthorse/test-output/layer1-results.geojson';
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Layer 1 GeoJSON written to: ${outputPath}`);
    console.log(`📊 Total features: ${geojson.features.length}`);
    
    // Show Enchanted Mesa and Kohler results
    const enchantedResults = result.rows.filter(r => r.name.includes('Enchanted'));
    const kohlerResults = result.rows.filter(r => r.name.includes('Kohler'));
    
    console.log('\n🔍 Enchanted Mesa segments:');
    enchantedResults.forEach(r => {
      console.log(`   - ${r.name}: ${Math.round(r.length_meters * 100) / 100}m [${r.source}]`);
    });
    
    console.log('\n🔍 Kohler segments:');
    kohlerResults.forEach(r => {
      console.log(`   - ${r.name}: ${Math.round(r.length_meters * 100) / 100}m [${r.source}]`);
    });
    
    // Show summary by source
    const sourceCounts = {};
    result.rows.forEach(r => {
      sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
    });
    
    console.log('\n📊 Summary by source:');
    Object.entries(sourceCounts).forEach(([source, count]) => {
      console.log(`   - ${source}: ${count} segments`);
    });
    
  } catch (error) {
    console.error('❌ Error generating Layer 1 GeoJSON:', error);
  } finally {
    await pgClient.end();
  }
}

generateLayer1GeoJSON();
