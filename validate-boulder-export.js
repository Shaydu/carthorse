#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = './test-output/boulder-test-fixed.db';

async function validateBoulderExport() {
  console.log('🔍 Validating Boulder Export with Route Recommendations...\n');
  
  if (!require('fs').existsSync(DB_PATH)) {
    console.log('❌ Export file not found. Export may still be running...');
    return;
  }

  const db = new sqlite3.Database(DB_PATH);
  
  try {
    // 1. Check if all required tables exist
    console.log('📋 Checking table structure...');
    const tables = await query(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log(`✅ Found ${tables.length} tables:`, tables.map(t => t.name).join(', '));
    
    const requiredTables = ['trails', 'routing_nodes', 'routing_edges', 'route_recommendations'];
    for (const table of requiredTables) {
      const exists = tables.some(t => t.name === table);
      console.log(`  ${exists ? '✅' : '❌'} ${table}`);
    }

    // 2. Check trail data
    console.log('\n🏔️  Checking trail data...');
    const trailCount = await query(db, "SELECT COUNT(*) as count FROM trails");
    console.log(`✅ Trails: ${trailCount[0].count}`);
    
    const trailStats = await query(db, `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as with_elevation_gain,
        COUNT(CASE WHEN elevation_loss IS NOT NULL THEN 1 END) as with_elevation_loss,
        COUNT(CASE WHEN max_elevation IS NOT NULL THEN 1 END) as with_max_elevation,
        COUNT(CASE WHEN min_elevation IS NOT NULL THEN 1 END) as with_min_elevation,
        COUNT(CASE WHEN avg_elevation IS NOT NULL THEN 1 END) as with_avg_elevation,
        COUNT(CASE WHEN geojson IS NOT NULL AND LENGTH(geojson) > 10 THEN 1 END) as with_geojson
      FROM trails
    `);
    
    const stats = trailStats[0];
    console.log(`  📊 Elevation data: ${stats.with_elevation_gain}/${stats.total} trails have elevation gain`);
    console.log(`  📊 GeoJSON data: ${stats.with_geojson}/${stats.total} trails have GeoJSON`);
    console.log(`  📊 Complete elevation: ${stats.with_max_elevation}/${stats.total} trails have complete elevation data`);

    // 3. Check routing graph
    console.log('\n🛤️  Checking routing graph...');
    const nodeCount = await query(db, "SELECT COUNT(*) as count FROM routing_nodes");
    const edgeCount = await query(db, "SELECT COUNT(*) as count FROM routing_edges");
    console.log(`✅ Routing nodes: ${nodeCount[0].count}`);
    console.log(`✅ Routing edges: ${edgeCount[0].count}`);
    
    // Check for orphaned nodes
    const orphanedNodes = await query(db, `
      SELECT COUNT(*) as count FROM routing_nodes n
      WHERE NOT EXISTS (
        SELECT 1 FROM routing_edges e WHERE e.source = n.id OR e.target = n.id
      )
    `);
    console.log(`  ${orphanedNodes[0].count === 0 ? '✅' : '❌'} Orphaned nodes: ${orphanedNodes[0].count}`);
    
    if (orphanedNodes[0].count > 0) {
      console.log(`  🔍 Orphaned nodes analysis:`);
      const orphanedDetails = await query(db, `
        SELECT n.id, n.lat, n.lng, n.node_type, n.connected_trails
        FROM routing_nodes n
        WHERE NOT EXISTS (
          SELECT 1 FROM routing_edges e WHERE e.source = n.id OR e.target = n.id
        )
        LIMIT 5
      `);
      orphanedDetails.forEach((node, i) => {
        console.log(`    ${i + 1}. Node ${node.id}: (${node.lat}, ${node.lng}) - Type: ${node.node_type}`);
      });
      if (orphanedNodes[0].count > 5) {
        console.log(`    ... and ${orphanedNodes[0].count - 5} more orphaned nodes`);
      }
    }

    // 4. Check route recommendations
    console.log('\n🎯 Checking route recommendations...');
    const recommendationCount = await query(db, "SELECT COUNT(*) as count FROM route_recommendations");
    console.log(`✅ Route recommendations: ${recommendationCount[0].count}`);
    
    if (recommendationCount[0].count > 0) {
      const recommendationStats = await query(db, `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN route_shape = 'loop' THEN 1 END) as loops,
          COUNT(CASE WHEN route_shape = 'out-and-back' THEN 1 END) as out_and_back,
          COUNT(CASE WHEN route_shape = 'point-to-point' THEN 1 END) as point_to_point,
          COUNT(CASE WHEN route_shape = 'lollipop' THEN 1 END) as lollipop,
          COUNT(CASE WHEN trail_count = 1 THEN 1 END) as single_trail,
          COUNT(CASE WHEN trail_count > 1 THEN 1 END) as multi_trail,
          AVG(route_score) as avg_score,
          MIN(route_score) as min_score,
          MAX(route_score) as max_score
        FROM route_recommendations
      `);
      
      const recStats = recommendationStats[0];
      console.log(`  📊 Route shapes:`);
      console.log(`    - Loops: ${recStats.loops}`);
      console.log(`    - Out-and-back: ${recStats.out_and_back}`);
      console.log(`    - Point-to-point: ${recStats.point_to_point}`);
      console.log(`    - Lollipop: ${recStats.lollipop}`);
      console.log(`  📊 Trail usage:`);
      console.log(`    - Single trail: ${recStats.single_trail}`);
      console.log(`    - Multi-trail: ${recStats.multi_trail}`);
      console.log(`  📊 Route scores:`);
      console.log(`    - Average: ${recStats.avg_score !== null ? recStats.avg_score.toFixed(2) : 'N/A'}`);
      console.log(`    - Range: ${recStats.min_score !== null ? recStats.min_score.toFixed(2) : 'N/A'} - ${recStats.max_score !== null ? recStats.max_score.toFixed(2) : 'N/A'}`);
      
      // Show some example recommendations
      const examples = await query(db, `
        SELECT route_uuid, route_shape, trail_count, route_score, recommended_distance_km, recommended_elevation_gain
        FROM route_recommendations 
        ORDER BY route_score DESC 
        LIMIT 5
      `);
      
      console.log(`  📋 Top 5 recommendations:`);
      examples.forEach((rec, i) => {
        console.log(`    ${i + 1}. ${rec.route_shape} (${rec.trail_count} trails, score: ${rec.route_score !== null ? rec.route_score.toFixed(1) : 'N/A'}, ${rec.recommended_distance_km !== null ? rec.recommended_distance_km.toFixed(1) : 'N/A'}km, ${rec.recommended_elevation_gain !== null ? rec.recommended_elevation_gain.toFixed(0) : 'N/A'}m gain)`);
      });
    }

    // 5. Check data quality
    console.log('\n🔍 Checking data quality...');
    
    // Check for missing elevation data
    const missingElevation = await query(db, `
      SELECT COUNT(*) as count FROM trails 
      WHERE elevation_gain IS NULL OR max_elevation IS NULL OR min_elevation IS NULL
    `);
    console.log(`  ${missingElevation[0].count === 0 ? '✅' : '⚠️'} Missing elevation data: ${missingElevation[0].count} trails`);
    
    // Check for missing GeoJSON
    const missingGeojson = await query(db, `
      SELECT COUNT(*) as count FROM trails 
      WHERE geojson IS NULL OR LENGTH(geojson) < 10
    `);
    console.log(`  ${missingGeojson[0].count === 0 ? '✅' : '⚠️'} Missing GeoJSON: ${missingGeojson[0].count} trails`);
    
    // Check for invalid distances
    const invalidDistances = await query(db, `
      SELECT COUNT(*) as count FROM trails 
      WHERE length_km IS NULL OR length_km <= 0
    `);
    console.log(`  ${invalidDistances[0].count === 0 ? '✅' : '⚠️'} Invalid distances: ${invalidDistances[0].count} trails`);

    // 6. Summary
    console.log('\n📊 Export Summary:');
    console.log(`  - Trails: ${trailCount[0].count}`);
    console.log(`  - Routing nodes: ${nodeCount[0].count}`);
    console.log(`  - Routing edges: ${edgeCount[0].count}`);
    console.log(`  - Route recommendations: ${recommendationCount[0].count}`);
    
    const fileSize = require('fs').statSync(DB_PATH).size / (1024 * 1024);
    console.log(`  - File size: ${fileSize.toFixed(2)} MB`);
    
    console.log('\n✅ Validation complete!');
    
  } catch (error) {
    console.error('❌ Validation error:', error);
  } finally {
    db.close();
  }
}

function query(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Run validation
validateBoulderExport(); 