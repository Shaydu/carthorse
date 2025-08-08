#!/usr/bin/env node
/**
 * Check Route Recommendations Script
 * 
 * This script checks if route recommendations exist in the staging schema
 * without running the full export process.
 */

const { Client } = require('pg');

async function checkRouteRecommendations() {
  const client = new Client({
    database: 'trail_master_db',
    user: 'tester'
  });

  try {
    await client.connect();
    console.log('🔍 Checking route recommendations in staging schemas...');

    // Find all staging schemas
    const schemasResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      ORDER BY schema_name DESC
    `);

    console.log(`Found ${schemasResult.rows.length} staging schemas:`);
    
    for (const row of schemasResult.rows) {
      const schemaName = row.schema_name;
      console.log(`\n📋 Checking schema: ${schemaName}`);
      
      // Check if route_recommendations table exists
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = 'route_recommendations'
        )
      `, [schemaName]);
      
      if (tableExists.rows[0].exists) {
        // Count route recommendations
        const countResult = await client.query(`
          SELECT COUNT(*) as route_count
          FROM ${schemaName}.route_recommendations
        `);
        
        const routeCount = countResult.rows[0].route_count;
        console.log(`  ✅ route_recommendations table exists with ${routeCount} routes`);
        
        if (routeCount > 0) {
          // Show some sample routes
          const sampleResult = await client.query(`
            SELECT route_name, route_shape, route_score, recommended_distance_km
            FROM ${schemaName}.route_recommendations
            LIMIT 3
          `);
          
          console.log('  📊 Sample routes:');
          for (const route of sampleResult.rows) {
            console.log(`    - ${route.route_name} (${route.route_shape}, score: ${route.route_score}, distance: ${route.recommended_distance_km}km)`);
          }
        }
      } else {
        console.log(`  ❌ route_recommendations table does not exist`);
      }
    }

  } catch (error) {
    console.error('❌ Error checking route recommendations:', error);
  } finally {
    await client.end();
  }
}

checkRouteRecommendations(); 