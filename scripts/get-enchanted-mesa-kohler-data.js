#!/usr/bin/env node
/**
 * Get Enchanted Mesa and Kohler Trail Data
 * 
 * Retrieves actual trail data for Enchanted Mesa and Kohler trails from the database
 * to use in a second prototype
 */

const { Client } = require('pg');
const fs = require('fs');

async function getEnchantedMesaKohlerData() {
  console.log('🔍 Retrieving Enchanted Mesa and Kohler trail data...');
  
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'shaydu',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'trail_master_db'
  });

  try {
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL database');

    // Query for Enchanted Mesa and Kohler trails
    const query = `
      SELECT 
        app_uuid,
        name,
        region,
        osm_id,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        difficulty,
        surface,
        trail_type,
        ST_AsText(geometry) as geometry_text,
        source_tags,
        created_at,
        updated_at
      FROM trails 
      WHERE name ILIKE '%enchanted mesa%' 
         OR name ILIKE '%kohler%'
         OR name ILIKE '%enchanted-kohler%'
      ORDER BY name
    `;

    const result = await pgClient.query(query);
    console.log(`📊 Found ${result.rows.length} trails matching criteria`);

    // Process the trail data
    const trailData = result.rows.map(row => {
      // Parse geometry text to coordinates
      const geometryMatch = row.geometry_text.match(/LINESTRING(?: Z)?\s*\(([^)]+)\)/);
      let coordinates = [];
      
      if (geometryMatch) {
        const coordPairs = geometryMatch[1].split(',').map(pair => pair.trim());
        coordinates = coordPairs.map(pair => {
          const coords = pair.split(' ').map(Number);
          return [coords[0], coords[1]]; // [lng, lat]
        });
      }

      // Parse source tags
      let sourceTags = {};
      if (row.source_tags) {
        try {
          sourceTags = typeof row.source_tags === 'string' 
            ? JSON.parse(row.source_tags) 
            : row.source_tags;
        } catch (e) {
          console.log(`⚠️ Could not parse source_tags for ${row.name}: ${e.message}`);
        }
      }

      return {
        app_uuid: row.app_uuid,
        name: row.name,
        region: row.region,
        osm_id: row.osm_id,
        length_km: parseFloat(row.length_km) || 0,
        elevation_gain: parseFloat(row.elevation_gain) || 0,
        elevation_loss: parseFloat(row.elevation_loss) || 0,
        max_elevation: parseFloat(row.max_elevation) || 0,
        min_elevation: parseFloat(row.min_elevation) || 0,
        avg_elevation: parseFloat(row.avg_elevation) || 0,
        difficulty: row.difficulty,
        surface: row.surface,
        trail_type: row.trail_type,
        coordinates,
        source_tags: sourceTags,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });

    // Save to JSON file
    const outputPath = './test-output/enchanted-mesa-kohler-trail-data.json';
    fs.writeFileSync(outputPath, JSON.stringify(trailData, null, 2));
    
    console.log(`✅ Trail data saved to: ${outputPath}`);
    console.log('\n📋 Trail Summary:');
    trailData.forEach(trail => {
      console.log(`  - ${trail.name}: ${trail.length_km.toFixed(2)}km, ${trail.coordinates.length} points`);
    });

    return trailData;

  } catch (error) {
    console.error('❌ Error retrieving trail data:', error.message);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the script
if (require.main === module) {
  getEnchantedMesaKohlerData()
    .then(() => {
      console.log('🎉 Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { getEnchantedMesaKohlerData };
