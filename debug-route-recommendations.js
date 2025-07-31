#!/usr/bin/env node

/**
 * Debug script for route recommendations
 * Helps identify why route recommendations are generating zero results
 */

const { Client } = require('pg');
const fs = require('fs');

async function debugRouteRecommendations() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || '',
  });

  try {
    await client.connect();
    console.log('🔍 Debugging route recommendations...\n');

    // Check database connection
    console.log('1. Database Connection:');
    const dbInfo = await client.query('SELECT current_database(), current_user');
    console.log(`   Database: ${dbInfo.rows[0].current_database}`);
    console.log(`   User: ${dbInfo.rows[0].current_user}\n`);

    // Check if route_recommendations table exists
    console.log('2. Route Recommendations Table:');
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'route_recommendations'
      )
    `);
    console.log(`   Table exists: ${tableExists.rows[0].exists}\n`);

    // Check route patterns
    console.log('3. Route Patterns:');
    try {
      const patterns = await client.query('SELECT * FROM get_route_patterns()');
      console.log(`   Found ${patterns.rows.length} patterns:`);
      patterns.rows.forEach(p => {
        console.log(`     - ${p.pattern_name}: ${p.target_distance_km}km, ${p.target_elevation_gain}m, ${p.route_shape}, ±${p.tolerance_percent}%`);
      });
    } catch (error) {
      console.log(`   ❌ Error getting patterns: ${error.message}`);
    }
    console.log('');

    // Check config values
    console.log('4. Configuration Values:');
    try {
      const minScore = await client.query('SELECT get_min_route_score() as min_score');
      const maxRoutes = await client.query('SELECT get_max_routes_per_bin() as max_routes');
      const distanceLimits = await client.query('SELECT get_route_distance_limits() as limits');
      const elevationLimits = await client.query('SELECT get_elevation_gain_limits() as limits');
      
      console.log(`   Min route score: ${minScore.rows[0].min_score}`);
      console.log(`   Max routes per bin: ${maxRoutes.rows[0].max_routes}`);
      console.log(`   Distance limits: ${JSON.stringify(distanceLimits.rows[0].limits)}`);
      console.log(`   Elevation limits: ${JSON.stringify(elevationLimits.rows[0].limits)}`);
    } catch (error) {
      console.log(`   ❌ Error getting config: ${error.message}`);
    }
    console.log('');

    // Check staging schema
    console.log('5. Staging Schema:');
    const schemas = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      ORDER BY schema_name DESC
      LIMIT 5
    `);
    console.log(`   Found ${schemas.rows.length} staging schemas:`);
    schemas.rows.forEach(s => console.log(`     - ${s.schema_name}`));
    console.log('');

    if (schemas.rows.length > 0) {
      const stagingSchema = schemas.rows[0].schema_name;
      console.log(`6. Analyzing staging schema: ${stagingSchema}`);

      // Check trails
      const trailCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
      console.log(`   Trails: ${trailCount.rows[0].count}`);

      // Check routing nodes
      const nodeCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
      console.log(`   Routing nodes: ${nodeCount.rows[0].count}`);

      // Check routing edges
      const edgeCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
      console.log(`   Routing edges: ${edgeCount.rows[0].count}`);

      // Check node types
      const nodeTypes = await client.query(`
        SELECT node_type, COUNT(*) as count 
        FROM ${stagingSchema}.routing_nodes 
        GROUP BY node_type
      `);
      console.log('   Node types:');
      nodeTypes.rows.forEach(nt => {
        console.log(`     - ${nt.node_type}: ${nt.count}`);
      });

      // Check edge connectivity
      const connectivity = await client.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(DISTINCT source) as unique_sources,
          COUNT(DISTINCT target) as unique_targets,
          AVG(distance_km) as avg_distance,
          MAX(distance_km) as max_distance,
          MIN(distance_km) as min_distance
        FROM ${stagingSchema}.routing_edges
      `);
      const conn = connectivity.rows[0];
      console.log('   Edge connectivity:');
      console.log(`     - Total edges: ${conn.total_edges}`);
      console.log(`     - Unique sources: ${conn.unique_sources}`);
      console.log(`     - Unique targets: ${conn.unique_targets}`);
      console.log(`     - Distance range: ${conn.min_distance?.toFixed(2)}km - ${conn.max_distance?.toFixed(2)}km`);
      console.log(`     - Average distance: ${conn.avg_distance?.toFixed(2)}km`);

      // Test route finding with a simple pattern
      console.log('\n7. Testing route finding:');
      try {
        const testResult = await client.query(`
          SELECT COUNT(*) as route_count
          FROM find_routes_recursive_configurable($1, 5.0, 200.0, 30.0, 8)
        `, [stagingSchema]);
        console.log(`   Test route count (5km, 200m): ${testResult.rows[0].route_count}`);
      } catch (error) {
        console.log(`   ❌ Route finding test failed: ${error.message}`);
      }

      // Check if functions exist
      console.log('\n8. Function Availability:');
      const functions = [
        'generate_route_recommendations',
        'generate_route_recommendations_configurable',
        'find_routes_recursive_configurable',
        'get_route_patterns',
        'get_min_route_score'
      ];
      
      for (const func of functions) {
        try {
          const exists = await client.query(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_name = $1
          `, [func]);
          console.log(`   ${func}: ${exists.rows.length > 0 ? '✅' : '❌'}`);
        } catch (error) {
          console.log(`   ${func}: ❌ (${error.message})`);
        }
      }
    }

    console.log('\n9. Recommendations:');
    console.log('   - Check if routing graph was generated properly');
    console.log('   - Verify trail data has proper geometry and elevation');
    console.log('   - Consider adjusting distance/elevation limits for large datasets');
    console.log('   - Check if minimum route score threshold is too high');
    console.log('   - Verify route patterns are appropriate for the trail network');

  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    await client.end();
  }
}

debugRouteRecommendations().catch(console.error); 