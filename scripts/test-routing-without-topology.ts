#!/usr/bin/env ts-node

import { Client } from 'pg';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

const STAGING_SCHEMA = 'staging_boulder_test_improved_loops';

async function testRoutingWithoutTopology() {
  try {
    await client.connect();
    console.log('🔧 Testing routing without recreating topology...');

    // Step 1: Check current network state
    console.log('\n📊 Step 1: Checking current network state...');
    
    const networkStats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded) as edges_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_vertices_pgr) as vertices_count,
        (SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NULL OR target IS NULL) as null_connections
    `);
    
    const stats = networkStats.rows[0];
    console.log(`📊 Network Stats: ${stats.edges_count} edges, ${stats.vertices_count} vertices, ${stats.null_connections} null connections`);

    // Step 2: Find some test vertices for routing
    console.log('\n📊 Step 2: Finding test vertices for routing...');
    
    const testVertices = await client.query(`
      SELECT id, cnt, the_geom
      FROM ${STAGING_SCHEMA}.ways_vertices_pgr
      WHERE cnt >= 2
      ORDER BY cnt DESC, RANDOM()
      LIMIT 10
    `);
    
    console.log(`🔍 Found ${testVertices.rows.length} vertices with 2+ connections for testing`);
    
    if (testVertices.rows.length < 2) {
      console.log('⚠️  Not enough connected vertices for routing test');
      return;
    }

    // Step 3: Test routing between different vertex pairs
    console.log('\n📊 Step 3: Testing routing between vertices...');
    
    const routes: any[] = [];
    let successfulRoutes = 0;
    let failedRoutes = 0;

    for (let i = 0; i < Math.min(5, testVertices.rows.length - 1); i++) {
      const startVertex = testVertices.rows[i];
      const endVertex = testVertices.rows[i + 1];

      try {
        console.log(`  🧪 Testing route from vertex ${startVertex.id} (${startVertex.cnt} connections) to ${endVertex.id} (${endVertex.cnt} connections)...`);
        
        // Test routing with pgr_dijkstra
        const routeQuery = `
          SELECT 
            COUNT(*) as route_segments,
            SUM(cost) as total_cost,
            COUNT(CASE WHEN cost IS NULL THEN 1 END) as null_costs
          FROM pgr_dijkstra(
            'SELECT id, source, target, ST_Length(the_geom::geography) as cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
            ${startVertex.id}, ${endVertex.id}, false
          )
          WHERE cost IS NOT NULL
        `;
        
        const routeResult = await client.query(routeQuery);
        const route = routeResult.rows[0];
        
        if (route.route_segments > 0 && route.null_costs === 0) {
          console.log(`    ✅ Route found: ${route.route_segments} segments, ${route.total_cost.toFixed(1)}m total`);
          successfulRoutes++;
          
          // Generate GeoJSON for this route
          const routeGeoJSONQuery = `
            SELECT 
              json_build_object(
                'type', 'Feature',
                'properties', json_build_object(
                  'type', 'test_route',
                  'route_id', ${i + 1},
                  'start_vertex', ${startVertex.id},
                  'end_vertex', ${endVertex.id},
                  'segments', ${route.route_segments},
                  'total_cost', ${route.total_cost},
                  'color', '#00ff00',
                  'weight', 4,
                  'opacity', 0.9
                ),
                'geometry', ST_AsGeoJSON(ST_MakeLine(ARRAY_AGG(the_geom ORDER BY seq)))::json
              ) as route
            FROM (
              SELECT 
                wn.the_geom,
                dijkstra.seq
              FROM pgr_dijkstra(
                'SELECT id, source, target, ST_Length(the_geom::geography) as cost FROM ${STAGING_SCHEMA}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL',
                ${startVertex.id}, ${endVertex.id}, false
              ) dijkstra
              JOIN ${STAGING_SCHEMA}.ways_noded wn ON dijkstra.edge = wn.id
              WHERE dijkstra.cost IS NOT NULL
            ) route_edges
          `;
          
          const routeGeoJSONResult = await client.query(routeGeoJSONQuery);
          if (routeGeoJSONResult.rows[0].route) {
            routes.push(routeGeoJSONResult.rows[0].route);
          }
          
        } else {
          console.log(`    ❌ No route found or invalid route`);
          failedRoutes++;
        }
        
      } catch (error) {
        console.log(`    ❌ Routing failed: ${error}`);
        failedRoutes++;
      }
    }

    // Step 4: Export test routes
    if (routes.length > 0) {
      const routesGeoJSON = {
        type: 'FeatureCollection',
        features: routes
      };
      
      const fs = require('fs');
      fs.writeFileSync('test-routes-without-topology.geojson', JSON.stringify(routesGeoJSON, null, 2));
      console.log(`\n✅ Exported ${routes.length} test routes to test-routes-without-topology.geojson`);
    }

    // Step 5: Summary
    console.log(`\n📊 Routing Test Summary:`);
    console.log(`  Successful routes: ${successfulRoutes}`);
    console.log(`  Failed routes: ${failedRoutes}`);
    console.log(`  Success rate: ${((successfulRoutes / (successfulRoutes + failedRoutes)) * 100).toFixed(1)}%`);

    if (successfulRoutes > 0) {
      console.log('\n✅ Network is routeable without recreating topology!');
    } else {
      console.log('\n❌ Network needs topology recreation for routing');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

testRoutingWithoutTopology(); 