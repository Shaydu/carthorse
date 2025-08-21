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
    console.log('🔍 Checking overlap ratio between lollipop segment and 833m trail...');

    const lollipopId = 'b43a9490-6651-428e-b5e4-fb2ffce3b220';
    const largeTrailId = 'c55c0383-f02c-4761-aebe-26098441802d'; // 833m Foothills North Trail

    // Calculate overlap ratio for lollipop segments vs 833m trail
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
      ),
      overlap_calculation AS (
        SELECT 
          segment_order,
          ST_Length(geometry::geography) as segment_length_meters,
          ST_Length($2::geometry::geography) as large_trail_length_meters,
          CASE 
            WHEN LEAST(ST_Area(geometry), ST_Area($2::geometry)) > 0 
            THEN ST_Area(ST_Intersection(geometry, $2::geometry)) / LEAST(ST_Area(geometry), ST_Area($2::geometry))
            ELSE 0
          END as overlap_ratio,
          ST_Distance(geometry, $2::geometry) as distance_meters,
          ST_Intersects(geometry, $2::geometry) as intersects,
          ST_Overlaps(geometry, $2::geometry) as overlaps
        FROM split_segments
        WHERE ST_Length(geometry::geography) > 0.1
          AND ST_GeometryType(geometry) = 'ST_LineString'
      )
      SELECT 
        segment_order,
        segment_length_meters,
        large_trail_length_meters,
        overlap_ratio,
        distance_meters,
        intersects,
        overlaps,
        CASE 
          WHEN overlap_ratio > 0.8 THEN 'HIGH_OVERLAP'
          WHEN distance_meters < 5 AND overlap_ratio > 0.5 THEN 'CLOSE_WITH_OVERLAP'
          WHEN intersects THEN 'INTERSECTS'
          ELSE 'NO_DUPLICATE'
        END as duplicate_status
      FROM overlap_calculation
    `, [lollipopId, (await pgClient.query('SELECT geometry FROM public.trails WHERE app_uuid = $1', [largeTrailId])).rows[0].geometry]);

    console.log('📊 Overlap analysis:');
    overlapResult.rows.forEach((row, i) => {
      console.log(`\n   Segment ${row.segment_order} (${row.segment_length_meters.toFixed(2)}m):`);
      console.log(`     - Large trail length: ${row.large_trail_length_meters.toFixed(2)}m`);
      console.log(`     - Overlap ratio: ${(row.overlap_ratio * 100).toFixed(2)}%`);
      console.log(`     - Distance: ${row.distance_meters.toFixed(2)}m`);
      console.log(`     - Intersects: ${row.intersects}`);
      console.log(`     - Overlaps: ${row.overlaps}`);
      console.log(`     - Duplicate status: ${row.duplicate_status}`);
      
      if (row.duplicate_status !== 'NO_DUPLICATE') {
        console.log(`     ⚠️  WOULD BE REMOVED AS DUPLICATE!`);
      }
    });

    // Check if any segments would be considered duplicates
    const duplicateSegments = overlapResult.rows.filter(row => 
      row.duplicate_status !== 'NO_DUPLICATE'
    );

    if (duplicateSegments.length > 0) {
      console.log(`\n⚠️  DEDUPLICATION ISSUE DETECTED!`);
      console.log(`   ${duplicateSegments.length} lollipop segment(s) would be removed as duplicates:`);
      duplicateSegments.forEach(segment => {
        console.log(`   - Segment ${segment.segment_order}: ${segment.duplicate_status} (${(segment.overlap_ratio * 100).toFixed(2)}% overlap)`);
      });
      console.log(`   This would break the connectivity between the lollipop and connector trails.`);
    } else {
      console.log(`\n✅ No deduplication issues detected.`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkOverlapRatio();
