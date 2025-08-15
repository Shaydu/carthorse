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

const STAGING_SCHEMA = 'test_separate_touching_fixed_1234567890';
const OUTPUT_FILE = 'test-output/temp-separate-touching-results.geojson';

async function exportTempResults() {
  console.log('📤 Exporting temporary separateTouching results...');
  
  try {
    // Check if the temp table exists
    const tableCheck = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = '${STAGING_SCHEMA}' 
        AND table_name = 'trails_split_results'
    `);
    
    if (parseInt(tableCheck.rows[0].count) === 0) {
      console.log('❌ No temporary results table found. Run the separateTouching process first.');
      return;
    }
    
    // Get all trails from the temporary results table
    const result = await client.query(`
      SELECT 
        original_id,
        sub_id,
        osm_id,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        ST_AsGeoJSON(ST_Force2D(geometry)) as geometry_json
      FROM ${STAGING_SCHEMA}.trails_split_results
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
      ORDER BY original_id, sub_id
    `);
    
    console.log(`📊 Found ${result.rows.length} trails in temporary results`);
    
    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature',
        id: index,
        properties: {
          original_id: row.original_id,
          sub_id: row.sub_id,
          osm_id: row.osm_id,
          name: row.name,
          region: row.region,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          is_split: row.sub_id > 1 ? 'Yes' : 'No'
        },
        geometry: JSON.parse(row.geometry_json)
      }))
    };
    
    // Write to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${result.rows.length} trails to ${OUTPUT_FILE}`);
    
    // Show summary
    const originalTrails = new Set(result.rows.map(r => r.original_id).filter(id => id !== null));
    const splitTrails = result.rows.filter(r => r.sub_id > 1).length;
    const unsplitTrails = result.rows.filter(r => r.sub_id === 1).length;
    
    console.log('\n📋 Summary:');
    console.log(`   - Total segments: ${result.rows.length}`);
    console.log(`   - Original trail IDs: ${originalTrails.size}`);
    console.log(`   - Split segments: ${splitTrails}`);
    console.log(`   - Unsplit trails: ${unsplitTrails}`);
    
    // Show some examples
    const splitExamples = result.rows
      .filter(r => r.sub_id > 1)
      .slice(0, 5);
    
    console.log('\n🔍 Examples of split trails:');
    splitExamples.forEach(row => {
      console.log(`   - ${row.name} (ID: ${row.original_id}, sub: ${row.sub_id}) -> ${row.length_km.toFixed(2)}km`);
    });
    
    // Check for Enchanted trails specifically
    const enchantedTrails = result.rows.filter(r => r.name && r.name.toLowerCase().includes('enchanted'));
    console.log(`\n🔮 Enchanted trails found: ${enchantedTrails.length}`);
    enchantedTrails.forEach(row => {
      console.log(`   - ${row.name} (ID: ${row.original_id}, sub: ${row.sub_id}) - ${row.length_km.toFixed(2)}km`);
    });
    
  } catch (error) {
    console.error('❌ Error exporting temp results:', error);
  } finally {
    await client.end();
  }
}

// Run the export
exportTempResults().catch(console.error);
