const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'postgres',
  password: 'postgres'
});

async function debugShanahanIntersection() {
  try {
    console.log('🔍 Debugging Shanahan intersection...');
    
    // Get the two trails
    const trail1Result = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(geometry) as geom_wkt, ST_Length(geometry::geography) as length_m
      FROM public.trails 
      WHERE app_uuid = '643fc095-8bbd-4310-9028-723484460fbd' AND source = 'cotrex'
    `);
    
    const trail2Result = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(geometry) as geom_wkt, ST_Length(geometry::geography) as length_m
      FROM public.trails 
      WHERE app_uuid = '67143e1d-83c5-4223-9c58-3c6f670fd7b2' AND source = 'cotrex'
    `);
    
    if (trail1Result.rows.length === 0 || trail2Result.rows.length === 0) {
      console.log('❌ One or both trails not found');
      return;
    }
    
    const trail1 = trail1Result.rows[0];
    const trail2 = trail2Result.rows[0];
    
    console.log(`Trail 1: ${trail1.name} (${trail1.length_m.toFixed(1)}m)`);
    console.log(`Trail 2: ${trail2.name} (${trail2.length_m.toFixed(1)}m)`);
    
    // Check the expected intersection point
    const expectedPoint = 'POINT(-105.270401 39.966296)';
    
    // Find distance from each trail to the expected intersection point
    const distance1Result = await pgClient.query(`
      SELECT ST_Distance(geometry, ST_GeomFromText($1, 4326)) as distance_m
      FROM public.trails 
      WHERE app_uuid = $2 AND source = 'cotrex'
    `, [expectedPoint, trail1.app_uuid]);
    
    const distance2Result = await pgClient.query(`
      SELECT ST_Distance(geometry, ST_GeomFromText($1, 4326)) as distance_m
      FROM public.trails 
      WHERE app_uuid = $2 AND source = 'cotrex'
    `, [expectedPoint, trail2.app_uuid]);
    
    console.log(`Distance from ${trail1.name} to expected intersection: ${distance1Result.rows[0].distance_m.toFixed(2)}m`);
    console.log(`Distance from ${trail2.name} to expected intersection: ${distance2Result.rows[0].distance_m.toFixed(2)}m`);
    
    // Find the closest points on each trail to the expected intersection
    const closest1Result = await pgClient.query(`
      SELECT ST_AsText(ST_ClosestPoint(geometry, ST_GeomFromText($1, 4326))) as closest_point
      FROM public.trails 
      WHERE app_uuid = $2 AND source = 'cotrex'
    `, [expectedPoint, trail1.app_uuid]);
    
    const closest2Result = await pgClient.query(`
      SELECT ST_AsText(ST_ClosestPoint(geometry, ST_GeomFromText($1, 4326))) as closest_point
      FROM public.trails 
      WHERE app_uuid = $2 AND source = 'cotrex'
    `, [expectedPoint, trail2.app_uuid]);
    
    console.log(`Closest point on ${trail1.name}: ${closest1Result.rows[0].closest_point}`);
    console.log(`Closest point on ${trail2.name}: ${closest2Result.rows[0].closest_point}`);
    
    // Check if the expected point is actually on either trail
    const onTrail1Result = await pgClient.query(`
      SELECT ST_DWithin(geometry, ST_GeomFromText($1, 4326), 0.0001) as on_trail
      FROM public.trails 
      WHERE app_uuid = $2 AND source = 'cotrex'
    `, [expectedPoint, trail1.app_uuid]);
    
    const onTrail2Result = await pgClient.query(`
      SELECT ST_DWithin(geometry, ST_GeomFromText($1, 4326), 0.0001) as on_trail
      FROM public.trails 
      WHERE app_uuid = $2 AND source = 'cotrex'
    `, [expectedPoint, trail2.app_uuid]);
    
    console.log(`Expected point on ${trail1.name}: ${onTrail1Result.rows[0].on_trail}`);
    console.log(`Expected point on ${trail2.name}: ${onTrail2Result.rows[0].on_trail}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pgClient.end();
  }
}

debugShanahanIntersection();
