const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  user: 'shaydu',
  password: '',
  database: 'trail_master_db',
  port: 5432
});

async function checkCotrexTrailLocations() {
  try {
    console.log('🔍 Checking cotrex trail locations and bounding boxes...');
    
    // Get all cotrex trails with their bounding boxes
    const trailsResult = await pgClient.query(`
      SELECT 
        name, 
        app_uuid, 
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_Centroid(geometry)) as centroid,
        ST_AsText(ST_Envelope(geometry)) as bbox,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND source = 'cotrex'
      ORDER BY name, ST_Length(geometry::geography) DESC
    `);
    
    console.log(`🔍 Found ${trailsResult.rows.length} cotrex trails:\n`);
    
    trailsResult.rows.forEach((trail, index) => {
      console.log(`${index + 1}. ${trail.name} (${trail.app_uuid})`);
      console.log(`   Length: ${Math.round(trail.length_meters * 100) / 100}m`);
      console.log(`   Centroid: ${trail.centroid}`);
      console.log(`   Start: (${trail.start_lng}, ${trail.start_lat})`);
      console.log(`   End: (${trail.end_lng}, ${trail.end_lat})`);
      console.log(`   BBox: ${trail.bbox}`);
      console.log('');
    });
    
    // Check if any trails are in the target bbox area
    const targetBbox = [-105.29123174925316, 39.96928418458248, -105.28050515816028, 39.981172777276015];
    console.log(`🎯 Target bbox: [${targetBbox.join(', ')}]`);
    
    const bboxTrailsResult = await pgClient.query(`
      SELECT 
        name, 
        app_uuid, 
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_Centroid(geometry)) as centroid
      FROM public.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        AND source = 'cotrex'
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      ORDER BY name, ST_Length(geometry::geography) DESC
    `, targetBbox);
    
    console.log(`\n🎯 Trails in target bbox: ${bboxTrailsResult.rows.length}`);
    bboxTrailsResult.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.app_uuid}): ${Math.round(trail.length_meters * 100) / 100}m at ${trail.centroid}`);
    });
    
  } catch (error) {
    console.error('❌ Error checking cotrex trail locations:', error);
  } finally {
    await pgClient.end();
  }
}

checkCotrexTrailLocations();
