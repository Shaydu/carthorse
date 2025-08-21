const { Pool } = require('pg');

async function testBroaderSimplicity() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    console.log('🔍 Testing broader geometry simplicity logic...');
    
    // Count how many trails would be affected by the new logic
    const countQuery = await pool.query(`
      SELECT 
        COUNT(*) as total_intersections,
        COUNT(CASE WHEN NOT ST_IsSimple(ST_Union(t1.geometry, t2.geometry)) THEN 1 END) as non_simple_intersections,
        COUNT(CASE WHEN ST_IsSimple(ST_Union(t1.geometry, t2.geometry)) THEN 1 END) as simple_intersections
      FROM public.trails t1
      JOIN public.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > 200.0
        AND ST_Length(t2.geometry::geography) > 200.0
    `);
    
    console.log('📊 Intersection Analysis:');
    console.log(`   Total intersections: ${countQuery.rows[0].total_intersections}`);
    console.log(`   Non-simple intersections (would be split): ${countQuery.rows[0].non_simple_intersections}`);
    console.log(`   Simple intersections (would NOT be split): ${countQuery.rows[0].simple_intersections}`);
    console.log(`   Percentage that would be split: ${((countQuery.rows[0].non_simple_intersections / countQuery.rows[0].total_intersections) * 100).toFixed(1)}%`);
    
    // Show some examples of trails that would NOT be split
    console.log('\n📊 Examples of trails that would NOT be split (simple intersections):');
    const simpleExamples = await pool.query(`
      SELECT DISTINCT
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type
      FROM public.trails t1
      JOIN public.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > 200.0
        AND ST_Length(t2.geometry::geography) > 200.0
        AND ST_IsSimple(ST_Union(t1.geometry, t2.geometry))
      LIMIT 5
    `);
    
    simpleExamples.rows.forEach(row => {
      console.log(`   - ${row.trail1_name} + ${row.trail2_name} (${row.intersection_type})`);
    });
    
    // Show some examples of trails that WOULD be split
    console.log('\n📊 Examples of trails that WOULD be split (non-simple intersections):');
    const nonSimpleExamples = await pool.query(`
      SELECT DISTINCT
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type
      FROM public.trails t1
      JOIN public.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > 200.0
        AND ST_Length(t2.geometry::geography) > 200.0
        AND NOT ST_IsSimple(ST_Union(t1.geometry, t2.geometry))
      LIMIT 5
    `);
    
    nonSimpleExamples.rows.forEach(row => {
      console.log(`   - ${row.trail1_name} + ${row.trail2_name} (${row.intersection_type})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

testBroaderSimplicity();
