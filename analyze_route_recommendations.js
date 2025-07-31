#!/usr/bin/env node

const { Client } = require('pg');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

async function analyzeRouteRecommendations() {
  console.log('🔍 Analyzing Route Recommendations...\n');

  // Check PostgreSQL database for route recommendations
  const pgClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'carthorse_test',
    user: process.env.DB_USER || 'tester',
    password: process.env.DB_PASSWORD || 'test'
  });

  try {
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL');

    // Check if route_recommendations table exists and has data
    const tableCheck = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'route_recommendations'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('❌ No route_recommendations table found in PostgreSQL');
      return;
    }

    const countResult = await pgClient.query('SELECT COUNT(*) as count FROM route_recommendations');
    const totalRecommendations = countResult.rows[0].count;

    if (totalRecommendations === 0) {
      console.log('❌ No route recommendations found in PostgreSQL');
      console.log('💡 Route recommendations need to be generated first');
      return;
    }

    console.log(`📊 Found ${totalRecommendations} route recommendations in PostgreSQL`);

    // Analyze trail count distribution
    const trailCountStats = await pgClient.query(`
      SELECT 
        trail_count,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM route_recommendations), 1) as percentage
      FROM route_recommendations 
      WHERE trail_count IS NOT NULL
      GROUP BY trail_count 
      ORDER BY trail_count
    `);

    console.log('\n📈 Trail Count Distribution:');
    console.log('Trail Count | Count | Percentage');
    console.log('------------|-------|------------');
    
    let totalAnalyzed = 0;
    for (const row of trailCountStats.rows) {
      console.log(`${row.trail_count.toString().padStart(10)} | ${row.count.toString().padStart(5)} | ${row.percentage.toString().padStart(9)}%`);
      totalAnalyzed += parseInt(row.count);
    }

    // Analyze route types
    const routeTypeStats = await pgClient.query(`
      SELECT 
        route_shape,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM route_recommendations), 1) as percentage
      FROM route_recommendations 
      WHERE route_shape IS NOT NULL
      GROUP BY route_shape 
      ORDER BY count DESC
    `);

    console.log('\n🛤️  Route Type Distribution:');
    console.log('Route Type      | Count | Percentage');
    console.log('----------------|-------|------------');
    
    for (const row of routeTypeStats.rows) {
      console.log(`${row.route_shape.padStart(14)} | ${row.count.toString().padStart(5)} | ${row.percentage.toString().padStart(9)}%`);
    }

    // Analyze distance ranges
    const distanceStats = await pgClient.query(`
      SELECT 
        CASE 
          WHEN recommended_distance_km < 5 THEN 'Short (<5km)'
          WHEN recommended_distance_km < 10 THEN 'Medium (5-10km)'
          WHEN recommended_distance_km < 20 THEN 'Long (10-20km)'
          ELSE 'Very Long (>20km)'
        END as distance_category,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM route_recommendations), 1) as percentage
      FROM route_recommendations 
      WHERE recommended_distance_km IS NOT NULL
      GROUP BY 
        CASE 
          WHEN recommended_distance_km < 5 THEN 'Short (<5km)'
          WHEN recommended_distance_km < 10 THEN 'Medium (5-10km)'
          WHEN recommended_distance_km < 20 THEN 'Long (10-20km)'
          ELSE 'Very Long (>20km)'
        END
      ORDER BY 
        CASE 
          WHEN recommended_distance_km < 5 THEN 1
          WHEN recommended_distance_km < 10 THEN 2
          WHEN recommended_distance_km < 20 THEN 3
          ELSE 4
        END
    `);

    console.log('\n📏 Distance Distribution:');
    console.log('Distance Category | Count | Percentage');
    console.log('------------------|-------|------------');
    
    for (const row of distanceStats.rows) {
      console.log(`${row.distance_category.padStart(16)} | ${row.count.toString().padStart(5)} | ${row.percentage.toString().padStart(9)}%`);
    }

    // Show some example recommendations
    const examples = await pgClient.query(`
      SELECT 
        route_uuid,
        recommended_distance_km,
        recommended_elevation_gain,
        route_shape,
        trail_count,
        route_score
      FROM route_recommendations 
      ORDER BY route_score DESC 
      LIMIT 10
    `);

    console.log('\n🏆 Top 10 Recommendations (by score):');
    console.log('UUID | Distance | Elevation | Type | Trails | Score');
    console.log('-----|----------|-----------|------|--------|------');
    
    for (const row of examples.rows) {
      const uuid = row.route_uuid.substring(0, 8);
      const distance = row.recommended_distance_km?.toFixed(1) || 'N/A';
      const elevation = row.recommended_elevation_gain?.toFixed(0) || 'N/A';
      const type = row.route_shape || 'N/A';
      const trails = row.trail_count || 'N/A';
      const score = row.route_score !== null ? row.route_score.toFixed(1) : 'N/A';
      
      console.log(`${uuid} | ${distance.padStart(8)} | ${elevation.padStart(9)} | ${type.padStart(4)} | ${trails.toString().padStart(6)} | ${score.padStart(5)}`);
    }

  } catch (error) {
    console.error('❌ Error analyzing route recommendations:', error);
  } finally {
    await pgClient.end();
  }

  // Also check SQLite databases
  console.log('\n🔍 Checking SQLite databases for route recommendations...');
  
  const sqliteFiles = [
    'test-output/boulder-v13-fixed-elevation.db',
    'test-output/boulder-v13-parametric.db',
    'test-export-boulder.db',
    'test-export-no-split-trails.db'
  ];

  for (const dbPath of sqliteFiles) {
    if (fs.existsSync(dbPath)) {
      try {
        const db = new Database(dbPath);
        
        // Check if route_recommendations table exists
        const tableExists = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='route_recommendations'
        `).get();

        if (tableExists) {
          const count = db.prepare('SELECT COUNT(*) as count FROM route_recommendations').get().count;
          console.log(`📁 ${dbPath}: ${count} recommendations`);
          
          if (count > 0) {
            // Analyze trail count distribution
            const trailCounts = db.prepare(`
              SELECT trail_count, COUNT(*) as count
              FROM route_recommendations 
              WHERE trail_count IS NOT NULL
              GROUP BY trail_count 
              ORDER BY trail_count
            `).all();

            console.log(`  Trail count distribution:`);
            for (const row of trailCounts) {
              console.log(`    ${row.trail_count} trails: ${row.count} routes`);
            }
          }
        } else {
          console.log(`📁 ${dbPath}: No route_recommendations table`);
        }
        
        db.close();
      } catch (error) {
        console.log(`📁 ${dbPath}: Error reading database`);
      }
    }
  }
}

// Run the analysis
analyzeRouteRecommendations().catch(console.error); 