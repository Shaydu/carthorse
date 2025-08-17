#!/usr/bin/env node

require('dotenv').config();
const { Client } = require('pg');

async function testImprovedSplitting() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Use the most recent staging schema
    const stagingSchema = 'carthorse_1755423409246';
    console.log(`📊 Using staging schema: ${stagingSchema}`);

    // Get initial trail count
    const initialCountResult = await client.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    `);
    const initialCount = parseInt(initialCountResult.rows[0].count);
    console.log(`📊 Initial trails: ${initialCount}`);

    // Check if Enchanted trails exist
    const enchantedTrailsResult = await client.query(`
      SELECT id, name, app_uuid, ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%enchanted%'
      ORDER BY name
    `);
    
    console.log('🔍 Enchanted trails found:');
    enchantedTrailsResult.rows.forEach(trail => {
      console.log(`  - ${trail.name} (ID: ${trail.id}, UUID: ${trail.app_uuid}, Length: ${trail.length_meters}m)`);
    });

    // Run the improved splitting function
    console.log('\n🔄 Running improved trail splitting with snapping...');
    const splittingResult = await client.query(`
      SELECT * FROM improved_trail_splitting_with_snapping($1, 0.5)
    `, [stagingSchema]);

    const result = splittingResult.rows[0];
    console.log('\n📊 Splitting Results:');
    console.log(`  - Success: ${result.success}`);
    console.log(`  - Original count: ${result.original_count}`);
    console.log(`  - Split count: ${result.split_count}`);
    console.log(`  - Intersection count: ${result.intersection_count}`);
    console.log(`  - Message: ${result.message}`);

    // Check final trail count
    const finalCountResult = await client.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    `);
    const finalCount = parseInt(finalCountResult.rows[0].count);
    console.log(`📊 Final trails: ${finalCount}`);

    // Check if Enchanted trails were split
    const finalEnchantedResult = await client.query(`
      SELECT id, name, app_uuid, ST_Length(geometry::geography) as length_meters, source
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%enchanted%'
      ORDER BY name, length_meters DESC
    `);
    
    console.log('\n🔍 Enchanted trails after splitting:');
    finalEnchantedResult.rows.forEach(trail => {
      console.log(`  - ${trail.name} (ID: ${trail.id}, UUID: ${trail.app_uuid}, Length: ${trail.length_meters}m, Source: ${trail.source})`);
    });

    // Export results as GeoJSON for visualization
    console.log('\n📤 Exporting results as GeoJSON...');
    const geojsonResult = await client.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(geometry)::json,
            'properties', json_build_object(
              'id', id,
              'name', name,
              'app_uuid', app_uuid,
              'length_meters', ROUND(ST_Length(geometry::geography)::numeric, 2),
              'source', COALESCE(source, 'original')
            )
          )
        )
      ) AS geojson
      FROM ${stagingSchema}.trails
      WHERE name ILIKE '%enchanted%'
    `);

    if (geojsonResult.rows[0].geojson) {
      const fs = require('fs');
      const outputPath = 'test-output/enchanted-improved-splitting-results.geojson';
      fs.writeFileSync(outputPath, JSON.stringify(geojsonResult.rows[0].geojson, null, 2));
      console.log(`✅ GeoJSON exported to: ${outputPath}`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

testImprovedSplitting();
