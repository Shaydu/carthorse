#!/usr/bin/env node

/**
 * Test script to debug intersection precision issues
 * Compare how intersection geometry is calculated and used
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
  const stagingSchema = `precision_test_${Date.now()}`;
  
  try {
    console.log('🔍 Testing Intersection Precision...\n');
    
    // Connect to database
    await pgClient.connect();
    console.log('✅ Connected to database');
    
    // Create staging schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    console.log(`📋 Created staging schema: ${stagingSchema}`);
    
    // Copy COTREX trails to staging schema
    const [minLng, minLat, maxLng, maxLat] = CONFIG.bbox;
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT * FROM public.trails 
      WHERE source = 'cotrex'
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [minLng, minLat, maxLng, maxLat]);
    
    // Find North Sky and Foothills North trails
    const trails = await pgClient.query(`
      SELECT id, name, geometry, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%North Sky%' OR name ILIKE '%Foothills North%'
      ORDER BY name
    `);
    
    console.log(`📊 Found ${trails.rows.length} target trails:`);
    trails.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.length_m}m)`);
    });
    
    if (trails.rows.length < 2) {
      console.log('❌ Need at least 2 trails to test intersection');
      return;
    }
    
    // Find intersection between North Sky and Foothills North
    const intersection = await pgClient.query(`
      SELECT 
        t1.id as trail1_id,
        t1.name as trail1_name,
        t1.geometry as trail1_geom,
        t2.id as trail2_id,
        t2.name as trail2_name,
        t2.geometry as trail2_geom,
        ST_Intersection(t1.geometry, t2.geometry) as intersection_geom,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_wkt
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND (
          (t1.name ILIKE '%North Sky%' AND t2.name ILIKE '%Foothills North%') OR
          (t1.name ILIKE '%Foothills North%' AND t2.name ILIKE '%North Sky%')
        )
    `);
    
    if (intersection.rows.length === 0) {
      console.log('❌ No intersection found between North Sky and Foothills North');
      return;
    }
    
    const row = intersection.rows[0];
    console.log(`\n🎯 Found intersection:`);
    console.log(`   Trail 1: ${row.trail1_name}`);
    console.log(`   Trail 2: ${row.trail2_name}`);
    console.log(`   Intersection Type: ${row.intersection_type}`);
    console.log(`   Intersection WKT: ${row.intersection_wkt}`);
    
    // Test splitting with the intersection geometry
    console.log(`\n🔧 Testing ST_Split with intersection geometry...`);
    
    // Test splitting trail1
    const split1Result = await pgClient.query(`
      SELECT 
        ST_AsText(ST_Split($1::geometry, $2::geometry)) as split_geom_wkt,
        ST_GeometryType(ST_Split($1::geometry, $2::geometry)) as split_geom_type,
        ST_NumGeometries(ST_Split($1::geometry, $2::geometry)) as num_segments
    `, [row.trail1_geom, row.intersection_geom]);
    
    console.log(`   Trail 1 Split Result:`);
    console.log(`     Type: ${split1Result.rows[0].split_geom_type}`);
    console.log(`     Segments: ${split1Result.rows[0].num_segments}`);
    console.log(`     WKT: ${split1Result.rows[0].split_geom_wkt.substring(0, 200)}...`);
    
    // Test splitting trail2
    const split2Result = await pgClient.query(`
      SELECT 
        ST_AsText(ST_Split($1::geometry, $2::geometry)) as split_geom_wkt,
        ST_GeometryType(ST_Split($1::geometry, $2::geometry)) as split_geom_type,
        ST_NumGeometries(ST_Split($1::geometry, $2::geometry)) as num_segments
    `, [row.trail2_geom, row.intersection_geom]);
    
    console.log(`   Trail 2 Split Result:`);
    console.log(`     Type: ${split2Result.rows[0].split_geom_type}`);
    console.log(`     Segments: ${split2Result.rows[0].num_segments}`);
    console.log(`     WKT: ${split2Result.rows[0].split_geom_wkt.substring(0, 200)}...`);
    
    // Test with individual points from the intersection
    if (row.intersection_type === 'ST_MultiPoint') {
      console.log(`\n🔧 Testing with individual points from MultiPoint...`);
      
      const pointsResult = await pgClient.query(`
        SELECT 
          (ST_Dump($1::geometry)).geom as point_geom,
          ST_AsText((ST_Dump($1::geometry)).geom) as point_wkt
        FROM (SELECT $1::geometry as geom) as g
      `, [row.intersection_geom]);
      
      console.log(`   Found ${pointsResult.rows.length} points in intersection:`);
      pointsResult.rows.forEach((pointRow, i) => {
        console.log(`     Point ${i + 1}: ${pointRow.point_wkt}`);
      });
      
      // Test splitting with first point only
      if (pointsResult.rows.length > 0) {
        const firstPoint = pointsResult.rows[0].point_geom;
        
        const splitWithPointResult = await pgClient.query(`
          SELECT 
            ST_AsText(ST_Split($1::geometry, $2::geometry)) as split_geom_wkt,
            ST_GeometryType(ST_Split($1::geometry, $2::geometry)) as split_geom_type,
            ST_NumGeometries(ST_Split($1::geometry, $2::geometry)) as num_segments
        `, [row.trail1_geom, firstPoint]);
        
        console.log(`   Trail 1 Split with First Point:`);
        console.log(`     Type: ${splitWithPointResult.rows[0].split_geom_type}`);
        console.log(`     Segments: ${splitWithPointResult.rows[0].num_segments}`);
      }
    }
    
    // Test with tolerance-based intersection
    console.log(`\n🔧 Testing with tolerance-based intersection...`);
    
    const toleranceIntersection = await pgClient.query(`
      SELECT 
        ST_Intersection(
          ST_Buffer(t1.geometry::geography, $1)::geometry,
          ST_Buffer(t2.geometry::geography, $1)::geometry
        ) as tolerance_intersection_geom,
        ST_AsText(ST_Intersection(
          ST_Buffer(t1.geometry::geography, $1)::geometry,
          ST_Buffer(t2.geometry::geography, $1)::geometry
        )) as tolerance_intersection_wkt
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND (
          (t1.name ILIKE '%North Sky%' AND t2.name ILIKE '%Foothills North%') OR
          (t1.name ILIKE '%Foothills North%' AND t2.name ILIKE '%North Sky%')
        )
    `, [CONFIG.toleranceMeters]);
    
    if (toleranceIntersection.rows.length > 0) {
      const toleranceRow = toleranceIntersection.rows[0];
      console.log(`   Tolerance Intersection WKT: ${toleranceRow.tolerance_intersection_wkt.substring(0, 200)}...`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
    console.log('\n✅ Database connection closed');
  }
}

main().catch(console.error);
