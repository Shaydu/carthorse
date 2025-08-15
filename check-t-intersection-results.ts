#!/usr/bin/env ts-node

import { Client } from 'pg';
import { loadConfig } from './src/utils/config-loader';

async function checkTIntersectionResults() {
  const config = loadConfig();
  
  console.log('🔍 Checking T-intersection detection results...');
  
  const pgClient = new Client({
    host: config.database.connection.host,
    port: config.database.connection.port,
    database: config.database.connection.database,
    user: config.database.connection.user,
    password: config.database.connection.password,
  });

  try {
    await pgClient.connect();
    
    // Find the most recent staging schema
    const stagingSchemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (stagingSchemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = stagingSchemaResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Check intersection_points table
    const intersectionResult = await pgClient.query(`
      SELECT 
        id,
        ST_AsText(point) as point_wkt,
        ST_AsText(point_3d) as point_3d_wkt,
        connected_trail_ids,
        connected_trail_names,
        node_type,
        distance_meters
      FROM ${stagingSchema}.intersection_points 
      WHERE node_type = 't_intersection'
      ORDER BY id
    `);
    
    console.log(`\n🎯 Found ${intersectionResult.rows.length} T-intersections:`);
    
    for (const row of intersectionResult.rows) {
      console.log(`\n  ID: ${row.id}`);
      console.log(`  Point: ${row.point_wkt}`);
      console.log(`  Point 3D: ${row.point_3d_wkt}`);
      console.log(`  Connected Trail IDs: ${row.connected_trail_ids}`);
      console.log(`  Connected Trail Names: ${row.connected_trail_names}`);
      console.log(`  Distance: ${row.distance_meters}m`);
    }
    
    // Check for the specific intersection we're looking for
    const specificResult = await pgClient.query(`
      SELECT 
        id,
        ST_AsText(point) as point_wkt,
        connected_trail_names,
        distance_meters
      FROM ${stagingSchema}.intersection_points 
      WHERE node_type = 't_intersection'
      AND (
        'Enchanted Mesa Trail' = ANY(connected_trail_names) 
        AND 'Enchanted-Kohler Spur Trail' = ANY(connected_trail_names)
      )
    `);
    
    if (specificResult.rows.length > 0) {
      console.log(`\n✅ SUCCESS! Found the specific T-intersection:`);
      for (const row of specificResult.rows) {
        console.log(`  ID: ${row.id}`);
        console.log(`  Point: ${row.point_wkt}`);
        console.log(`  Distance: ${row.distance_meters}m`);
      }
    } else {
      console.log(`\n❌ The specific T-intersection between "Enchanted Mesa Trail" and "Enchanted-Kohler Spur Trail" was NOT found`);
    }
    
  } catch (error) {
    console.error('❌ Error checking T-intersection results:', error);
  } finally {
    await pgClient.end();
  }
}

checkTIntersectionResults().catch(console.error);
