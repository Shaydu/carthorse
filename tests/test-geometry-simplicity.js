const { Pool } = require('pg');

async function testGeometrySimplicity() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    console.log('🔍 Testing geometry simplicity logic...');
    
    // Test with North Sky Trail and other trails to see which ones would be split
    const testQuery = await pool.query(`
      WITH north_sky AS (
        SELECT app_uuid, name, geometry 
        FROM public.trails 
        WHERE name = 'North Sky Trail' 
        AND ST_Length(geometry::geography) > 5000
      )
      SELECT 
        t.app_uuid,
        t.name, 
        t.source, 
        ST_Length(t.geometry::geography) as length_meters,
        ST_Intersects(t.geometry, ns.geometry) as intersects,
        ST_GeometryType(ST_Intersection(t.geometry, ns.geometry)) as intersection_type,
        ST_IsSimple(ST_Union(t.geometry, ns.geometry)) as is_simple_union,
        ST_LineLocatePoint(t.geometry, ST_Intersection(t.geometry, ns.geometry)) as intersection_ratio
      FROM public.trails t, north_sky ns 
      WHERE ST_Intersects(t.geometry, ns.geometry) 
      AND t.app_uuid != ns.app_uuid
      AND ST_Length(t.geometry::geography) > 200.0
      ORDER BY length_meters DESC
      LIMIT 10
    `);
    
    console.log('📊 Trails that intersect with North Sky Trail:');
    if (testQuery.rows.length === 0) {
      console.log('   - No intersections found');
    } else {
      testQuery.rows.forEach(row => {
        console.log(`   - ${row.name} (${row.app_uuid}):`);
        console.log(`     Length: ${row.length_meters}m`);
        console.log(`     Intersects: ${row.intersects}`);
        console.log(`     Intersection type: ${row.intersection_type}`);
        console.log(`     Is simple union: ${row.is_simple_union}`);
        console.log(`     Intersection ratio: ${row.intersection_ratio}`);
        console.log(`     Would be split: ${!row.is_simple_union && row.intersection_ratio > 0.05 && row.intersection_ratio < 0.95 ? 'YES' : 'NO'}`);
        console.log('');
      });
    }
    
    // Test with some known loop trails to see if they would be split
    console.log('📊 Testing with known loop trails:');
    const loopTestQuery = await pool.query(`
      SELECT 
        t1.app_uuid as trail1_uuid,
        t1.name as trail1_name,
        t2.app_uuid as trail2_uuid,
        t2.name as trail2_name,
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_IsSimple(ST_Union(t1.geometry, t2.geometry)) as is_simple_union
      FROM public.trails t1
      JOIN public.trails t2 ON t1.id < t2.id
      WHERE (t1.name ILIKE '%hogback%' OR t2.name ILIKE '%hogback%')
      AND ST_Intersects(t1.geometry, t2.geometry)
      AND ST_Length(t1.geometry::geography) > 200.0
      AND ST_Length(t2.geometry::geography) > 200.0
      LIMIT 5
    `);
    
    if (loopTestQuery.rows.length === 0) {
      console.log('   - No loop trail intersections found');
    } else {
      loopTestQuery.rows.forEach(row => {
        console.log(`   - ${row.trail1_name} + ${row.trail2_name}:`);
        console.log(`     Intersects: ${row.intersects}`);
        console.log(`     Intersection type: ${row.intersection_type}`);
        console.log(`     Is simple union: ${row.is_simple_union}`);
        console.log(`     Would be split: ${!row.is_simple_union ? 'YES' : 'NO'}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

testGeometrySimplicity();
