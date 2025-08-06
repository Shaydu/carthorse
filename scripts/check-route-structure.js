#!/usr/bin/env node

const { Pool } = require('pg');
const { getDatabasePoolConfig } = require('../src/utils/config-loader.ts');

async function checkRouteStructure() {
  const config = getDatabasePoolConfig();
  const client = new Pool(config);
  
  try {
    // Find the staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`🔍 Checking routes in schema: ${stagingSchema}`);
    
    // Check route count
    const countResult = await client.query(`
      SELECT COUNT(*) as route_count 
      FROM ${stagingSchema}.route_recommendations
    `);
    
    console.log(`📊 Total routes: ${countResult.rows[0].route_count}`);
    
    // Check route_edges structure
    const routeResult = await client.query(`
      SELECT route_uuid, route_edges, route_path
      FROM ${stagingSchema}.route_recommendations 
      LIMIT 1
    `);
    
    if (routeResult.rows.length > 0) {
      const route = routeResult.rows[0];
      console.log('🔍 Route structure:');
      console.log('Route UUID:', route.route_uuid);
      console.log('Route edges type:', typeof route.route_edges);
      console.log('Route edges length:', route.route_edges ? route.route_edges.length : 'null');
      console.log('Route edges preview:', route.route_edges ? route.route_edges.substring(0, 200) + '...' : 'null');
      
      // Check if route_edges is valid JSON
      try {
        if (route.route_edges) {
          const parsed = JSON.parse(route.route_edges);
          console.log('✅ Route edges is valid JSON');
          console.log('Number of edges:', Array.isArray(parsed) ? parsed.length : 'not an array');
        }
      } catch (e) {
        console.log('❌ Route edges is not valid JSON:', e.message);
      }
    } else {
      console.log('❌ No routes found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkRouteStructure(); 