#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as fs from 'fs';

// Database connection
const client = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: process.env.PGPASSWORD || 'your_password_here'
});

const STAGING_SCHEMA = 'carthorse_1755276442213';
const OUTPUT_FILE = 'test-output/separate-touching-results.geojson';

async function exportSeparateTouchingResults() {
  console.log('📤 Exporting separateTouching results as GeoJSON...');
  
  try {
    // Get all trails from the staging schema
    const result = await client.query(`
      SELECT 
        id,
        old_id,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        ST_AsGeoJSON(ST_Force2D(geometry)) as geometry_json
      FROM ${STAGING_SCHEMA}.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
      ORDER BY old_id, id
    `);
    
    console.log(`📊 Found ${result.rows.length} trails to export`);
    
    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature',
        id: index,
        properties: {
          id: row.id,
          old_id: row.old_id,
          name: row.name,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          is_split: row.old_id !== null ? 'Yes' : 'No'
        },
        geometry: JSON.parse(row.geometry_json)
      }))
    };
    
    // Write to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${result.rows.length} trails to ${OUTPUT_FILE}`);
    
    // Show summary
    const originalTrails = new Set(result.rows.map(r => r.old_id).filter(id => id !== null));
    const splitTrails = result.rows.filter(r => r.old_id !== null).length;
    
    console.log('\n📋 Summary:');
    console.log(`   - Total trails: ${result.rows.length}`);
    console.log(`   - Original trail IDs: ${originalTrails.size}`);
    console.log(`   - Split segments: ${splitTrails}`);
    
    // Show some examples of split trails
    const splitExamples = result.rows
      .filter(r => r.old_id !== null)
      .slice(0, 5);
    
    console.log('\n🔍 Examples of split trails:');
    splitExamples.forEach(row => {
      console.log(`   - ${row.name} (ID: ${row.old_id}) -> ${row.length_km.toFixed(2)}km`);
    });
    
    // Check for Enchanted trails specifically
    const enchantedTrails = result.rows.filter(r => r.name && r.name.toLowerCase().includes('enchanted'));
    console.log(`\n🔮 Enchanted trails found: ${enchantedTrails.length}`);
    enchantedTrails.forEach(row => {
      console.log(`   - ${row.name} (ID: ${row.id}, old_id: ${row.old_id}) - ${row.length_km.toFixed(2)}km`);
    });
    
  } catch (error) {
    console.error('❌ Error exporting results:', error);
  } finally {
    await client.end();
  }
}

// Run the export
exportSeparateTouchingResults().catch(console.error);
