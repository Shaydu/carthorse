const { Pool } = require('pg');

async function testTrailSplitting() {
  const pool = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'postgres',
    password: 'postgres',
    port: 5432
  });

  try {
    console.log('🧪 Testing Trail Splitting Logic...\n');

    // Test bbox
    const bbox = [-105.31066199999995, 39.94028265456106, -105.25606574999985, 40.00601325800281];
    
    // 1. Check original trail count
    const originalCountResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM public.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326)) 
        AND source = 'cotrex'
    `, bbox);
    
    const originalCount = parseInt(originalCountResult.rows[0].count);
    console.log(`📊 Original trails in bbox: ${originalCount}`);

    // 2. Check what intersections we should detect
    const intersectionResult = await pool.query(`
      WITH trail_geometries AS (
        SELECT geometry, app_uuid, name
        FROM public.trails 
        WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326)) 
          AND source = 'cotrex'
      ),
      intersections AS (
        SELECT 
          ST_Intersection(t1.geometry, t2.geometry) as intersection_point,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names
        FROM trail_geometries t1
        JOIN trail_geometries t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
      )
      SELECT COUNT(*) as intersection_count
      FROM intersections
    `, bbox);
    
    const intersectionCount = parseInt(intersectionResult.rows[0].intersection_count);
    console.log(`🔗 Expected intersections: ${intersectionCount}`);

    // 3. Check T-intersections (endpoints near other trails)
    const tIntersectionResult = await pool.query(`
      WITH trail_geometries AS (
        SELECT geometry, app_uuid, name
        FROM public.trails 
        WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326)) 
          AND source = 'cotrex'
      ),
      t_intersections AS (
        SELECT 
          ST_ClosestPoint(t1.geometry, ST_StartPoint(t2.geometry)) as intersection_point,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names
        FROM trail_geometries t1
        JOIN trail_geometries t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t1.geometry::geography, ST_StartPoint(t2.geometry)::geography, 2.0)
          AND ST_Distance(t1.geometry::geography, ST_StartPoint(t2.geometry)::geography) > 0
          AND ST_Distance(t1.geometry::geography, ST_StartPoint(t2.geometry)::geography) <= 2.0
        UNION ALL
        SELECT 
          ST_ClosestPoint(t1.geometry, ST_EndPoint(t2.geometry)) as intersection_point,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names
        FROM trail_geometries t1
        JOIN trail_geometries t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t1.geometry::geography, ST_EndPoint(t2.geometry)::geography, 2.0)
          AND ST_Distance(t1.geometry::geography, ST_EndPoint(t2.geometry)::geography) > 0
          AND ST_Distance(t1.geometry::geography, ST_EndPoint(t2.geometry)::geography) <= 2.0
      )
      SELECT COUNT(*) as t_intersection_count
      FROM t_intersections
    `, bbox);
    
    const tIntersectionCount = parseInt(tIntersectionResult.rows[0].t_intersection_count);
    console.log(`🔗 Expected T-intersections: ${tIntersectionCount}`);

    // 4. Expected total segments after splitting
    const expectedSegments = originalCount + intersectionCount + tIntersectionCount;
    console.log(`📊 Expected segments after splitting: ~${expectedSegments} (original + intersections + T-intersections)`);

    console.log('\n✅ Test completed!');
    console.log('\n📋 Summary:');
    console.log(`   - Original trails: ${originalCount}`);
    console.log(`   - True intersections: ${intersectionCount}`);
    console.log(`   - T-intersections: ${tIntersectionCount}`);
    console.log(`   - Expected segments: ~${expectedSegments}`);
    console.log(`   - Previous result: 3 segments (❌ WRONG!)`);
    console.log(`   - Target: Should be closer to ${expectedSegments} segments`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testTrailSplitting();
