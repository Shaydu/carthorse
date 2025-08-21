const { Client } = require('pg');

async function testManualCopy() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('🔍 Testing manual copy of connector trail...');

    const connectorId = 'ab36dded-56f4-4a1d-bd16-6781586a3336';
    const stagingSchema = 'carthorse_1755775899742';

    // Get the connector trail from public.trails
    const connectorResult = await pgClient.query(`
      SELECT * FROM public.trails WHERE app_uuid = $1
    `, [connectorId]);

    if (connectorResult.rows.length === 0) {
      console.log('❌ Connector trail not found in public.trails');
      return;
    }

    const connector = connectorResult.rows[0];
    console.log(`📋 Found connector trail: ${connector.name} (${connector.length_km}km)`);

    // Try to manually copy it to staging
    try {
      await pgClient.query(`
        INSERT INTO ${stagingSchema}.trails (
          original_trail_uuid, app_uuid, name, trail_type, surface, difficulty,
          geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        ) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `, [
        connector.app_uuid,
        connector.name, connector.trail_type, connector.surface, connector.difficulty,
        connector.geometry, connector.length_km, connector.elevation_gain, connector.elevation_loss,
        connector.max_elevation, connector.min_elevation, connector.avg_elevation,
        connector.bbox_min_lng, connector.bbox_max_lng, connector.bbox_min_lat, connector.bbox_max_lat,
        connector.source, connector.source_tags, connector.osm_id
      ]);

      console.log('✅ Successfully copied connector trail to staging');

      // Verify it's there
      const verifyResult = await pgClient.query(`
        SELECT app_uuid, name, ST_Length(geometry::geography) as length_meters 
        FROM ${stagingSchema}.trails 
        WHERE original_trail_uuid = $1
      `, [connectorId]);

      if (verifyResult.rows.length > 0) {
        console.log(`✅ Verified: ${verifyResult.rows[0].name} (${verifyResult.rows[0].length_meters}m) in staging`);
      } else {
        console.log('❌ Connector trail not found in staging after copy');
      }

    } catch (error) {
      console.error('❌ Error copying connector trail:', error.message);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testManualCopy();
