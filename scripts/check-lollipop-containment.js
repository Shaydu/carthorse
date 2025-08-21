const { Client } = require('pg');

async function checkLollipopContainment() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('🔍 Checking lollipop trail containment...');

    const lollipopId = 'b43a9490-6651-428e-b5e4-fb2ffce3b220';
    const largeTrailId = 'c55c0383-f02c-4761-aebe-26098441802d'; // 833m Foothills North Trail
    const connectorId = 'ab36dded-56f4-4a1d-bd16-6781586a3336';

    // Get the trails
    const trailsResult = await pgClient.query(`
      SELECT app_uuid, name, geometry, ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE app_uuid IN ($1, $2, $3)
    `, [lollipopId, largeTrailId, connectorId]);

    const trails = {};
    trailsResult.rows.forEach(row => {
      trails[row.app_uuid] = row;
    });

    console.log('📋 Trail details:');
    Object.values(trails).forEach(trail => {
      console.log(`   - ${trail.name}: ${trail.length_meters.toFixed(2)}m (${trail.app_uuid})`);
    });

    // Check if 833m trail contains the lollipop
    const containmentCheck = await pgClient.query(`
      SELECT 
        t1.name as trail1_name,
        t1.app_uuid as trail1_id,
        t2.name as trail2_name,
        t2.app_uuid as trail2_id,
        ST_Contains(t1.geometry, t2.geometry) as t1_contains_t2,
        ST_Covers(t1.geometry, t2.geometry) as t1_covers_t2,
        ST_Within(t2.geometry, t1.geometry) as t2_within_t1,
        ST_Overlaps(t1.geometry, t2.geometry) as t1_overlaps_t2,
        ST_Intersects(t1.geometry, t2.geometry) as t1_intersects_t2
      FROM public.trails t1, public.trails t2
      WHERE t1.app_uuid = $1 AND t2.app_uuid = $2
    `, [largeTrailId, lollipopId]);

    console.log('\n🔍 833m trail vs Lollipop trail:');
    if (containmentCheck.rows.length > 0) {
      const row = containmentCheck.rows[0];
      console.log(`   ${row.trail1_name} vs ${row.trail2_name}:`);
      console.log(`   - Contains: ${row.t1_contains_t2}`);
      console.log(`   - Covers: ${row.t1_covers_t2}`);
      console.log(`   - Within: ${row.t2_within_t1}`);
      console.log(`   - Overlaps: ${row.t1_overlaps_t2}`);
      console.log(`   - Intersects: ${row.t1_intersects_t2}`);
    }

    // Check lollipop split segments
    console.log('\n🔍 Lollipop split segments vs 833m trail:');
    const splitSegmentsResult = await pgClient.query(`
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
        ST_Contains($2::geometry, geometry) as large_contains_segment,
        ST_Covers($2::geometry, geometry) as large_covers_segment,
        ST_Within(geometry, $2::geometry) as segment_within_large,
        ST_Overlaps($2::geometry, geometry) as large_overlaps_segment,
        ST_Intersects($2::geometry, geometry) as large_intersects_segment
      FROM split_segments
      WHERE ST_Length(geometry::geography) > 0.1
        AND ST_GeometryType(geometry) = 'ST_LineString'
    `, [lollipopId, trails[largeTrailId].geometry]);

    splitSegmentsResult.rows.forEach((row, i) => {
      console.log(`   Segment ${row.segment_order} (${row.length_meters.toFixed(2)}m):`);
      console.log(`     - 833m trail contains: ${row.large_contains_segment}`);
      console.log(`     - 833m trail covers: ${row.large_covers_segment}`);
      console.log(`     - Segment within 833m: ${row.segment_within_large}`);
      console.log(`     - 833m trail overlaps: ${row.large_overlaps_segment}`);
      console.log(`     - 833m trail intersects: ${row.large_intersects_segment}`);
    });

    // Check if any segments are contained within the 833m trail
    const containedSegments = splitSegmentsResult.rows.filter(row => 
      row.large_contains_segment || row.large_covers_segment || row.segment_within_large
    );

    if (containedSegments.length > 0) {
      console.log('\n⚠️  CONTAINMENT ISSUE DETECTED!');
      console.log(`   ${containedSegments.length} lollipop segment(s) are contained within the 833m trail:`);
      containedSegments.forEach(segment => {
        console.log(`   - Segment ${segment.segment_order} (${segment.length_meters.toFixed(2)}m)`);
      });
      console.log(`   This would cause the lollipop segments to be removed during deduplication.`);
    }

    // Check if connector trail overlaps with any lollipop segments
    console.log('\n🔍 Connector trail vs Lollipop segments:');
    const connectorVsSegmentsResult = await pgClient.query(`
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
        ST_Contains($2::geometry, geometry) as connector_contains_segment,
        ST_Covers($2::geometry, geometry) as connector_covers_segment,
        ST_Within(geometry, $2::geometry) as segment_within_connector,
        ST_Overlaps($2::geometry, geometry) as connector_overlaps_segment,
        ST_Intersects($2::geometry, geometry) as connector_intersects_segment
      FROM split_segments
      WHERE ST_Length(geometry::geography) > 0.1
        AND ST_GeometryType(geometry) = 'ST_LineString'
    `, [lollipopId, trails[connectorId].geometry]);

    connectorVsSegmentsResult.rows.forEach((row, i) => {
      console.log(`   Segment ${row.segment_order} (${row.length_meters.toFixed(2)}m):`);
      console.log(`     - Connector contains: ${row.connector_contains_segment}`);
      console.log(`     - Connector covers: ${row.connector_covers_segment}`);
      console.log(`     - Segment within connector: ${row.segment_within_connector}`);
      console.log(`     - Connector overlaps: ${row.connector_overlaps_segment}`);
      console.log(`     - Connector intersects: ${row.connector_intersects_segment}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkLollipopContainment();
