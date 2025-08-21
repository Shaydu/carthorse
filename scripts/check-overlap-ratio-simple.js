const { Client } = require('pg');

async function checkOverlapRatio() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('🔍 Checking overlap between lollipop segment and 833m trail...');

    const lollipopId = 'b43a9490-6651-428e-b5e4-fb2ffce3b220';
    const largeTrailId = 'c55c0383-f02c-4761-aebe-26098441802d'; // 833m Foothills North Trail

    // Get the 833m trail geometry first
    const largeTrailResult = await pgClient.query(`
      SELECT geometry FROM public.trails WHERE app_uuid = $1
    `, [largeTrailId]);

    if (largeTrailResult.rows.length === 0) {
      console.log('❌ 833m trail not found');
      return;
    }

    const largeTrailGeometry = largeTrailResult.rows[0].geometry;

    // Calculate overlap for lollipop segments vs 833m trail
    const overlapResult = await pgClient.query(`
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
        ST_Length(geometry::geography) as segment_length_meters,
        ST_Length($2::geometry::geography) as large_trail_length_meters,
        ST_Area(ST_Intersection(geometry, $2::geometry)) as intersection_area,
        ST_Area(geometry) as segment_area,
        ST_Area($2::geometry) as large_trail_area,
        ST_Distance(geometry, $2::geometry) as distance_meters,
        ST_Intersects(geometry, $2::geometry) as intersects,
        ST_Overlaps(geometry, $2::geometry) as overlaps
      FROM split_segments
      WHERE ST_Length(geometry::geography) > 0.1
        AND ST_GeometryType(geometry) = 'ST_LineString'
    `, [lollipopId, largeTrailGeometry]);

    console.log('📊 Overlap analysis:');
    overlapResult.rows.forEach((row, i) => {
      const overlapRatio = row.segment_area > 0 ? row.intersection_area / row.segment_area : 0;
      const overlapRatioLarge = row.large_trail_area > 0 ? row.intersection_area / row.large_trail_area : 0;
      
      console.log(`\n   Segment ${row.segment_order} (${row.segment_length_meters.toFixed(2)}m):`);
      console.log(`     - Large trail length: ${row.large_trail_length_meters.toFixed(2)}m`);
      console.log(`     - Intersection area: ${row.intersection_area.toFixed(6)}`);
      console.log(`     - Segment area: ${row.segment_area.toFixed(6)}`);
      console.log(`     - Large trail area: ${row.large_trail_area.toFixed(6)}`);
      console.log(`     - Overlap ratio (segment): ${(overlapRatio * 100).toFixed(2)}%`);
      console.log(`     - Overlap ratio (large trail): ${(overlapRatioLarge * 100).toFixed(2)}%`);
      console.log(`     - Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`     - Intersects: ${row.intersects}`);
      console.log(`     - Overlaps: ${row.overlaps}`);
      
      // Check if this would be considered a duplicate
      const isDuplicate = overlapRatio > 0.8 || (row.distance_meters < 5 && overlapRatio > 0.5);
      if (isDuplicate) {
        console.log(`     ⚠️  WOULD BE REMOVED AS DUPLICATE!`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkOverlapRatio();
