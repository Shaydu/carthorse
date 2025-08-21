const { Pool } = require('pg');

const pool = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function checkConnectorInStaging() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking connector trail in staging schema...');
    
    // Find the most recent staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%'
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check if the connector trail exists in staging
    const connectorResult = await client.query(`
      SELECT 
        id,
        app_uuid,
        original_trail_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_AsGeoJSON(geometry) as geometry_json
      FROM ${stagingSchema}.trails
      WHERE app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
         OR original_trail_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
         OR name LIKE '%North Sky Trail%'
      ORDER BY length_meters DESC
    `);
    
    console.log(`\n📊 Found ${connectorResult.rows.length} connector trail segments in staging:`);
    
    for (const row of connectorResult.rows) {
      console.log(`   - ID: ${row.id}`);
      console.log(`   - App UUID: ${row.app_uuid}`);
      console.log(`   - Original UUID: ${row.original_trail_uuid || 'N/A'}`);
      console.log(`   - Name: ${row.name}`);
      console.log(`   - Length: ${row.length_meters.toFixed(2)}m`);
      console.log('');
    }
    
    // Check if any segments are very short (might be filtered out)
    const shortSegmentsResult = await client.query(`
      SELECT 
        COUNT(*) as count,
        MIN(ST_Length(geometry::geography)) as min_length,
        MAX(ST_Length(geometry::geography)) as max_length
      FROM ${stagingSchema}.trails
      WHERE app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
         OR original_trail_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336'
         OR name LIKE '%North Sky Trail%'
    `);
    
    if (shortSegmentsResult.rows.length > 0) {
      const stats = shortSegmentsResult.rows[0];
      console.log(`📏 Connector trail length stats:`);
      console.log(`   - Total segments: ${stats.count}`);
      console.log(`   - Min length: ${stats.min_length.toFixed(2)}m`);
      console.log(`   - Max length: ${stats.max_length.toFixed(2)}m`);
    }
    
    // Check if the connector trail is being split by the lollipop trail
    const lollipopResult = await client.query(`
      SELECT 
        id,
        app_uuid,
        original_trail_uuid,
        name,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails
      WHERE app_uuid = 'b43a9490-6651-428e-b5e4-fb2ffce3b220'
         OR original_trail_uuid = 'b43a9490-6651-428e-b5e4-fb2ffce3b220'
         OR name LIKE '%Foothills North Trail%'
      ORDER BY length_meters DESC
    `);
    
    console.log(`\n🍭 Found ${lollipopResult.rows.length} lollipop trail segments in staging:`);
    
    for (const row of lollipopResult.rows) {
      console.log(`   - ID: ${row.id}`);
      console.log(`   - App UUID: ${row.app_uuid}`);
      console.log(`   - Original UUID: ${row.original_trail_uuid || 'N/A'}`);
      console.log(`   - Name: ${row.name}`);
      console.log(`   - Length: ${row.length_meters.toFixed(2)}m`);
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error checking staging:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkConnectorInStaging();
