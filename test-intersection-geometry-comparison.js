#!/usr/bin/env node

/**
 * Test script to compare intersection geometry calculation between working test script and service
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
  const stagingSchema = `geometry_comparison_${Date.now()}`;
  
  try {
    console.log('🔍 Comparing Intersection Geometry Calculation...\n');
    
    // Connect to database
    await pgClient.connect();
    console.log('✅ Connected to database');
    
    // Create staging schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    console.log(`✅ Created staging schema: ${stagingSchema}`);
    
    // Copy COTREX trails to staging
    const [minLng, minLat, maxLng, maxLat] = CONFIG.bbox;
    await pgClient.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT * FROM public.trails 
      WHERE source = 'cotrex'
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [minLng, minLat, maxLng, maxLat]);
    
    const trailCount = await pgClient.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
    console.log(`📊 Found ${trailCount.rows[0].count} COTREX trails in bbox`);
    
    // Find North Sky and Foothills North trails
    const targetTrails = await pgClient.query(`
      SELECT id, name, geometry, ST_Length(geometry::geography) as length_m
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%North Sky%' OR name ILIKE '%Foothills North%'
      ORDER BY name
    `);
    
    console.log(`🎯 Found ${targetTrails.rows.length} target trails:`);
    targetTrails.rows.forEach(trail => {
      console.log(`   - ${trail.name} (${trail.length_m.toFixed(2)}m)`);
    });
    
    if (targetTrails.rows.length < 2) {
      console.log('❌ Need at least 2 target trails for comparison');
      return;
    }
    
    // Find intersection between North Sky and Foothills North
    const intersection = await pgClient.query(`
      SELECT 
        t1.id as trail1_id,
        t1.name as trail1_name,
        t2.id as trail2_id,
        t2.name as trail2_name,
        ST_Intersection(t1.geometry, t2.geometry) as intersection_geom_direct,
        ST_Force3D(ST_Intersection(t1.geometry, t2.geometry)) as intersection_geom_force3d,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_wkt_direct,
        ST_AsText(ST_Force3D(ST_Intersection(t1.geometry, t2.geometry))) as intersection_wkt_force3d
      FROM ${stagingSchema}.trails t1
      JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND (
          (t1.name ILIKE '%North Sky%' AND t2.name ILIKE '%Foothills North%') OR
          (t1.name ILIKE '%Foothills North%' AND t2.name ILIKE '%North Sky%')
        )
    `);
    
    if (intersection.rows.length === 0) {
      console.log('❌ No intersection found between North Sky and Foothills North');
      return;
    }
    
    const intersectionData = intersection.rows[0];
    console.log(`\n🎯 Found intersection between ${intersectionData.trail1_name} and ${intersectionData.trail2_name}`);
    console.log(`   Type: ${intersectionData.intersection_type}`);
    
    // Compare the two intersection geometries
    console.log('\n📊 Intersection Geometry Comparison:');
    console.log(`   Direct ST_Intersection: ${intersectionData.intersection_wkt_direct}`);
    console.log(`   ST_Force3D(ST_Intersection): ${intersectionData.intersection_wkt_force3d}`);
    
    // Check if they're the same
    const geometryComparison = await pgClient.query(`
      SELECT 
        ST_Equals($1, $2) as geometries_equal,
        ST_Distance($1, $2) as distance_between_geometries
    `, [intersectionData.intersection_geom_direct, intersectionData.intersection_geom_force3d]);
    
    const comparison = geometryComparison.rows[0];
    console.log(`   Geometries equal: ${comparison.geometries_equal}`);
    console.log(`   Distance between geometries: ${comparison.distance_between_geometries}`);
    
    // Test splitting with both geometries
    console.log('\n🔧 Testing ST_Split with both intersection geometries...');
    
    // Test with direct intersection
    const splitTestDirect = await pgClient.query(`
      SELECT 
        ST_NumGeometries(ST_Split($1, $2)) as segment_count_direct,
        ST_AsText((ST_Dump(ST_Split($1, $2))).geom) as segments_direct
      FROM ${stagingSchema}.trails 
      WHERE id = $3
    `, [intersectionData.trail1_geom, intersectionData.intersection_geom_direct, intersectionData.trail1_id]);
    
    // Test with Force3D intersection
    const splitTestForce3D = await pgClient.query(`
      SELECT 
        ST_NumGeometries(ST_Split($1, $2)) as segment_count_force3d,
        ST_AsText((ST_Dump(ST_Split($1, $2))).geom) as segments_force3d
      FROM ${stagingSchema}.trails 
      WHERE id = $3
    `, [intersectionData.trail1_geom, intersectionData.intersection_geom_force3d, intersectionData.trail1_id]);
    
    console.log(`   Direct intersection split: ${splitTestDirect.rows[0].segment_count_direct} segments`);
    console.log(`   Force3D intersection split: ${splitTestForce3D.rows[0].segment_count_force3d} segments`);
    
    // Show first segment of each split for comparison
    if (splitTestDirect.rows[0].segments_direct) {
      console.log(`   Direct split first segment: ${splitTestDirect.rows[0].segments_direct.substring(0, 100)}...`);
    }
    if (splitTestForce3D.rows[0].segments_force3d) {
      console.log(`   Force3D split first segment: ${splitTestForce3D.rows[0].segments_force3d.substring(0, 100)}...`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    // Cleanup
    try {
      await pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
      console.log(`\n🧹 Cleaned up staging schema: ${stagingSchema}`);
    } catch (cleanupError) {
      console.error('⚠️ Cleanup error:', cleanupError.message);
    }
    
    await pgClient.end();
    console.log('✅ Disconnected from database');
  }
}

main().catch(console.error);
