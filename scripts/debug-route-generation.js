#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config();

async function debugRouteGeneration() {
  console.log('🔍 Debugging Route Generation');
  console.log('================================');
  
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Find the most recent staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_boulder_%'
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schemas found. Creating one...');
      
      // Run a quick export to create staging schema
      const { execSync } = require('child_process');
      console.log('🚀 Running quick export to create staging schema...');
      execSync('PGDATABASE=trail_master_db PGUSER=tester npx ts-node src/cli/export.ts --region boulder --out debug-test.db --bbox -105.29,39.986,-105.272,40.004 --trails-only --skip-bbox-validation --skip-cleanup', { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
      
      // Now find the staging schema again
      const newSchemaResult = await client.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_boulder_%'
        ORDER BY schema_name DESC 
        LIMIT 1
      `);
      
      if (newSchemaResult.rows.length === 0) {
        console.log('❌ Still no staging schemas found.');
        return;
      }
      
      schemaResult.rows = newSchemaResult.rows;
    }

    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);

    // Check what's in the staging schema
    const trailsResult = await client.query(`
      SELECT COUNT(*) as trail_count FROM ${stagingSchema}.trails
    `);
    const nodesResult = await client.query(`
      SELECT COUNT(*) as node_count FROM ${stagingSchema}.routing_nodes
    `);
    const edgesResult = await client.query(`
      SELECT COUNT(*) as edge_count FROM ${stagingSchema}.routing_edges
    `);

    console.log(`📊 Staging schema contents:`);
    console.log(`   - Trails: ${trailsResult.rows[0].trail_count}`);
    console.log(`   - Nodes: ${nodesResult.rows[0].node_count}`);
    console.log(`   - Edges: ${edgesResult.rows[0].edge_count}`);

    // Test route patterns
    console.log('\n🎯 Testing Route Patterns:');
    const patternsResult = await client.query('SELECT * FROM get_route_patterns()');
    patternsResult.rows.forEach((pattern, index) => {
      console.log(`   ${index + 1}. ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m gain, ${pattern.route_shape}`);
    });

    // Test route finding for the shortest pattern
    const shortestPattern = patternsResult.rows[0];
    console.log(`\n🔍 Testing route finding for: ${shortestPattern.target_distance_km}km, ${shortestPattern.target_elevation_gain}m gain`);
    
    const routeResult = await client.query(`
      SELECT * FROM find_routes_recursive_configurable(
        $1,
        $2,
        $3,
        $4,
        8
      ) LIMIT 5
    `, [stagingSchema, shortestPattern.target_distance_km, shortestPattern.target_elevation_gain, shortestPattern.tolerance_percent]);

    console.log(`📊 Found ${routeResult.rows.length} potential routes`);
    
    if (routeResult.rows.length > 0) {
      routeResult.rows.forEach((route, index) => {
        console.log(`   Route ${index + 1}:`);
        console.log(`     - Distance: ${route.total_distance_km}km`);
        console.log(`     - Elevation: ${route.total_elevation_gain}m`);
        console.log(`     - Shape: ${route.route_shape}`);
        console.log(`     - Score: ${route.similarity_score}`);
        console.log(`     - Trail count: ${route.trail_count}`);
      });
    } else {
      console.log('❌ No routes found. Checking why...');
      
      // Check if there are any connected trails
      const connectedTrailsResult = await client.query(`
        SELECT COUNT(DISTINCT trail_id) as connected_trails
        FROM ${stagingSchema}.routing_edges
      `);
      console.log(`   Connected trails: ${connectedTrailsResult.rows[0].connected_trails}`);
      
      // Check trail lengths
      const trailLengthsResult = await client.query(`
        SELECT 
          COUNT(*) as total_trails,
          AVG(length_km) as avg_length,
          MIN(length_km) as min_length,
          MAX(length_km) as max_length
        FROM ${stagingSchema}.trails
      `);
      const lengths = trailLengthsResult.rows[0];
      console.log(`   Trail lengths: ${lengths.total_trails} trails, avg ${lengths.avg_length.toFixed(2)}km (${lengths.min_length.toFixed(2)}-${lengths.max_length.toFixed(2)}km)`);
      
      // Check if trails are too short for the target
      if (lengths.max_length < shortestPattern.target_distance_km) {
        console.log(`   ⚠️  All trails are shorter than target distance (${shortestPattern.target_distance_km}km)`);
      }
    }

    // Test route generation function directly
    console.log('\n🎯 Testing route generation function:');
    const generationResult = await client.query(`
      SELECT generate_route_recommendations_configurable($1, 'boulder')
    `, [stagingSchema]);
    
    console.log(`   Generated ${generationResult.rows[0].generate_route_recommendations_configurable} routes`);

    // Check if routes were actually inserted
    const insertedRoutesResult = await client.query(`
      SELECT COUNT(*) as route_count FROM ${stagingSchema}.route_recommendations
    `);
    console.log(`   Routes in staging schema: ${insertedRoutesResult.rows[0].route_count}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

debugRouteGeneration().catch(console.error); 