const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function analyzeNorthSkyFoothillsConnectors() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🔍 Analyzing North Sky ↔ Foothills connector trails...');
    
    // First, let's see what's in the original public.trails table
    console.log('\n📊 ORIGINAL public.trails - North Sky and Foothills trails:');
    const originalTrails = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_NumPoints(geometry) as num_points
      FROM public.trails 
      WHERE name ILIKE '%north sky%' OR name ILIKE '%foothills%'
      ORDER BY name, length_meters
    `);
    
    console.log(`Found ${originalTrails.rows.length} trails in original data:`);
    originalTrails.rows.forEach((trail, i) => {
      console.log(`  ${i+1}. ${trail.name} (${trail.length_meters.toFixed(1)}m, ${trail.num_points} points)`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });
    
    // Now let's check what's in the processed staging table
    console.log('\n📊 PROCESSED staging table - North Sky and Foothills trails:');
    const processedTrails = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_NumPoints(geometry) as num_points
      FROM carthorse_1755774476689.trails 
      WHERE name ILIKE '%north sky%' OR name ILIKE '%foothills%'
      ORDER BY name, length_meters
    `);
    
    console.log(`Found ${processedTrails.rows.length} trails in processed data:`);
    processedTrails.rows.forEach((trail, i) => {
      console.log(`  ${i+1}. ${trail.name} (${trail.length_meters.toFixed(1)}m, ${trail.num_points} points)`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });
    
    // Check for very short trails that might be connectors
    console.log('\n🔍 Looking for very short trails (< 10m) that might be connectors:');
    const shortTrails = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_NumPoints(geometry) as num_points
      FROM public.trails 
      WHERE ST_Length(geometry) < 10
        AND (name ILIKE '%north sky%' OR name ILIKE '%foothills%' OR name ILIKE '%connector%' OR name ILIKE '%link%')
      ORDER BY length_meters
    `);
    
    console.log(`Found ${shortTrails.rows.length} short trails that might be connectors:`);
    shortTrails.rows.forEach((trail, i) => {
      console.log(`  ${i+1}. ${trail.name} (${trail.length_meters.toFixed(1)}m, ${trail.num_points} points)`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });
    
    // Check for trails near the intersection area
    console.log('\n📍 Looking for trails near North Sky ↔ Foothills intersection area:');
    const intersectionArea = await pgClient.query(`
      WITH north_sky AS (
        SELECT ST_Collect(geometry) as geom
        FROM public.trails 
        WHERE name ILIKE '%north sky%'
      ),
      foothills AS (
        SELECT ST_Collect(geometry) as geom
        FROM public.trails 
        WHERE name ILIKE '%foothills north%'
      ),
      intersection_center AS (
        SELECT ST_Centroid(ST_Union(ns.geom, fh.geom)) as center
        FROM north_sky ns, foothills fh
      )
      SELECT 
        t.app_uuid,
        t.name,
        ST_Length(t.geometry) as length_meters,
        ST_Distance(t.geometry, ic.center) as distance_to_center,
        ST_AsText(ST_StartPoint(t.geometry)) as start_point,
        ST_AsText(ST_EndPoint(t.geometry)) as end_point,
        ST_NumPoints(t.geometry) as num_points
      FROM public.trails t, intersection_center ic
      WHERE ST_DWithin(t.geometry, ic.center, 200)  -- Within 200m of intersection center
        AND t.name NOT ILIKE '%north sky%' 
        AND t.name NOT ILIKE '%foothills%'
      ORDER BY distance_to_center, length_meters
    `);
    
    console.log(`Found ${intersectionArea.rows.length} trails near intersection area:`);
    intersectionArea.rows.forEach((trail, i) => {
      console.log(`  ${i+1}. ${trail.name} (${trail.length_meters.toFixed(1)}m, ${trail.distance_to_center.toFixed(1)}m from center)`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });
    
    // Check what happened during processing - look for trails that were removed
    console.log('\n❌ Checking for trails that might have been removed during processing:');
    const removedTrails = await pgClient.query(`
      SELECT 
        t1.app_uuid,
        t1.name,
        ST_Length(t1.geometry) as length_meters,
        ST_AsText(ST_StartPoint(t1.geometry)) as start_point,
        ST_AsText(ST_EndPoint(t1.geometry)) as end_point
      FROM public.trails t1
      LEFT JOIN carthorse_1755774476689.trails t2 ON t1.app_uuid = t2.app_uuid
      WHERE t2.app_uuid IS NULL
        AND (t1.name ILIKE '%north sky%' OR t1.name ILIKE '%foothills%' OR ST_Length(t1.geometry) < 10)
      ORDER BY t1.name, length_meters
    `);
    
    console.log(`Found ${removedTrails.rows.length} trails that were in original but not in processed:`);
    removedTrails.rows.forEach((trail, i) => {
      console.log(`  ${i+1}. ${trail.name} (${trail.length_meters.toFixed(1)}m)`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });
    
    // Check the bbox filtering
    console.log('\n🗺️ Checking bbox filtering:');
    const bboxTrails = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM public.trails 
      WHERE ST_Intersects(geometry, ST_MakeEnvelope(-105.30958159914027, 40.07269607609242, -105.26885500804738, 40.09658466878596, 4326))
        AND (name ILIKE '%north sky%' OR name ILIKE '%foothills%' OR ST_Length(geometry) < 10)
      ORDER BY name, length_meters
    `);
    
    console.log(`Found ${bboxTrails.rows.length} trails within the export bbox:`);
    bboxTrails.rows.forEach((trail, i) => {
      console.log(`  ${i+1}. ${trail.name} (${trail.length_meters.toFixed(1)}m)`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    });
    
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
analyzeNorthSkyFoothillsConnectors().catch(console.error);
