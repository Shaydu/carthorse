#!/usr/bin/env node

/**
 * Debug script to test what the MultipointIntersectionSplittingService is detecting
 */

const { Client } = require('pg');

// Configuration
const CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'carthorse',
  password: 'carthorse',
  
  // Bbox for Boulder area
  bbox: [-105.323322108554, 39.9414084228671, -105.246109155213, 40.139896554615],
  
  // Service parameters
  toleranceMeters: 5.0,
  minSegmentLengthMeters: 5.0
};

async function main() {
  const pgClient = new Client(CONFIG);
  const stagingSchema = `test_vertex_aware_t_split`; // Use the existing staging schema
  
  try {
    console.log('🔍 Debugging MultipointIntersectionSplittingService Detection...\n');
    
    // Connect to database
    await pgClient.connect();
    console.log('✅ Connected to database');
    
    // Test the exact query from the service
    const serviceQuery = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t1.geometry as trail1_geom,
          t2.geometry as trail2_geom,
          ST_StartPoint(t1.geometry) as trail1_start,
          ST_EndPoint(t1.geometry) as trail1_end,
          ST_StartPoint(t2.geometry) as trail2_start,
          ST_EndPoint(t2.geometry) as trail2_end
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE 
          ST_Length(t1.geometry::geography) >= $1
          AND ST_Length(t2.geometry::geography) >= $1
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND t1.app_uuid != t2.app_uuid  -- Exclude self-intersections
      ),
      intersections AS (
        SELECT 
          trail1_uuid,
          trail1_name,
          trail2_uuid,
          trail2_name,
          trail1_geom,
          trail2_geom,
          trail1_start,
          trail1_end,
          trail2_start,
          trail2_end,
          ST_Intersection(trail1_geom, trail2_geom) as intersection_geom,
          ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) as intersection_type
        FROM trail_pairs
        WHERE ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) IN ('ST_Point', 'ST_MultiPoint')
      )
      SELECT 
        trail1_name,
        trail2_name,
        intersection_type,
        ST_AsText(intersection_geom) as intersection_wkt
      FROM intersections
      WHERE (trail1_name ILIKE '%north sky%' OR trail2_name ILIKE '%north sky%' OR 
             trail1_name ILIKE '%foothills north%' OR trail2_name ILIKE '%foothills north%')
      ORDER BY trail1_name, trail2_name;
    `;
    
    console.log('🔍 Running service intersection detection query...');
    const result = await pgClient.query(serviceQuery, [CONFIG.minSegmentLengthMeters]);
    
    console.log(`\n📊 Found ${result.rows.length} intersections involving North Sky or Foothills North:`);
    result.rows.forEach((row, index) => {
      console.log(`\n${index + 1}. ${row.trail1_name} × ${row.trail2_name}`);
      console.log(`   Type: ${row.intersection_type}`);
      console.log(`   Geometry: ${row.intersection_wkt}`);
    });
    
    // Also test the working script's approach
    console.log('\n🔍 Testing working script approach (using id instead of app_uuid)...');
    const workingQuery = `
      SELECT DISTINCT
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_wkt
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > 5
        AND ST_Length(t2.geometry::geography) > 5
        AND (t1.name ILIKE '%north sky%' OR t2.name ILIKE '%north sky%' OR 
             t1.name ILIKE '%foothills north%' OR t2.name ILIKE '%foothills north%')
      ORDER BY t1.name, t2.name;
    `;
    
    const workingResult = await pgClient.query(workingQuery);
    
    console.log(`\n📊 Working script approach found ${workingResult.rows.length} intersections:`);
    workingResult.rows.forEach((row, index) => {
      console.log(`\n${index + 1}. ${row.trail1_name} × ${row.trail2_name}`);
      console.log(`   Type: ${row.intersection_type}`);
      console.log(`   Geometry: ${row.intersection_wkt}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pgClient.end();
  }
}

main().catch(console.error);
