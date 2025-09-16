const { Pool } = require('pg');

// Database connection
const pgClient = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function testMultipointServiceFoothills() {
  try {
    console.log('🔍 Testing MultipointIntersectionSplittingService on Foothills North Trail intersection...');
    
    // Check if the intersection exists
    const intersectionResult = await pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name,
        ST_Intersection(t1.geometry, t2.geometry) as intersection_geom,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_NumGeometries(ST_Intersection(t1.geometry, t2.geometry)) as point_count
      FROM debug_1757184346845.trails t1
      JOIN debug_1757184346845.trails t2 ON t1.app_uuid < t2.app_uuid
      WHERE t1.app_uuid = 'ab36dded-56f4-4a1d-bd16-6781586a3336' 
        AND t2.app_uuid = 'fd117aae-47ec-4754-86ed-46ec36a53902'
        AND ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_MultiPoint'
    `);
    
    if (intersectionResult.rows.length === 0) {
      console.log('❌ Intersection not found');
      return;
    }
    
    const intersection = intersectionResult.rows[0];
    console.log(`✅ Found intersection: ${intersection.trail1_name} × ${intersection.trail2_name}`);
    console.log(`   Type: ${intersection.intersection_type}`);
    console.log(`   Points: ${intersection.point_count}`);
    
    // Test the splitting logic directly
    console.log('\n🔧 Testing splitting logic...');
    
    const client = await pgClient.connect();
    try {
      await client.query('BEGIN');
      
      // Get the trail geometries
      const trail1Result = await client.query(`
        SELECT geometry FROM debug_1757184346845.trails WHERE app_uuid = $1
      `, [intersection.trail1_uuid]);
      
      const trail2Result = await client.query(`
        SELECT geometry FROM debug_1757184346845.trails WHERE app_uuid = $1
      `, [intersection.trail2_uuid]);
      
      if (trail1Result.rows.length === 0 || trail2Result.rows.length === 0) {
        console.log('❌ Trails not found');
        return;
      }
      
      const trail1Geom = trail1Result.rows[0].geometry;
      const trail2Geom = trail2Result.rows[0].geometry;
      
      // Test splitting trail1
      console.log(`\n🔧 Splitting ${intersection.trail1_name}...`);
      const split1Result = await client.query(`
        SELECT ST_Split($1::geometry, $2::geometry) as split_geom
      `, [trail1Geom, intersection.intersection_geom]);
      
      if (split1Result.rows.length > 0 && split1Result.rows[0].split_geom) {
        const splitGeom = split1Result.rows[0].split_geom;
        
        // Count segments
        const segmentsResult = await client.query(`
          SELECT ST_NumGeometries($1::geometry) as segment_count
        `, [splitGeom]);
        
        const segmentCount = segmentsResult.rows[0].segment_count;
        console.log(`   ✅ Split into ${segmentCount} segments`);
        
        // Check segment lengths
        const segmentsLengthResult = await client.query(`
          SELECT 
            (ST_Dump($1::geometry)).geom as segment_geom,
            ST_Length((ST_Dump($1::geometry)).geom::geography) as length_m
          FROM (SELECT $1::geometry as geom) as g
        `, [splitGeom]);
        
        console.log('   Segment lengths:');
        segmentsLengthResult.rows.forEach((row, i) => {
          console.log(`     Segment ${i + 1}: ${parseFloat(row.length_m).toFixed(2)}m`);
        });
      } else {
        console.log('   ❌ Split failed - no geometry returned');
      }
      
      // Test splitting trail2
      console.log(`\n🔧 Splitting ${intersection.trail2_name}...`);
      const split2Result = await client.query(`
        SELECT ST_Split($1::geometry, $2::geometry) as split_geom
      `, [trail2Geom, intersection.intersection_geom]);
      
      if (split2Result.rows.length > 0 && split2Result.rows[0].split_geom) {
        const splitGeom = split2Result.rows[0].split_geom;
        
        // Count segments
        const segmentsResult = await client.query(`
          SELECT ST_NumGeometries($1::geometry) as segment_count
        `, [splitGeom]);
        
        const segmentCount = segmentsResult.rows[0].segment_count;
        console.log(`   ✅ Split into ${segmentCount} segments`);
        
        // Check segment lengths
        const segmentsLengthResult = await client.query(`
          SELECT 
            (ST_Dump($1::geometry)).geom as segment_geom,
            ST_Length((ST_Dump($1::geometry)).geom::geography) as length_m
          FROM (SELECT $1::geometry as geom) as g
        `, [splitGeom]);
        
        console.log('   Segment lengths:');
        segmentsLengthResult.rows.forEach((row, i) => {
          console.log(`     Segment ${i + 1}: ${parseFloat(row.length_m).toFixed(2)}m`);
        });
      } else {
        console.log('   ❌ Split failed - no geometry returned');
      }
      
      await client.query('ROLLBACK');
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testMultipointServiceFoothills();
