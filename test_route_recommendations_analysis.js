#!/usr/bin/env node

const { CarthorseOrchestrator } = require('./dist/src/orchestrator/CarthorseOrchestrator');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

async function testRouteRecommendations() {
  console.log('🧪 Testing Route Recommendations Generation and Analysis...\n');

  const testDbPath = './test-output/route-recommendations-test.db';

  try {
    // Step 1: Clean up any existing test data
    console.log('1. 🧹 Cleaning up existing test data...');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log('   - Removed existing test database');
    }

    // Step 2: Run a full export with route recommendations
    console.log('\n2. 🚀 Running full export with route recommendations...');
    
    const orchestrator = new CarthorseOrchestrator({
      region: 'boulder',
      outputPath: testDbPath,
      simplifyTolerance: 0.0001,
      intersectionTolerance: 0.0001,
      replace: true,
      validate: false,
      verbose: true,
      skipBackup: true,
      buildMaster: false,
      targetSizeMB: null,
      maxSqliteDbSizeMB: 100,
      skipIncompleteTrails: true,
      bbox: [-105.28086462456893, 40.064313194287536, -105.23954738092088, 40.095057961140554],
      skipCleanup: false, // Enable cleanup to test the new functionality
      testCleanup: true,  // Enable comprehensive cleanup
      cleanupOnError: true
    });

    await orchestrator.run();
    console.log('✅ Export completed successfully');

    // Step 3: Analyze the generated route recommendations
    console.log('\n3. 📊 Analyzing route recommendations...');
    
    if (!fs.existsSync(testDbPath)) {
      throw new Error('Test database was not created');
    }

    const db = new Database(testDbPath);
    
    // Check if route_recommendations table exists and has data
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='route_recommendations'
    `).get();

    if (!tableExists) {
      console.log('❌ No route_recommendations table found');
      return;
    }

    const recommendationCount = db.prepare('SELECT COUNT(*) as count FROM route_recommendations').get().count;
    console.log(`📊 Found ${recommendationCount} route recommendations`);

    if (recommendationCount === 0) {
      console.log('❌ No route recommendations generated');
      return;
    }

    // Step 4: Generate detailed analysis table
    console.log('\n4. 📋 Generating detailed route recommendations table...');
    
    const recommendations = db.prepare(`
      SELECT 
        route_uuid,
        region,
        input_distance_km,
        input_elevation_gain,
        recommended_distance_km,
        recommended_elevation_gain,
        recommended_elevation_loss,
        route_score,
        route_type,
        route_shape,
        trail_count,
        route_path,
        route_edges,
        request_hash,
        created_at
      FROM route_recommendations 
      ORDER BY route_score DESC
      LIMIT 50
    `).all();

    console.log('\n🏆 TOP 50 ROUTE RECOMMENDATIONS');
    console.log('='.repeat(120));
    console.log('UUID | Distance | Elevation | Type | Shape | Trails | Score | Created');
    console.log('-----|----------|-----------|------|-------|--------|-------|--------');

    for (const rec of recommendations) {
      const uuid = rec.route_uuid.substring(0, 8);
      const distance = rec.recommended_distance_km?.toFixed(1) || 'N/A';
      const elevation = rec.recommended_elevation_gain?.toFixed(0) || 'N/A';
      const type = rec.route_type || 'N/A';
      const shape = rec.route_shape || 'N/A';
      const trails = rec.trail_count || 'N/A';
      const score = rec.route_score?.toFixed(2) || 'N/A';
      const created = rec.created_at ? new Date(rec.created_at).toLocaleDateString() : 'N/A';
      
      console.log(`${uuid} | ${distance.padStart(8)} | ${elevation.padStart(9)} | ${type.padStart(4)} | ${shape.padStart(5)} | ${trails.toString().padStart(6)} | ${score.padStart(5)} | ${created}`);
    }

    // Step 5: Analyze trail count distribution
    console.log('\n📈 TRAIL COUNT DISTRIBUTION');
    console.log('='.repeat(50));
    
    const trailCountStats = db.prepare(`
      SELECT 
        trail_count,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM route_recommendations), 1) as percentage
      FROM route_recommendations 
      WHERE trail_count IS NOT NULL
      GROUP BY trail_count 
      ORDER BY trail_count
    `).all();

    console.log('Trail Count | Count | Percentage');
    console.log('------------|-------|------------');
    
    for (const stat of trailCountStats) {
      console.log(`${stat.trail_count.toString().padStart(10)} | ${stat.count.toString().padStart(5)} | ${stat.percentage.toString().padStart(9)}%`);
    }

    // Step 6: Analyze route types and shapes
    console.log('\n🛤️  ROUTE TYPE AND SHAPE ANALYSIS');
    console.log('='.repeat(50));
    
    const routeTypeStats = db.prepare(`
      SELECT 
        route_type,
        route_shape,
        COUNT(*) as count,
        AVG(route_score) as avg_score,
        AVG(recommended_distance_km) as avg_distance,
        AVG(recommended_elevation_gain) as avg_elevation
      FROM route_recommendations 
      WHERE route_type IS NOT NULL
      GROUP BY route_type, route_shape
      ORDER BY count DESC
    `).all();

    console.log('Type | Shape | Count | Avg Score | Avg Distance | Avg Elevation');
    console.log('-----|-------|-------|-----------|--------------|---------------');
    
    for (const stat of routeTypeStats) {
      const type = stat.route_type || 'N/A';
      const shape = stat.route_shape || 'N/A';
      const count = stat.count;
      const avgScore = stat.avg_score !== null ? stat.avg_score.toFixed(2) : 'N/A';
      const avgDistance = stat.avg_distance !== null ? stat.avg_distance.toFixed(1) : 'N/A';
      const avgElevation = stat.avg_elevation !== null ? stat.avg_elevation.toFixed(0) : 'N/A';
      
      console.log(`${type.padStart(4)} | ${shape.padStart(5)} | ${count.toString().padStart(5)} | ${avgScore.padStart(9)} | ${avgDistance.padStart(12)} | ${avgElevation.padStart(13)}`);
    }

    // Step 7: Show detailed examples with trail information
    console.log('\n🔍 DETAILED EXAMPLES (Top 10 by Score)');
    console.log('='.repeat(80));
    
    const topRecommendations = db.prepare(`
      SELECT 
        route_uuid,
        recommended_distance_km,
        recommended_elevation_gain,
        route_score,
        route_type,
        route_shape,
        trail_count,
        route_edges,
        created_at
      FROM route_recommendations 
      ORDER BY route_score DESC
      LIMIT 10
    `).all();

    for (let i = 0; i < topRecommendations.length; i++) {
      const rec = topRecommendations[i];
      console.log(`\n${i + 1}. Route ${rec.route_uuid.substring(0, 8)}`);
      console.log(`   Distance: ${rec.recommended_distance_km !== null ? rec.recommended_distance_km.toFixed(1) : 'N/A'}km`);
      console.log(`   Elevation: ${rec.recommended_elevation_gain !== null ? rec.recommended_elevation_gain.toFixed(0) : 'N/A'}m`);
      console.log(`   Score: ${rec.route_score !== null ? rec.route_score.toFixed(3) : 'N/A'}`);
      console.log(`   Type: ${rec.route_type || 'N/A'}`);
      console.log(`   Shape: ${rec.route_shape || 'N/A'}`);
      console.log(`   Trail Count: ${rec.trail_count || 'N/A'}`);
      console.log(`   Created: ${rec.created_at ? new Date(rec.created_at).toLocaleString() : 'N/A'}`);
      
      // Parse route edges if available
      if (rec.route_edges) {
        try {
          const edges = JSON.parse(rec.route_edges);
          console.log(`   Route Edges: ${edges.length} segments`);
        } catch (e) {
          console.log(`   Route Edges: Invalid JSON`);
        }
      }
    }

    // Step 8: Summary statistics
    console.log('\n📊 SUMMARY STATISTICS');
    console.log('='.repeat(30));
    
    const summary = db.prepare(`
      SELECT 
        COUNT(*) as total_routes,
        AVG(recommended_distance_km) as avg_distance,
        AVG(recommended_elevation_gain) as avg_elevation,
        AVG(route_score) as avg_score,
        AVG(trail_count) as avg_trail_count,
        MIN(recommended_distance_km) as min_distance,
        MAX(recommended_distance_km) as max_distance,
        MIN(recommended_elevation_gain) as min_elevation,
        MAX(recommended_elevation_gain) as max_elevation
      FROM route_recommendations
    `).get();

    console.log(`Total Routes: ${summary.total_routes}`);
    console.log(`Average Distance: ${summary.avg_distance !== null ? summary.avg_distance.toFixed(1) : 'N/A'}km`);
    console.log(`Average Elevation: ${summary.avg_elevation !== null ? summary.avg_elevation.toFixed(0) : 'N/A'}m`);
    console.log(`Average Score: ${summary.avg_score !== null ? summary.avg_score.toFixed(3) : 'N/A'}`);
    console.log(`Average Trail Count: ${summary.avg_trail_count !== null ? summary.avg_trail_count.toFixed(1) : 'N/A'}`);
    console.log(`Distance Range: ${summary.min_distance !== null ? summary.min_distance.toFixed(1) : 'N/A'}km - ${summary.max_distance !== null ? summary.max_distance.toFixed(1) : 'N/A'}km`);
    console.log(`Elevation Range: ${summary.min_elevation !== null ? summary.min_elevation.toFixed(0) : 'N/A'}m - ${summary.max_elevation !== null ? summary.max_elevation.toFixed(0) : 'N/A'}m`);

    db.close();
    console.log('\n✅ Route recommendations analysis completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testRouteRecommendations().catch(console.error); 