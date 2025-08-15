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

const OUTPUT_FILE = 'test-output/original-trails-comparison.geojson';

async function exportOriginalTrails() {
  console.log('📤 Exporting original trails for comparison...');
  
  try {
    // Get trails from the same schema that was used in the test
    const result = await client.query(`
      SELECT 
        id,
        app_uuid,
        name,
        trail_type,
        surface,
        difficulty,
        length_km,
        ST_AsGeoJSON(ST_Force2D(geometry)) as geometry_json
      FROM public.trails
      WHERE region = 'boulder' 
        AND geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND name ILIKE '%Mesa%'
      ORDER BY id
    `);
    
    console.log(`📊 Found ${result.rows.length} original Mesa trails`);
    
    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature',
        id: index,
        properties: {
          id: row.id,
          app_uuid: row.app_uuid,
          name: row.name,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          source: 'original'
        },
        geometry: JSON.parse(row.geometry_json)
      }))
    };
    
    // Write to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${result.rows.length} original trails to ${OUTPUT_FILE}`);
    
    // Show Enchanted trails specifically
    const enchantedTrails = result.rows.filter(r => r.name && r.name.toLowerCase().includes('enchanted'));
    console.log(`\n🔮 Original Enchanted trails found: ${enchantedTrails.length}`);
    enchantedTrails.forEach(row => {
      console.log(`   - ${row.name} (ID: ${row.id}) - ${row.length_km.toFixed(2)}km`);
    });
    
  } catch (error) {
    console.error('❌ Error exporting original trails:', error);
  } finally {
    await client.end();
  }
}

// Run the export
exportOriginalTrails().catch(console.error);
