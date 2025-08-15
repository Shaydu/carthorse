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

const STAGING_SCHEMA = 'test_separate_touching_simple_1234567890';
const OUTPUT_FILE = 'test-output/current-trails.geojson';

async function exportCurrentTrails() {
  console.log('📤 Exporting current trails for visualization...');
  
  try {
    // Get all trails from the current schema
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
      ORDER BY id
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
          length_km: row.length_km
        },
        geometry: JSON.parse(row.geometry_json)
      }))
    };
    
    // Write to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${result.rows.length} trails to ${OUTPUT_FILE}`);
    
    // Show trail details
    console.log('\n📋 Trail details:');
    result.rows.forEach(row => {
      console.log(`   - ${row.name} (ID: ${row.id}) - ${row.length_km.toFixed(2)}km`);
    });
    
  } catch (error) {
    console.error('❌ Error exporting current trails:', error);
  } finally {
    await client.end();
  }
}

// Run the export
exportCurrentTrails().catch(console.error);
