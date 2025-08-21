const { Client } = require('pg');

async function checkTrailContainment() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('🔍 Checking if connector trail is contained within other trails...');

    const connectorId = 'ab36dded-56f4-4a1d-bd16-6781586a3336';
    const bbox = [-105.29349960749634, 40.06857704268381, -105.29020136663583, 40.07020761045467];
    
    // Expand bbox by 0.01 degrees (~1km)
    const expansion = 0.01;
    const expandedMinLng = bbox[0] - expansion;
    const expandedMaxLng = bbox[2] + expansion;
    const expandedMinLat = bbox[1] - expansion;
    const expandedMaxLat = bbox[3] + expansion;

    // Get the connector trail
    const connectorResult = await pgClient.query(`
      SELECT app_uuid, name, geometry, ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE app_uuid = $1
    `, [connectorId]);

    if (connectorResult.rows.length === 0) {
      console.log('❌ Connector trail not found');
      return;
    }

    const connector = connectorResult.rows[0];
    console.log(`📋 Connector trail: ${connector.name} (${connector.length_meters}m)`);

    // Check for trails that contain the connector trail
    const containmentResult = await pgClient.query(`
      SELECT 
        t.app_uuid,
        t.name,
        ST_Length(t.geometry::geography) as length_meters,
        ST_Contains(t.geometry, $1::geometry) as contains_connector,
        ST_Covers(t.geometry, $1::geometry) as covers_connector,
        ST_Equals(t.geometry, $1::geometry) as equals_connector,
        ST_Intersects(t.geometry, $1::geometry) as intersects_connector,
        ST_Overlaps(t.geometry, $1::geometry) as overlaps_connector,
        ST_Within($1::geometry, t.geometry) as connector_within_trail
      FROM public.trails t
      WHERE t.app_uuid != $2
        AND t.source = 'cotrex'
        AND ST_Intersects(t.geometry, ST_MakeEnvelope($3, $4, $5, $6, 4326))
        AND ST_Intersects(t.geometry, $1::geometry)
      ORDER BY length_meters DESC
    `, [connector.geometry, connectorId, expandedMinLng, expandedMinLat, expandedMaxLng, expandedMaxLat]);

    console.log(`\n📊 Found ${containmentResult.rows.length} trails that intersect with connector:`);
    
    let containedTrails = [];
    let overlappingTrails = [];
    let equalTrails = [];

    containmentResult.rows.forEach((row, i) => {
      console.log(`\n${i + 1}. ${row.name} (${row.length_meters.toFixed(2)}m) - ${row.app_uuid}`);
      console.log(`   - Contains connector: ${row.contains_connector}`);
      console.log(`   - Covers connector: ${row.covers_connector}`);
      console.log(`   - Equals connector: ${row.equals_connector}`);
      console.log(`   - Intersects connector: ${row.intersects_connector}`);
      console.log(`   - Overlaps connector: ${row.overlaps_connector}`);
      console.log(`   - Connector within trail: ${row.connector_within_trail}`);

      if (row.contains_connector || row.covers_connector) {
        containedTrails.push(row);
      }
      if (row.overlaps_connector) {
        overlappingTrails.push(row);
      }
      if (row.equals_connector) {
        equalTrails.push(row);
      }
    });

    console.log(`\n🎯 SUMMARY:`);
    console.log(`   - Trails that contain connector: ${containedTrails.length}`);
    console.log(`   - Trails that overlap connector: ${overlappingTrails.length}`);
    console.log(`   - Trails that equal connector: ${equalTrails.length}`);

    if (containedTrails.length > 0) {
      console.log(`\n⚠️  CONTAINMENT ISSUE DETECTED!`);
      console.log(`   The connector trail is contained within ${containedTrails.length} other trail(s):`);
      containedTrails.forEach(trail => {
        console.log(`   - ${trail.name} (${trail.length_meters.toFixed(2)}m)`);
      });
      console.log(`   This would cause the connector to be removed during deduplication.`);
    }

    // Check if any of the lollipop segments contain the connector
    console.log(`\n🔍 Checking lollipop trail segments...`);
    const lollipopId = 'b43a9490-6651-428e-b5e4-fb2ffce3b220';
    
    const lollipopSegmentsResult = await pgClient.query(`
      WITH split_segments AS (
        SELECT 
          ST_LineSubstring(geometry, 
            (generate_series(0, 1)::float / 2), 
            LEAST((generate_series(0, 1)::float + 1) / 2, 1.0)
          ) as geometry,
          generate_series(0, 1) + 1 as segment_order
        FROM public.trails 
        WHERE app_uuid = $1
      )
      SELECT 
        segment_order,
        ST_Length(geometry::geography) as length_meters,
        ST_Contains(geometry, $2::geometry) as contains_connector,
        ST_Covers(geometry, $2::geometry) as covers_connector,
        ST_Equals(geometry, $2::geometry) as equals_connector
      FROM split_segments
      WHERE ST_Length(geometry::geography) > 0.1
        AND ST_GeometryType(geometry) = 'ST_LineString'
    `, [lollipopId, connector.geometry]);

    console.log(`📊 Lollipop split segments analysis:`);
    lollipopSegmentsResult.rows.forEach((row, i) => {
      console.log(`   Segment ${row.segment_order}: ${row.length_meters.toFixed(2)}m`);
      console.log(`     - Contains connector: ${row.contains_connector}`);
      console.log(`     - Covers connector: ${row.covers_connector}`);
      console.log(`     - Equals connector: ${row.equals_connector}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkTrailContainment();
