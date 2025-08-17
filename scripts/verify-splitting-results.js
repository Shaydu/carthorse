const { Pool } = require('pg');

async function verifySplittingResults() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: ''
  });

  try {
    console.log('🔍 Verifying splitting results...');

    // Get the staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using staging schema: ${stagingSchema}`);

    // Check all trails with "Enchanted" in the name
    const enchantedTrailsResult = await pgClient.query(`
      SELECT 
        id, app_uuid, name, 
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails 
      WHERE name LIKE '%Enchanted%'
      ORDER BY name, length_meters DESC
    `);

    console.log(`\n📊 Found ${enchantedTrailsResult.rows.length} Enchanted trails in staging:`);
    enchantedTrailsResult.rows.forEach((trail, i) => {
      console.log(`  ${i + 1}. ${trail.name} (${trail.app_uuid})`);
      console.log(`     Length: ${(trail.length_meters / 1000).toFixed(3)}km`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });

    // Check all trails with "Kohler" in the name
    const kohlerTrailsResult = await pgClient.query(`
      SELECT 
        id, app_uuid, name, 
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails 
      WHERE name LIKE '%Kohler%'
      ORDER BY name, length_meters DESC
    `);

    console.log(`\n📊 Found ${kohlerTrailsResult.rows.length} Kohler trails in staging:`);
    kohlerTrailsResult.rows.forEach((trail, i) => {
      console.log(`  ${i + 1}. ${trail.name} (${trail.app_uuid})`);
      console.log(`     Length: ${(trail.length_meters / 1000).toFixed(3)}km`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });

    // Check total count of trails in staging
    const totalTrailsResult = await pgClient.query(`
      SELECT COUNT(*) as total_trails FROM ${stagingSchema}.trails
    `);
    console.log(`\n📊 Total trails in staging: ${totalTrailsResult.rows[0].total_trails}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

verifySplittingResults();
