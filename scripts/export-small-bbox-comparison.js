const { Pool } = require('pg');
const fs = require('fs');

// Database connection
const pool = new Pool({
  host: 'localhost',
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'postgres',
  port: 5432
});

async function exportSmallBboxComparison() {
  const pgClient = await pool.connect();
  
  try {
    console.log('🗺️ Exporting small bbox comparison to GeoJSON...');
    
    // Export the backup (before) version
    console.log('📋 Exporting backup (before) version...');
    const backupResult = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_AsGeoJSON(geometry) as geojson
      FROM public.trails_snapped_small_backup
      ORDER BY name
    `);
    
    const backupFeatures = backupResult.rows.map(row => ({
      type: 'Feature',
      properties: {
        id: row.app_uuid,
        name: row.name,
        trail_type: row.trail_type,
        surface: row.surface,
        difficulty: row.difficulty,
        length_km: row.length_km,
        elevation_gain: row.elevation_gain,
        elevation_loss: row.elevation_loss,
        version: 'before'
      },
      geometry: JSON.parse(row.geojson)
    }));
    
    const backupGeoJSON = {
      type: 'FeatureCollection',
      features: backupFeatures
    };
    
    fs.writeFileSync('test-output/small-bbox-before.geojson', JSON.stringify(backupGeoJSON, null, 2));
    console.log(`✅ Exported ${backupFeatures.length} trails to test-output/small-bbox-before.geojson`);
    
    // Export the snapped (after) version
    console.log('🔗 Exporting snapped (after) version...');
    const snappedResult = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_AsGeoJSON(geometry) as geojson
      FROM public.trails_snapped_small
      ORDER BY name
    `);
    
    const snappedFeatures = snappedResult.rows.map(row => ({
      type: 'Feature',
      properties: {
        id: row.app_uuid,
        name: row.name,
        trail_type: row.trail_type,
        surface: row.surface,
        difficulty: row.difficulty,
        length_km: row.length_km,
        elevation_gain: row.elevation_gain,
        elevation_loss: row.elevation_loss,
        version: 'after'
      },
      geometry: JSON.parse(row.geojson)
    }));
    
    const snappedGeoJSON = {
      type: 'FeatureCollection',
      features: snappedFeatures
    };
    
    fs.writeFileSync('test-output/small-bbox-after.geojson', JSON.stringify(snappedGeoJSON, null, 2));
    console.log(`✅ Exported ${snappedFeatures.length} trails to test-output/small-bbox-after.geojson`);
    
    // Create a combined comparison file
    console.log('🔄 Creating combined comparison file...');
    const combinedFeatures = [
      ...backupFeatures.map(f => ({ ...f, properties: { ...f.properties, version: 'before' } })),
      ...snappedFeatures.map(f => ({ ...f, properties: { ...f.properties, version: 'after' } }))
    ];
    
    const combinedGeoJSON = {
      type: 'FeatureCollection',
      features: combinedFeatures
    };
    
    fs.writeFileSync('test-output/small-bbox-comparison.geojson', JSON.stringify(combinedGeoJSON, null, 2));
    console.log(`✅ Exported combined comparison to test-output/small-bbox-comparison.geojson`);
    
    // Show summary
    console.log('\n📊 Export Summary:');
    console.log(`   Before (backup): ${backupFeatures.length} trails`);
    console.log(`   After (snapped): ${snappedFeatures.length} trails`);
    console.log(`   Combined: ${combinedFeatures.length} features`);
    
    // Show trail names for reference
    console.log('\n🛤️ Trails in the small bbox:');
    backupFeatures.forEach(feature => {
      console.log(`   - ${feature.properties.name} (${feature.properties.length_km}km)`);
    });
    
    console.log('\n🗺️ Files created:');
    console.log('   - test-output/small-bbox-before.geojson (original trails)');
    console.log('   - test-output/small-bbox-after.geojson (snapped trails)');
    console.log('   - test-output/small-bbox-comparison.geojson (both versions)');
    
    console.log('\n💡 Visualization tips:');
    console.log('   - Use the "version" property to filter before/after');
    console.log('   - The "name" property can help identify specific trails');
    console.log('   - Look for differences in endpoint coordinates');
    
  } catch (error) {
    console.error('❌ Error during export:', error);
    throw error;
  } finally {
    pgClient.release();
    await pool.end();
  }
}

// Run the script
exportSmallBboxComparison().catch(console.error);
