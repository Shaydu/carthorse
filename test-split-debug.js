const { Pool } = require('pg');

// Database connection
const pgClient = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function testSplitDebug() {
  try {
    console.log('🔍 Debugging ST_Split failure...');
    
    // Get the intersection details
    const intersectionResult = await pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name,
        t1.geometry as trail1_geom,
        t2.geometry as trail2_geom,
        ST_Intersection(t1.geometry, t2.geometry) as intersection_geom,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_NumGeometries(ST_Intersection(t1.geometry, t2.geometry)) as point_count
      FROM staging.trails t1
      JOIN staging.trails t2 ON t1.app_uuid != t2.app_uuid
      WHERE (t1.app_uuid = 'c55c0383-f02c-4761-aebe-26098441802d' AND t2.app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336')
         OR (t1.app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336' AND t2.app_uuid = 'c55c0383-f02c-4761-aebe-26098441802d')
    `);
    
    if (intersectionResult.rows.length === 0) {
      console.log('❌ No intersection found');
      return;
    }
    
    const row = intersectionResult.rows[0];
    console.log(`📍 Intersection: ${row.trail1_name} ↔ ${row.trail2_name}`);
    console.log(`   Type: ${row.intersection_type}`);
    console.log(`   Point count: ${row.point_count}`);
    
    // Test ST_Split on trail1 (Foothills North Trail)
    console.log(`\n🔧 Testing ST_Split on ${row.trail1_name}...`);
    
    const splitResult = await pgClient.query(`
      SELECT 
        ST_Split($1::geometry, $2::geometry) as split_geom,
        ST_GeometryType(ST_Split($1::geometry, $2::geometry)) as split_type,
        ST_NumGeometries(ST_Split($1::geometry, $2::geometry)) as split_count
    `, [row.trail1_geom, row.intersection_geom]);
    
    console.log(`   Split result type: ${splitResult.rows[0].split_type}`);
    console.log(`   Split result count: ${splitResult.rows[0].split_count}`);
    
    if (splitResult.rows[0].split_geom) {
      console.log(`   ✅ Split geometry exists`);
      
      // Try to extract segments
      const segmentsResult = await pgClient.query(`
        SELECT 
          (ST_Dump($1::geometry)).path[1] as segment_num,
          ST_GeometryType((ST_Dump($1::geometry)).geom) as segment_type,
          ST_Length((ST_Dump($1::geometry)).geom::geography) as length_m
        FROM (SELECT $1::geometry as geom) as g
        ORDER BY segment_num
      `, [splitResult.rows[0].split_geom]);
      
      console.log(`   📏 Segments found: ${segmentsResult.rows.length}`);
      for (const segment of segmentsResult.rows) {
        console.log(`      Segment ${segment.segment_num}: ${segment.segment_type} (${parseFloat(segment.length_m).toFixed(1)}m)`);
      }
    } else {
      console.log(`   ❌ Split geometry is null`);
    }
    
    // Test ST_Split on trail2 (North Sky Trail)
    console.log(`\n🔧 Testing ST_Split on ${row.trail2_name}...`);
    
    const splitResult2 = await pgClient.query(`
      SELECT 
        ST_Split($1::geometry, $2::geometry) as split_geom,
        ST_GeometryType(ST_Split($1::geometry, $2::geometry)) as split_type,
        ST_NumGeometries(ST_Split($1::geometry, $2::geometry)) as split_count
    `, [row.trail2_geom, row.intersection_geom]);
    
    console.log(`   Split result type: ${splitResult2.rows[0].split_type}`);
    console.log(`   Split result count: ${splitResult2.rows[0].split_count}`);
    
    if (splitResult2.rows[0].split_geom) {
      console.log(`   ✅ Split geometry exists`);
      
      // Try to extract segments
      const segmentsResult2 = await pgClient.query(`
        SELECT 
          (ST_Dump($1::geometry)).path[1] as segment_num,
          ST_GeometryType((ST_Dump($1::geometry)).geom) as segment_type,
          ST_Length((ST_Dump($1::geometry)).geom::geography) as length_m
        FROM (SELECT $1::geometry as geom) as g
        ORDER BY segment_num
      `, [splitResult2.rows[0].split_geom]);
      
      console.log(`   📏 Segments found: ${segmentsResult2.rows.length}`);
      for (const segment of segmentsResult2.rows) {
        console.log(`      Segment ${segment.segment_num}: ${segment.segment_type} (${parseFloat(segment.length_m).toFixed(1)}m)`);
      }
    } else {
      console.log(`   ❌ Split geometry is null`);
    }
    
    // Let's also test with individual points from the MultiPoint
    console.log(`\n🔧 Testing with individual points...`);
    
    const pointsResult = await pgClient.query(`
      SELECT 
        (ST_Dump($1::geometry)).geom as point_geom,
        (ST_Dump($1::geometry)).path as point_path
      FROM (SELECT $1::geometry as geom) as g
    `, [row.intersection_geom]);
    
    console.log(`   Found ${pointsResult.rows.length} intersection points`);
    
    for (let i = 0; i < pointsResult.rows.length; i++) {
      const point = pointsResult.rows[i];
      console.log(`   Point ${i + 1}: ${point.point_path}`);
      
      // Test splitting with individual point
      const pointSplitResult = await pgClient.query(`
        SELECT 
          ST_Split($1::geometry, $2::geometry) as split_geom,
          ST_GeometryType(ST_Split($1::geometry, $2::geometry)) as split_type,
          ST_NumGeometries(ST_Split($1::geometry, $2::geometry)) as split_count
      `, [row.trail1_geom, point.point_geom]);
      
      console.log(`      Split with point ${i + 1}: ${pointSplitResult.rows[0].split_type} (${pointSplitResult.rows[0].split_count} parts)`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testSplitDebug();
