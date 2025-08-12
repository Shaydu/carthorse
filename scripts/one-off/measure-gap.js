const { Pool } = require('pg');
require('dotenv').config();

async function measureGap() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'tester',
    password: process.env.DB_PASSWORD || 'test'
  });

  try {
    // Find the staging schema
    const schemaResult = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`🔍 Using staging schema: ${stagingSchema}`);
    
    // Find the two Mesa Trail segments
    const trailsResult = await pool.query(`
      SELECT 
        id,
        app_uuid,
        name,
        ST_StartPoint(the_geom) as start_pt,
        ST_EndPoint(the_geom) as end_pt,
        ST_AsText(ST_StartPoint(the_geom)) as start_text,
        ST_AsText(ST_EndPoint(the_geom)) as end_text,
        ST_Length(the_geom) * 111 as length_km
      FROM ${stagingSchema}.ways_noded
      WHERE app_uuid IN ('e2ac3776-e59e-449a-8f3c-73fc478b5123', 'ed6b9f42-90fa-4472-aaf7-bb0872aaa8f0')
      ORDER BY app_uuid
    `);
    
    console.log(`🔍 Found ${trailsResult.rows.length} Mesa Trail segments:`);
    trailsResult.rows.forEach(trail => {
      console.log(`  - ${trail.app_uuid}: ${trail.name} (${trail.length_km.toFixed(3)}km)`);
      console.log(`    Start: ${trail.start_text}`);
      console.log(`    End: ${trail.end_text}`);
    });
    
    if (trailsResult.rows.length === 2) {
      const trail1 = trailsResult.rows[0];
      const trail2 = trailsResult.rows[1];
      
      // Calculate distances between all endpoints
      const distances = await pool.query(`
        SELECT 
          ST_Distance($1, $2) * 111000 as distance_meters,
          ST_Distance($1, $3) * 111000 as distance_meters_2,
          ST_Distance($4, $2) * 111000 as distance_meters_3,
          ST_Distance($4, $3) * 111000 as distance_meters_4
        FROM (SELECT 1) as dummy
      `, [trail1.start_pt, trail2.start_pt, trail2.end_pt, trail1.end_pt]);
      
      const dist = distances.rows[0];
      console.log('\n📏 Distances between endpoints:');
      console.log(`  Trail1 start → Trail2 start: ${dist.distance_meters.toFixed(1)}m`);
      console.log(`  Trail1 start → Trail2 end: ${dist.distance_meters_2.toFixed(1)}m`);
      console.log(`  Trail1 end → Trail2 start: ${dist.distance_meters_3.toFixed(1)}m`);
      console.log(`  Trail1 end → Trail2 end: ${dist.distance_meters_4.toFixed(1)}m`);
      
      // Find the minimum distance
      const minDistance = Math.min(dist.distance_meters, dist.distance_meters_2, dist.distance_meters_3, dist.distance_meters_4);
      console.log(`\n🎯 Minimum gap: ${minDistance.toFixed(1)}m`);
      
      // Check if this would be caught by our degree-1 joining logic
      const joinTolerance = 0.0001; // ~10 meters
      const wouldJoin = minDistance <= (joinTolerance * 111000);
      console.log(`🔗 Would be joined by degree-1 logic (${joinTolerance * 111000}m tolerance): ${wouldJoin ? 'YES' : 'NO'}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

measureGap();
