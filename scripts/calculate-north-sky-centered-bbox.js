const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function calculateNorthSkyCenteredBbox() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🗺️ Calculating North Sky Trail intersection center...');
    
    // Original bbox dimensions
    const originalBbox = {
      minLng: -105.30123174925316,
      minLat: 39.96928418458248,
      maxLng: -105.26050515816028,
      maxLat: 39.993172777276015
    };
    
    // Calculate original bbox dimensions
    const originalWidth = originalBbox.maxLng - originalBbox.minLng;
    const originalHeight = originalBbox.maxLat - originalBbox.minLat;
    
    console.log('📏 Original bbox dimensions:');
    console.log(`   Width: ${originalWidth.toFixed(6)} degrees (longitude)`);
    console.log(`   Height: ${originalHeight.toFixed(6)} degrees (latitude)`);
    console.log(`   Center: (${((originalBbox.minLng + originalBbox.maxLng) / 2).toFixed(6)}, ${((originalBbox.minLat + originalBbox.maxLat) / 2).toFixed(6)})`);
    
    // Find the North Sky Trail intersection center
    console.log('\n🔍 Finding North Sky Trail intersection center...');
    const intersectionCenter = await pgClient.query(`
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
      combined AS (
        SELECT ST_Union(ns.geom, fh.geom) as combined_geom
        FROM north_sky ns, foothills fh
      )
      SELECT 
        ST_AsText(ST_Centroid(combined_geom)) as center_point,
        ST_X(ST_Centroid(combined_geom)) as center_lng,
        ST_Y(ST_Centroid(combined_geom)) as center_lat
      FROM combined
    `);
    
    if (intersectionCenter.rows.length === 0) {
      console.log('❌ No intersection found');
      return;
    }
    
    const center = intersectionCenter.rows[0];
    console.log(`📍 North Sky ↔ Foothills North intersection center: ${center.center_point}`);
    console.log(`   Longitude: ${center.center_lng.toFixed(6)}`);
    console.log(`   Latitude: ${center.center_lat.toFixed(6)}`);
    
    // Calculate new bbox centered on the intersection
    const halfWidth = originalWidth / 2;
    const halfHeight = originalHeight / 2;
    
    const newBbox = {
      minLng: center.center_lng - halfWidth,
      maxLng: center.center_lng + halfWidth,
      minLat: center.center_lat - halfHeight,
      maxLat: center.center_lat + halfHeight
    };
    
    console.log('\n🎯 New bbox centered on North Sky intersection:');
    console.log(`   minLng: ${newBbox.minLng.toFixed(14)}`);
    console.log(`   minLat: ${newBbox.minLat.toFixed(14)}`);
    console.log(`   maxLng: ${newBbox.maxLng.toFixed(14)}`);
    console.log(`   maxLat: ${newBbox.maxLat.toFixed(14)}`);
    
    // Verify dimensions are the same
    const newWidth = newBbox.maxLng - newBbox.minLng;
    const newHeight = newBbox.maxLat - newBbox.minLat;
    
    console.log('\n📏 New bbox dimensions (should match original):');
    console.log(`   Width: ${newWidth.toFixed(6)} degrees (longitude)`);
    console.log(`   Height: ${newHeight.toFixed(6)} degrees (latitude)`);
    console.log(`   Center: (${((newBbox.minLng + newBbox.maxLng) / 2).toFixed(6)}, ${((newBbox.minLat + newBbox.maxLat) / 2).toFixed(6)})`);
    
    // Generate the command
    console.log('\n🚀 Updated command:');
    console.log(`npx ts-node src/cli/export.ts --region boulder --out /Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test.geojson --format geojson --bbox ${newBbox.minLng.toFixed(14)},${newBbox.minLat.toFixed(14)},${newBbox.maxLng.toFixed(14)},${newBbox.maxLat.toFixed(14)} --disable-trailheads-only --no-trailheads --skip-validation --no-cleanup --verbose --source cotrex`);
    
    // Also show the bbox coordinates in a more readable format
    console.log('\n📋 Bbox coordinates for easy copying:');
    console.log(`${newBbox.minLng.toFixed(14)},${newBbox.minLat.toFixed(14)},${newBbox.maxLng.toFixed(14)},${newBbox.maxLat.toFixed(14)}`);
    
  } catch (error) {
    console.error('❌ Error during calculation:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
calculateNorthSkyCenteredBbox().catch(console.error);
