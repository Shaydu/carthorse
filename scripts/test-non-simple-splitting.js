const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function testNonSimpleSplitting() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔍 Testing non-simple geometry splitting for specific trail...');
    
    const trailId = 'b43a9490-6651-428e-b5e4-fb2ffce3b220';
    
    // Get the original trail
    const originalTrail = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_NumPoints(geometry) as num_points,
        ST_IsSimple(geometry) as is_simple,
        ST_GeometryType(geometry) as geometry_type,
        ST_AsText(geometry) as geometry_text
      FROM public.trails
      WHERE app_uuid = $1
    `, [trailId]);
    
    if (originalTrail.rows.length === 0) {
      console.log('❌ Trail not found');
      return;
    }
    
    const trail = originalTrail.rows[0];
    console.log('📋 Original Trail:');
    console.log(`   ID: ${trail.app_uuid}`);
    console.log(`   Name: ${trail.name}`);
    console.log(`   Length: ${trail.length_meters}m`);
    console.log(`   Points: ${trail.num_points}`);
    console.log(`   Is Simple: ${trail.is_simple}`);
    console.log(`   Geometry Type: ${trail.geometry_type}`);
    
    // Test the splitting logic
    console.log('\n🔧 Testing splitting logic...');
    
    const splitResult = await pgClient.query(`
      SELECT 
        generate_series(0, 3) + 1 as segment_order,
        (generate_series(0, 3)::float / 4) as start_fraction,
        LEAST((generate_series(0, 3)::float + 1) / 4, 1.0) as end_fraction,
        ST_LineSubstring($1::geometry, 
          (generate_series(0, 3)::float / 4), 
          LEAST((generate_series(0, 3)::float + 1) / 4, 1.0)
        ) as geometry
      FROM (SELECT 1) as dummy
    `, [trail.geometry_text]);
    
    console.log(`   Generated ${splitResult.rows.length} split segments:`);
    
    let totalLength = 0;
    splitResult.rows.forEach((segment, i) => {
      const length = parseFloat(segment.geometry ? 
        pgClient.query(`SELECT ST_Length($1::geometry::geography) as length`, [segment.geometry]).then(r => r.rows[0].length) : 0);
      totalLength += length;
      console.log(`     Segment ${segment.segment_order}: ${segment.start_fraction.toFixed(2)}-${segment.end_fraction.toFixed(2)}, length: ${length.toFixed(2)}m`);
    });
    
    console.log(`   Total length after splitting: ${totalLength.toFixed(2)}m`);
    console.log(`   Original length: ${trail.length_meters}m`);
    console.log(`   Length difference: ${(totalLength - trail.length_meters).toFixed(2)}m`);
    
    // Test if any segments would be filtered out by length
    const minTrailLengthMeters = 0.1;
    const shortSegments = splitResult.rows.filter(segment => {
      const length = parseFloat(segment.geometry ? 
        pgClient.query(`SELECT ST_Length($1::geometry::geography) as length`, [segment.geometry]).then(r => r.rows[0].length) : 0);
      return length < minTrailLengthMeters;
    });
    
    console.log(`\n📏 Segments shorter than ${minTrailLengthMeters}m: ${shortSegments.length}`);
    if (shortSegments.length > 0) {
      shortSegments.forEach(segment => {
        console.log(`   Segment ${segment.segment_order}: would be filtered out`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error testing splitting:', error);
  } finally {
    await pgClient.release();
    await pool.end();
  }
}

testNonSimpleSplitting();
