#!/usr/bin/env ts-node

import { Client } from 'pg';
import { loadConfig } from '../src/utils/config-loader';

async function debugTIntersectionDetection() {
  const config = loadConfig();
  const toleranceMeters = config.layer1_trails?.intersectionDetection?.tIntersectionToleranceMeters ?? 3.0;
  
  console.log(`🔍 Debugging T-intersection detection with tolerance: ${toleranceMeters}m`);
  
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
    
    // Find the staging schema with the most recent data
    const stagingSchemasResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (stagingSchemasResult.rows.length === 0) {
      console.error('❌ No staging schemas found');
      return;
    }
    
    const stagingSchema = stagingSchemasResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // Check the actual column names in intersection_points table
    const columnInfoResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'intersection_points'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log(`\n📋 intersection_points table columns:`);
    columnInfoResult.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Check if the specific trails exist
    const trailsResult = await client.query(`
      SELECT app_uuid, name, ST_AsText(ST_StartPoint(geometry)) as start_point, 
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%Enchanted%' OR name ILIKE '%Kohler%'
      ORDER BY name
    `);
    
    console.log(`\n📍 Found ${trailsResult.rows.length} relevant trails:`);
    trailsResult.rows.forEach(trail => {
      console.log(`  - ${trail.name} (${trail.app_uuid})`);
      console.log(`    Start: ${trail.start_point}`);
      console.log(`    End: ${trail.end_point}`);
      console.log(`    Length: ${trail.length_meters.toFixed(2)}m`);
    });
    
    // Test the T-intersection detection query manually
    console.log(`\n🔍 Testing T-intersection detection query...`);
    
    const tIntersectionTest = await client.query(`
      WITH all_trails AS (
        SELECT app_uuid, name, geometry 
        FROM ${stagingSchema}.trails 
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      t_intersections AS (
        -- T-intersections: where trail endpoints are close to other trails
        SELECT 
          t1.name as trail1_name,
          t2.name as trail2_name,
          ST_Force2D(ST_ClosestPoint(t2.geometry::geometry, ST_StartPoint(t1.geometry::geometry))) as intersection_point,
          ST_Force3D(ST_ClosestPoint(t2.geometry::geometry, ST_StartPoint(t1.geometry::geometry))) as intersection_point_3d,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names,
          't_intersection' as node_type,
          ST_Distance(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography) as distance_meters
        FROM all_trails t1
        JOIN all_trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography, $1)
          AND ST_Distance(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography) > 0
          AND ST_Distance(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography) <= $1
          AND (t1.name ILIKE '%Enchanted%' OR t2.name ILIKE '%Enchanted%' OR t1.name ILIKE '%Kohler%' OR t2.name ILIKE '%Kohler%')
        
        UNION ALL
        
        SELECT 
          t1.name as trail1_name,
          t2.name as trail2_name,
          ST_Force2D(ST_ClosestPoint(t2.geometry::geometry, ST_EndPoint(t1.geometry::geometry))) as intersection_point,
          ST_Force3D(ST_ClosestPoint(t2.geometry::geometry, ST_EndPoint(t1.geometry::geometry))) as intersection_point_3d,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names,
          't_intersection' as node_type,
          ST_Distance(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography) as distance_meters
        FROM all_trails t1
        JOIN all_trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography, $1)
          AND ST_Distance(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography) > 0
          AND ST_Distance(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography) <= $1
          AND (t1.name ILIKE '%Enchanted%' OR t2.name ILIKE '%Enchanted%' OR t1.name ILIKE '%Kohler%' OR t2.name ILIKE '%Kohler%')
      )
      SELECT 
        trail1_name,
        trail2_name,
        ST_AsText(intersection_point) as intersection_point_text,
        connected_trail_ids,
        connected_trail_names,
        node_type,
        distance_meters
      FROM t_intersections
      WHERE array_length(connected_trail_ids, 1) > 1
      ORDER BY distance_meters ASC
    `, [toleranceMeters]);
    
    console.log(`\n📍 Found ${tIntersectionTest.rows.length} T-intersections:`);
    tIntersectionTest.rows.forEach(intersection => {
      console.log(`  - ${intersection.trail1_name} ↔ ${intersection.trail2_name}`);
      console.log(`    Distance: ${intersection.distance_meters.toFixed(2)}m`);
      console.log(`    Point: ${intersection.intersection_point_text}`);
      console.log(`    Node type: ${intersection.node_type}`);
    });
    
    // Check current intersection_points table
    const currentIntersections = await client.query(`
      SELECT 
        ST_AsText(intersection_point) as point_text,
        connected_trail_names,
        node_type,
        distance_meters
      FROM ${stagingSchema}.intersection_points
      WHERE connected_trail_names && ARRAY['Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail']
      ORDER BY distance_meters ASC
    `);
    
    console.log(`\n📊 Current intersection_points table has ${currentIntersections.rows.length} relevant intersections:`);
    currentIntersections.rows.forEach(intersection => {
      console.log(`  - ${intersection.connected_trail_names.join(' ↔ ')}`);
      console.log(`    Distance: ${intersection.distance_meters?.toFixed(2) || 'N/A'}m`);
      console.log(`    Point: ${intersection.point_text}`);
      console.log(`    Node type: ${intersection.node_type}`);
    });
    
    // Test the actual INSERT statement
    console.log(`\n🧪 Testing the actual INSERT statement...`);
    
    const insertResult = await client.query(`
      INSERT INTO ${stagingSchema}.intersection_points (intersection_point, intersection_point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
      WITH all_trails AS (
        SELECT app_uuid, name, geometry 
        FROM ${stagingSchema}.trails 
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      t_intersections AS (
        -- T-intersections: where trail endpoints are close to other trails
        SELECT 
          ST_Force2D(ST_ClosestPoint(t2.geometry::geometry, ST_StartPoint(t1.geometry::geometry))) as intersection_point,
          ST_Force3D(ST_ClosestPoint(t2.geometry::geometry, ST_StartPoint(t1.geometry::geometry))) as intersection_point_3d,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names,
          't_intersection' as node_type,
          ST_Distance(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography) as distance_meters
        FROM all_trails t1
        JOIN all_trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography, $1)
          AND ST_Distance(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography) > 0
          AND ST_Distance(t2.geometry::geography, ST_StartPoint(t1.geometry)::geography) <= $1
          AND (t1.name ILIKE '%Enchanted%' OR t2.name ILIKE '%Enchanted%' OR t1.name ILIKE '%Kohler%' OR t2.name ILIKE '%Kohler%')
        
        UNION ALL
        
        SELECT 
          ST_Force2D(ST_ClosestPoint(t2.geometry::geometry, ST_EndPoint(t1.geometry::geometry))) as intersection_point,
          ST_Force3D(ST_ClosestPoint(t2.geometry::geometry, ST_EndPoint(t1.geometry::geometry))) as intersection_point_3d,
          ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
          ARRAY[t1.name, t2.name] as connected_trail_names,
          't_intersection' as node_type,
          ST_Distance(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography) as distance_meters
        FROM all_trails t1
        JOIN all_trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography, $1)
          AND ST_Distance(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography) > 0
          AND ST_Distance(t2.geometry::geography, ST_EndPoint(t1.geometry)::geography) <= $1
          AND (t1.name ILIKE '%Enchanted%' OR t2.name ILIKE '%Enchanted%' OR t1.name ILIKE '%Kohler%' OR t2.name ILIKE '%Kohler%')
      )
      SELECT 
        intersection_point,
        intersection_point_3d,
        connected_trail_ids,
        connected_trail_names,
        node_type,
        distance_meters
      FROM t_intersections
      WHERE array_length(connected_trail_ids, 1) > 1
      ON CONFLICT DO NOTHING
    `, [toleranceMeters]);
    
    console.log(`✅ INSERT statement executed successfully. Rows affected: ${insertResult.rowCount}`);
    
    // Check intersection_points table again
    const updatedIntersections = await client.query(`
      SELECT 
        ST_AsText(intersection_point) as point_text,
        connected_trail_names,
        node_type,
        distance_meters
      FROM ${stagingSchema}.intersection_points
      WHERE connected_trail_names && ARRAY['Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail']
      ORDER BY distance_meters ASC
    `);
    
    console.log(`\n📊 After INSERT, intersection_points table has ${updatedIntersections.rows.length} relevant intersections:`);
    updatedIntersections.rows.forEach(intersection => {
      console.log(`  - ${intersection.connected_trail_names.join(' ↔ ')}`);
      console.log(`    Distance: ${intersection.distance_meters?.toFixed(2) || 'N/A'}m`);
      console.log(`    Point: ${intersection.point_text}`);
      console.log(`    Node type: ${intersection.node_type}`);
    });
    
  } catch (error) {
    console.error('❌ Error during debugging:', error);
  } finally {
    await client.end();
  }
}

debugTIntersectionDetection().catch(console.error);
