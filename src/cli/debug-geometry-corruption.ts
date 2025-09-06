#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { loadConfig } from '../utils/config-loader';

// 🔍 DEBUGGING CONFIGURATION
const CONFIG = {
  // Focus on specific failing trails
  debugTrails: [
    'Mesa',
    'Trail 1282054158', 
    'Trail 105107346',
    'Trail 1282054181',
    'Trail 1046955361',
    'Trail 539721491'
  ],
  
  // Debug parameters
  toleranceMeters: 3.0,
  verbose: true
};

async function debugGeometryCorruption() {
  console.log('🔍 Debugging Geometry Corruption Issue...\n');
  console.log('🎯 Focus trails:', CONFIG.debugTrails.join(', '));
  console.log(`📏 Tolerance: ${CONFIG.toleranceMeters}m\n`);

  // Load configuration
  const config = loadConfig();
  const dbConfig = config.database.connection;
  
  // Create database connection
  const pgClient = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    // Create a fresh staging schema for debugging
    const stagingSchema = `debug_${Date.now()}`;
    console.log(`📋 Creating debug staging schema: ${stagingSchema}`);
    
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Copy trails from public schema to staging schema
    console.log('📋 Copying trails to staging schema...');
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT *, app_uuid as original_trail_uuid FROM public.trails 
      WHERE region = 'boulder'
    `);
    
    // Copy intersection points to staging schema
    console.log('📋 Copying intersection points to staging schema...');
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.intersection_points AS 
      SELECT * FROM public.intersection_points 
      WHERE 'boulder' = ANY(connected_trail_names)
    `);

    // Check original trail geometries BEFORE any processing
    console.log('\n🔍 STEP 1: Examining Original Trail Geometries...');
    for (const trailName of CONFIG.debugTrails) {
      const trailQuery = `
        SELECT 
          app_uuid,
          name,
          ST_Length(geometry::geography) as length_m,
          ST_IsValid(geometry) as is_valid,
          ST_IsSimple(geometry) as is_simple,
          ST_AsText(ST_StartPoint(geometry)) as start_point,
          ST_AsText(ST_EndPoint(geometry)) as end_point,
          ST_NumPoints(geometry) as num_points
        FROM ${stagingSchema}.trails 
        WHERE name = $1
      `;
      
      const result = await pgClient.query(trailQuery, [trailName]);
      
      if (result.rows.length > 0) {
        const trail = result.rows[0];
        console.log(`\n📊 ${trailName}:`);
        console.log(`   UUID: ${trail.app_uuid}`);
        console.log(`   Length: ${trail.length_m.toFixed(2)}m`);
        console.log(`   Valid: ${trail.is_valid}, Simple: ${trail.is_simple}`);
        console.log(`   Points: ${trail.num_points}`);
        console.log(`   Start: ${trail.start_point}`);
        console.log(`   End: ${trail.end_point}`);
        
        // Check for intersection points
        const intersectionQuery = `
          SELECT 
            node_type,
            connected_trail_names,
            ST_AsText(point) as point,
            ST_Distance(point::geography, $1::geography) as distance_m
          FROM ${stagingSchema}.intersection_points 
          WHERE $2 = ANY(connected_trail_names)
        `;
        
        const intersections = await pgClient.query(intersectionQuery, [trail.geometry, trailName]);
        
        if (intersections.rows.length > 0) {
          console.log(`   🎯 Intersection points (${intersections.rows.length}):`);
          intersections.rows.forEach((intersection, index) => {
            console.log(`      ${index + 1}. Type: ${intersection.node_type}`);
            console.log(`         Distance: ${intersection.distance_m.toFixed(2)}m`);
            console.log(`         Point: ${intersection.point}`);
            console.log(`         Connected: ${intersection.connected_trail_names.join(', ')}`);
          });
        } else {
          console.log(`   ❌ No intersection points found`);
        }
      } else {
        console.log(`\n❌ ${trailName}: Not found in staging schema`);
      }
    }

    // Now let's manually test the splitting logic on Mesa trail
    console.log('\n🔍 STEP 2: Manual Splitting Test on Mesa Trail...');
    
    const mesaTrail = await pgClient.query(`
      SELECT * FROM ${stagingSchema}.trails WHERE name = 'Mesa'
    `);
    
    if (mesaTrail.rows.length > 0) {
      const mesa = mesaTrail.rows[0];
      console.log(`\n🎯 Testing Mesa trail splitting manually...`);
      
      // Get intersection points for Mesa
      const mesaIntersections = await pgClient.query(`
        SELECT point FROM ${stagingSchema}.intersection_points 
        WHERE 'Mesa' = ANY(connected_trail_names)
      `);
      
      if (mesaIntersections.rows.length > 0) {
        console.log(`   Found ${mesaIntersections.rows.length} intersection points`);
        
        // Test the snapping logic
        const snapTestQuery = `
          WITH intersection_points AS (
            SELECT unnest($1::geometry[]) as point
          ),
          snapped_points AS (
            SELECT ST_ClosestPoint($2, point) as snapped_point
            FROM intersection_points
          )
          SELECT 
            ST_AsText(point) as original_point,
            ST_AsText(snapped_point) as snapped_point,
            ST_Distance(point::geography, snapped_point::geography) as snap_distance_m
          FROM intersection_points, snapped_points
        `;
        
        const snapResult = await pgClient.query(snapTestQuery, [
          mesaIntersections.rows.map(row => row.point),
          mesa.geometry
        ]);
        
        console.log(`   📍 Point snapping results:`);
        snapResult.rows.forEach((row, index) => {
          console.log(`      ${index + 1}. Original: ${row.original_point}`);
          console.log(`         Snapped: ${row.snapped_point}`);
          console.log(`         Distance: ${row.snap_distance_m.toFixed(2)}m`);
        });
        
        // Test the actual splitting
        const splitTestQuery = `
          WITH intersection_points AS (
            SELECT unnest($1::geometry[]) as point
          ),
          snapped_points AS (
            SELECT ST_ClosestPoint($2, point) as snapped_point
            FROM intersection_points
          ),
          snapped_union AS (
            SELECT ST_Union(snapped_point) as union_geom
            FROM snapped_points
          )
          SELECT 
            ST_AsText(union_geom) as split_geometry,
            ST_NumGeometries(ST_Split($2, union_geom)) as num_segments,
            ST_Length(ST_Split($2, union_geom)::geography) as total_length_m
          FROM snapped_union
        `;
        
        const splitResult = await pgClient.query(splitTestQuery, [
          mesaIntersections.rows.map(row => row.point),
          mesa.geometry
        ]);
        
        if (splitResult.rows.length > 0) {
          const split = splitResult.rows[0];
          console.log(`   ✂️  Splitting results:`);
          console.log(`      Split geometry: ${split.split_geometry}`);
          console.log(`      Segments created: ${split.num_segments}`);
          console.log(`      Total length: ${split.total_length_m.toFixed(2)}m`);
          console.log(`      Original length: ${mesa.length_m.toFixed(2)}m`);
          console.log(`      Length difference: ${(split.total_length_m - mesa.length_m).toFixed(2)}m`);
          
          // Check if the split geometry is valid
          const validityQuery = `
            SELECT 
              ST_IsValid(ST_Split($1, $2)) as is_valid,
              ST_IsValidReason(ST_Split($1, $2)) as validity_reason
          `;
          
          const validityResult = await pgClient.query(validityQuery, [
            mesa.geometry,
            splitResult.rows[0].split_geometry
          ]);
          
          if (validityResult.rows.length > 0) {
            const validity = validityResult.rows[0];
            console.log(`      Valid: ${validity.is_valid}`);
            if (!validity.is_valid) {
              console.log(`      Reason: ${validity.validity_reason}`);
            }
          }
        }
      } else {
        console.log(`   ❌ No intersection points found for Mesa`);
      }
    }

    // Clean up staging schema
    console.log(`\n🧹 Cleaning up debug staging schema: ${stagingSchema}`);
    await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);

  } catch (error) {
    console.error('❌ Error debugging geometry corruption:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the debug
if (require.main === module) {
  debugGeometryCorruption()
    .then(() => {
      console.log('\n🎉 Debug completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Debug failed:', error);
      process.exit(1);
    });
}

