#!/usr/bin/env ts-node

import { Client } from 'pg';
import { loadConfig } from '../src/utils/config-loader';

async function debugTYDetectionSimple() {
  const config = loadConfig();
  const toleranceMeters = config.layer1_trails?.intersectionDetection?.tIntersectionToleranceMeters ?? 3.0;
  
  console.log(`🔍 Testing T-intersection detection with tolerance: ${toleranceMeters}m`);
  
  // Connect to the database
  const client = new Client({
    host: config.database.connection.host,
    port: config.database.connection.port,
    database: config.database.connection.database,
    user: config.database.connection.user,
    password: config.database.connection.password,
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Find the staging schema
    const stagingSchemasResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (stagingSchemasResult.rowCount === 0) {
      console.log('❌ No staging schemas found');
      return;
    }
    
    const stagingSchema = stagingSchemasResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Test the T-intersection detection query directly
    console.log('\n🧪 Testing T-intersection detection query...');
    
    const tyDetectionResult = await client.query(`
      WITH all_trails AS (
        SELECT 
          app_uuid,
          name,
          geometry
        FROM ${stagingSchema}.trails
        WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
      ),
      t_intersections AS (
        -- T-intersections: where any point on one trail is close to any point on another trail
        SELECT 
          ST_Force2D(ST_ClosestPoint(t2.geometry::geometry, ST_ClosestPoint(t1.geometry::geometry, t2.geometry::geometry))) as intersection_point,
          ST_Force3D(ST_ClosestPoint(t2.geometry::geometry, ST_ClosestPoint(t1.geometry::geometry, t2.geometry::geometry))) as intersection_point_3d,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names,
          ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters
        FROM all_trails t1
        JOIN all_trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t1.geometry::geography, t2.geometry::geography, $1)
          AND ST_Distance(t1.geometry::geography, t2.geometry::geography) > 0
          AND ST_Distance(t1.geometry::geography, t2.geometry::geography) <= $1
      )
      SELECT * FROM t_intersections
      ORDER BY distance_meters ASC
    `, [toleranceMeters]);
    
    console.log(`📍 Found ${tyDetectionResult.rowCount} T-intersections:`);
    tyDetectionResult.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.connected_trail_names.join(' ↔ ')}: ${row.distance_meters.toFixed(2)}m`);
      console.log(`     Point: ${row.intersection_point}`);
    });
    
    // Also test with a simpler approach - just check the minimum distance between the trails
    console.log('\n🧪 Testing simple distance check...');
    
    const distanceResult = await client.query(`
      SELECT 
        t1.name as trail1,
        t2.name as trail2,
        ST_Distance(t1.geometry::geography, t2.geometry::geography) as distance_meters,
        ST_AsText(ST_ClosestPoint(t1.geometry::geometry, t2.geometry::geometry)) as closest_point
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
      WHERE t1.name = 'Enchanted Mesa Trail' AND t2.name = 'Enchanted-Kohler Spur Trail'
    `);
    
    if (distanceResult.rowCount && distanceResult.rowCount > 0) {
      const row = distanceResult.rows[0];
      console.log(`📏 Distance between trails: ${row.distance_meters.toFixed(2)}m`);
      console.log(`📍 Closest point: ${row.closest_point}`);
      console.log(`✅ Within tolerance (${toleranceMeters}m): ${row.distance_meters <= toleranceMeters}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

debugTYDetectionSimple().catch(console.error);
