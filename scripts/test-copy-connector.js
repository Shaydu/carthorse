const { Client } = require('pg');

async function testCopyConnector() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('🔍 Testing connector trail copy...');

    const connectorId = 'ab36dded-56f4-4a1d-bd16-6781586a3336';
    const bbox = [-105.29349960749634, 40.06857704268381, -105.29020136663583, 40.07020761045467];
    
    // Expand bbox by 0.01 degrees (~1km)
    const expansion = 0.01;
    const expandedMinLng = bbox[0] - expansion;
    const expandedMaxLng = bbox[2] + expansion;
    const expandedMinLat = bbox[1] - expansion;
    const expandedMaxLat = bbox[3] + expansion;

    console.log(`🗺️ Original bbox: [${bbox.join(', ')}]`);
    console.log(`🗺️ Expanded bbox: [${expandedMinLng}, ${expandedMinLat}, ${expandedMaxLng}, ${expandedMaxLat}]`);

    // Test 1: Check if connector is in original bbox
    const originalBboxTest = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326)) as in_original_bbox
      FROM public.trails 
      WHERE app_uuid = $5
    `, [bbox[0], bbox[1], bbox[2], bbox[3], connectorId]);

    console.log('\n📊 Original bbox test:');
    if (originalBboxTest.rows.length > 0) {
      const row = originalBboxTest.rows[0];
      console.log(`   - Name: ${row.name}`);
      console.log(`   - Length: ${row.length_meters}m`);
      console.log(`   - In original bbox: ${row.in_original_bbox}`);
    } else {
      console.log('   ❌ Connector trail not found');
    }

    // Test 2: Check if connector is in expanded bbox
    const expandedBboxTest = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326)) as in_expanded_bbox
      FROM public.trails 
      WHERE app_uuid = $5
    `, [expandedMinLng, expandedMinLat, expandedMaxLng, expandedMaxLat, connectorId]);

    console.log('\n📊 Expanded bbox test:');
    if (expandedBboxTest.rows.length > 0) {
      const row = expandedBboxTest.rows[0];
      console.log(`   - Name: ${row.name}`);
      console.log(`   - Length: ${row.length_meters}m`);
      console.log(`   - In expanded bbox: ${row.in_expanded_bbox}`);
    } else {
      console.log('   ❌ Connector trail not found');
    }

    // Test 3: Check if connector matches source filter
    const sourceTest = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        source,
        ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE app_uuid = $1
    `, [connectorId]);

    console.log('\n📊 Source filter test:');
    if (sourceTest.rows.length > 0) {
      const row = sourceTest.rows[0];
      console.log(`   - Name: ${row.name}`);
      console.log(`   - Source: ${row.source}`);
      console.log(`   - Length: ${row.length_meters}m`);
      console.log(`   - Matches 'cotrex': ${row.source === 'cotrex'}`);
    } else {
      console.log('   ❌ Connector trail not found');
    }

    // Test 4: Simulate the exact copy query
    const copyQueryTest = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters
      FROM public.trails
      WHERE geometry IS NOT NULL 
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
        AND source = $5
        AND app_uuid NOT IN (
          SELECT DISTINCT app_uuid FROM public.trails 
          WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        )
      ORDER BY app_uuid
    `, [expandedMinLng, expandedMinLat, expandedMaxLng, expandedMaxLat, 'cotrex']);

    console.log('\n📊 Copy query test:');
    console.log(`   - Total trails found: ${copyQueryTest.rows.length}`);
    const connectorInResults = copyQueryTest.rows.find(row => row.app_uuid === connectorId);
    if (connectorInResults) {
      console.log(`   ✅ Connector trail found in copy results: ${connectorInResults.name} (${connectorInResults.length_meters}m)`);
    } else {
      console.log(`   ❌ Connector trail NOT found in copy results`);
      console.log('   📋 Trails found:');
      copyQueryTest.rows.forEach((row, i) => {
        console.log(`     ${i + 1}. ${row.name} (${row.length_meters.toFixed(2)}m) - ${row.app_uuid}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testCopyConnector();
