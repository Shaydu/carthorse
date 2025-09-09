#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function restoreFlatironTrail() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node restore-flatiron-trail.ts <schema>');
    process.exit(1);
  }

  console.log(`🔄 Restoring 1st/2nd Flatiron trail for schema: ${schema}`);

  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);

  try {
    console.log('✅ Connected to database');

    // Check if the trail already exists
    const checkQuery = `
      SELECT id, name, app_uuid, ST_Length(geometry::geography) as length_meters
      FROM ${schema}.trails 
      WHERE app_uuid = $1 OR name ILIKE '%flatiron%'
    `;

    const checkResult = await pool.query(checkQuery, ['2d44b1d9-66ec-43e8-bd5c-dd4d270a3762']);

    if (checkResult.rows.length > 0) {
      console.log('✅ 1st/2nd Flatiron trail already exists:');
      checkResult.rows.forEach(trail => {
        console.log(`   ID: ${trail.id}, Name: "${trail.name}", Length: ${trail.length_meters.toFixed(2)}m`);
      });
      return;
    }

    console.log('❌ 1st/2nd Flatiron trail not found. Need to restore from backup or recreate.');
    
    // Let me check if we can find any trails that might be the split segments
    console.log('\n🔍 Checking for potential split segments...');
    
    const segmentsQuery = `
      SELECT 
        id, name, app_uuid, original_trail_uuid,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${schema}.trails 
      WHERE original_trail_uuid = $1
         OR (name IS NULL OR name = '')
         OR ST_Length(geometry::geography) BETWEEN 3200 AND 3300
         OR ST_Length(geometry::geography) BETWEEN 30 AND 40
         OR ST_Length(geometry::geography) BETWEEN 1 AND 5
      ORDER BY ST_Length(geometry::geography) DESC;
    `;

    const segmentsResult = await pool.query(segmentsQuery, ['2d44b1d9-66ec-43e8-bd5c-dd4d270a3762']);
    
    console.log(`Found ${segmentsResult.rows.length} potential segments:`);
    segmentsResult.rows.forEach((segment, index) => {
      console.log(`\n   ${index + 1}. ID: ${segment.id}, Name: "${segment.name || 'Unnamed'}"`);
      console.log(`      Length: ${segment.length_meters.toFixed(2)}m`);
      console.log(`      UUID: ${segment.app_uuid}`);
      if (segment.original_trail_uuid) {
        console.log(`      Original UUID: ${segment.original_trail_uuid}`);
      }
      console.log(`      Start: ${segment.start_point}`);
      console.log(`      End: ${segment.end_point}`);
    });

    // Check if we can find the trail in any backup files
    console.log('\n🔍 Checking for backup data...');
    
    // Look for the trail in the GeoJSON files
    const geojsonFiles = [
      '/Users/shaydu/dev/carthorse/test-output/network-topology-carthorse_1757362430748-2025-09-08T21-42-27-804Z.geojson',
      '/Users/shaydu/dev/carthorse/test-output/boulder-expanded-bbox-test-fixed-layer2-network.geojson'
    ];

    for (const file of geojsonFiles) {
      try {
        const fs = require('fs');
        if (fs.existsSync(file)) {
          console.log(`   Checking ${file}...`);
          const content = fs.readFileSync(file, 'utf8');
          if (content.includes('2d44b1d9-66ec-43e8-bd5c-dd4d270a3762')) {
            console.log(`   ✅ Found trail UUID in ${file}`);
          } else if (content.toLowerCase().includes('flatiron')) {
            console.log(`   ✅ Found "flatiron" in ${file}`);
          } else {
            console.log(`   ❌ No trail data found in ${file}`);
          }
        }
      } catch (error) {
        console.log(`   ❌ Error reading ${file}: ${error}`);
      }
    }

    console.log('\n📋 Summary:');
    console.log('   The 1st/2nd Flatiron trail was deleted during the split operation but the segments were not properly created.');
    console.log('   This is a bug in the PointSnapAndSplitService that needs to be fixed.');
    console.log('   The trail needs to be restored from a backup or recreated.');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

restoreFlatironTrail().catch(console.error);
