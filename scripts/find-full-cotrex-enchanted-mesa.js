const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function findFullCOTREXEnchantedMesa() {
  try {
    console.log('🔍 Finding full COTREX version of Enchanted Mesa Trail...');
    
    // Get all COTREX trails that might be Enchanted Mesa
    const cotrexTrailsResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_AsText(geometry) as geom_text,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat
      FROM public.trails 
      WHERE source = 'cotrex'
        AND (
          name ILIKE '%enchanted%' 
          OR name ILIKE '%mesa%'
          OR ST_DWithin(
            geometry::geography, 
            ST_GeomFromText('POINT(-105.281546 39.994957)', 4326)::geography, 
            1000
          )
          OR ST_DWithin(
            geometry::geography, 
            ST_GeomFromText('POINT(-105.285635 39.987563)', 4326)::geography, 
            1000
          )
        )
      ORDER BY length_meters DESC
    `);
    
    console.log(`📊 Found ${cotrexTrailsResult.rows.length} potential COTREX Enchanted Mesa trails:`);
    
    cotrexTrailsResult.rows.forEach((trail, index) => {
      console.log(`\n   ${index + 1}. ${trail.name}`);
      console.log(`      - Length: ${Math.round(trail.length_meters)}m`);
      console.log(`      - Points: ${trail.num_points}`);
      console.log(`      - Start: (${trail.start_lng.toFixed(6)}, ${trail.start_lat.toFixed(6)})`);
      console.log(`      - End: (${trail.end_lng.toFixed(6)}, ${trail.end_lat.toFixed(6)})`);
    });
    
    // Also check for any COTREX trails that are similar length to OSM Enchanted Mesa (1558m)
    console.log(`\n🔍 Looking for COTREX trails with similar length to OSM Enchanted Mesa (1558m):`);
    
    const similarLengthResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        ST_Length(geometry::geography) as length_meters,
        ST_NumPoints(geometry) as num_points,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat
      FROM public.trails 
      WHERE source = 'cotrex'
        AND ST_Length(geometry::geography) BETWEEN 1000 AND 2000
      ORDER BY ABS(ST_Length(geometry::geography) - 1558)
      LIMIT 10
    `);
    
    console.log(`📊 Found ${similarLengthResult.rows.length} COTREX trails with similar length:`);
    
    similarLengthResult.rows.forEach((trail, index) => {
      const diff = Math.abs(trail.length_meters - 1558);
      console.log(`\n   ${index + 1}. ${trail.name}`);
      console.log(`      - Length: ${Math.round(trail.length_meters)}m (diff: ${Math.round(diff)}m)`);
      console.log(`      - Points: ${trail.num_points}`);
      console.log(`      - Start: (${trail.start_lng.toFixed(6)}, ${trail.start_lat.toFixed(6)})`);
      console.log(`      - End: (${trail.end_lng.toFixed(6)}, ${trail.end_lat.toFixed(6)})`);
    });
    
    // Check if there are any COTREX trails that intersect with the OSM Enchanted Mesa
    console.log(`\n🔗 Checking for COTREX trails that intersect with OSM Enchanted Mesa:`);
    
    const intersectingResult = await pgClient.query(`
      WITH osm_enchanted_mesa AS (
        SELECT geometry 
        FROM public.trails 
        WHERE name = 'Enchanted Mesa Trail' AND source = 'osm'
      )
      SELECT 
        t.app_uuid, 
        t.name, 
        ST_Length(t.geometry::geography) as length_meters,
        ST_NumPoints(t.geometry) as num_points,
        ST_Distance(t.geometry::geography, osm.geometry::geography) as distance_to_osm
      FROM public.trails t, osm_enchanted_mesa osm
      WHERE t.source = 'cotrex'
        AND ST_DWithin(t.geometry::geography, osm.geometry::geography, 100)
      ORDER BY distance_to_osm
      LIMIT 10
    `);
    
    console.log(`📊 Found ${intersectingResult.rows.length} COTREX trails near OSM Enchanted Mesa:`);
    
    intersectingResult.rows.forEach((trail, index) => {
      console.log(`\n   ${index + 1}. ${trail.name}`);
      console.log(`      - Length: ${Math.round(trail.length_meters)}m`);
      console.log(`      - Points: ${trail.num_points}`);
      console.log(`      - Distance to OSM: ${Math.round(trail.distance_to_osm)}m`);
    });
    
    console.log('\n✅ Full COTREX Enchanted Mesa search completed');
    
  } catch (error) {
    console.error('❌ Error finding full COTREX Enchanted Mesa:', error);
  } finally {
    await pgClient.end();
  }
}

findFullCOTREXEnchantedMesa();
