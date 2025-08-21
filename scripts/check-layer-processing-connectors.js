const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function checkLayerProcessingConnectors() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔍 Checking connector trails through processing layers...');
    
    // Define the connector trail IDs we found
    const connectorIds = [
      'df3b7eb8-b3bf-4ad8-bed8-979c6378f870',
      'e4a5c9d2-f1e3-4567-89ab-cdef01234567',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    ];
    
    // Check Layer 1 processing
    console.log('\n📊 LAYER 1 - Checking if connector trails made it through:');
    for (const id of connectorIds) {
      const layer1Result = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          ST_Length(geometry) as length_meters,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point
        FROM layer1.trails 
        WHERE app_uuid = $1
      `, [id]);
      
      if (layer1Result.rows.length > 0) {
        console.log(`✅ ${id}: Found in Layer 1 - ${layer1Result.rows[0].length_meters.toFixed(2)}m`);
      } else {
        console.log(`❌ ${id}: NOT found in Layer 1`);
      }
    }
    
    // Check Layer 2 processing
    console.log('\n📊 LAYER 2 - Checking if connector trails made it through:');
    for (const id of connectorIds) {
      const layer2Result = await pgClient.query(`
        SELECT 
          app_uuid,
          name,
          ST_Length(geometry) as length_meters,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point
        FROM layer2.trails 
        WHERE app_uuid = $1
      `, [id]);
      
      if (layer2Result.rows.length > 0) {
        console.log(`✅ ${id}: Found in Layer 2 - ${layer2Result.rows[0].length_meters.toFixed(2)}m`);
      } else {
        console.log(`❌ ${id}: NOT found in Layer 2`);
      }
    }
    
    // Check what's in the export bbox area for each layer
    const bbox = {
      minLng: -105.30958159914027,
      minLat: 40.07269607609242,
      maxLng: -105.26885500804738,
      maxLat: 40.09658466878596
    };
    
    console.log('\n📊 TRAIL COUNTS IN EXPORT BBOX AREA:');
    
    // Count trails in original data
    const originalCount = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM public.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    
    console.log(`Original public.trails: ${originalCount.rows[0].count} trails`);
    
    // Count trails in Layer 1
    const layer1Count = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM layer1.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    
    console.log(`Layer 1 trails: ${layer1Count.rows[0].count} trails`);
    
    // Count trails in Layer 2
    const layer2Count = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM layer2.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    
    console.log(`Layer 2 trails: ${layer2Count.rows[0].count} trails`);
    
    // Check for very short trails in each layer
    console.log('\n📊 VERY SHORT TRAILS (< 5m) IN EACH LAYER:');
    
    const shortOriginal = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM public.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
        AND ST_Length(geometry) < 5
    `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    
    console.log(`Original public.trails: ${shortOriginal.rows[0].count} trails < 5m`);
    
    const shortLayer1 = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM layer1.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
        AND ST_Length(geometry) < 5
    `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    
    console.log(`Layer 1 trails: ${shortLayer1.rows[0].count} trails < 5m`);
    
    const shortLayer2 = await pgClient.query(`
      SELECT COUNT(*) as count
      FROM layer2.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
        AND ST_Length(geometry) < 5
    `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    
    console.log(`Layer 2 trails: ${shortLayer2.rows[0].count} trails < 5m`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.release();
    await pool.end();
  }
}

checkLayerProcessingConnectors();
