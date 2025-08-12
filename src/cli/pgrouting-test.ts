#!/usr/bin/env ts-node

import { Command } from 'commander';
import { Pool } from 'pg';
import { createPgRoutingHelpers } from '../utils/pgrouting-helpers';
import * as fs from 'fs';

const program = new Command();

program
  .name('pgrouting-test')
  .description('Test pgRouting functionality independently')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze network connectivity using pgRouting')
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'staging_test')
  .option('-d, --database <db>', 'Database name', 'trail_master_db')
  .option('-u, --user <user>', 'Database user', 'shaydu')
  .action(async (options) => {
    try {
      // Create database connection
      const pgClient = new Pool({
        database: options.database,
        user: options.user,
        host: 'localhost',
        port: 5432,
      });

      // Create pgRouting helpers
      const pgrouting = createPgRoutingHelpers(options.stagingSchema, pgClient);

      console.log(`🔍 Analyzing network in ${options.stagingSchema}...`);

      // Create pgRouting views
      const viewsCreated = await pgrouting.createPgRoutingViews();
      if (!viewsCreated) {
        console.error('❌ Failed to create pgRouting views');
        process.exit(1);
      }

      // Analyze the graph
      const analysis = await pgrouting.analyzeGraph();
      if (analysis.success) {
        console.log('✅ Graph analysis completed:', analysis.analysis);
      } else {
        console.error('❌ Graph analysis failed:', analysis.error);
      }

      // Validate network
      const validation = await pgrouting.validateNetwork();
      if (validation.success) {
        console.log('✅ Network validation completed:', validation.analysis);
      } else {
        console.error('❌ Network validation failed:', validation.error);
      }

      // Clean up
      await pgrouting.cleanupViews();
      await pgClient.end();

    } catch (error) {
      console.error('❌ pgRouting test failed:', error);
      process.exit(1);
    }
  });

program
  .command('routes')
  .description('Generate route recommendations using pgRouting')
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'staging_test')
  .option('-d, --database <db>', 'Database name', 'trail_master_db')
  .option('-u, --user <user>', 'Database user', 'shaydu')
  .option('--distance <km>', 'Target distance in km', '5')
  .option('--elevation <m>', 'Target elevation in meters', '200')
  .option('--max-routes <count>', 'Maximum routes to generate', '10')
  .action(async (options) => {
    try {
      // Create database connection
      const pgClient = new Pool({
        database: options.database,
        user: options.user,
        host: 'localhost',
        port: 5432,
      });

      // Create pgRouting helpers
      const pgrouting = createPgRoutingHelpers(options.stagingSchema, pgClient);

      console.log(`🛤️ Generating routes in ${options.stagingSchema}...`);

      // Create pgRouting views
      const viewsCreated = await pgrouting.createPgRoutingViews();
      if (!viewsCreated) {
        console.error('❌ Failed to create pgRouting views');
        process.exit(1);
      }

      // Generate route recommendations
      const routes = await pgrouting.generateRouteRecommendations(
        parseFloat(options.distance),
        parseFloat(options.elevation),
        parseInt(options.maxRoutes)
      );

      if (routes.success && routes.routes) {
        console.log(`✅ Generated ${routes.routes.length} routes:`);
        routes.routes.forEach((route, index) => {
          console.log(`  ${index + 1}. ${route.distance_km.toFixed(2)}km route from node ${route.start_node} to ${route.end_node}`);
        });
      } else {
        console.error('❌ Route generation failed:', routes.error);
      }

      // Clean up (commented out for debugging)
      // await pgrouting.cleanupViews();
      await pgClient.end();

    } catch (error) {
      console.error('❌ pgRouting test failed:', error);
      process.exit(1);
    }
  });

program
  .command('path')
  .description('Find shortest path between two nodes')
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'staging_test')
  .option('-d, --database <db>', 'Database name', 'trail_master_db')
  .option('-u, --user <user>', 'Database user', 'shaydu')
  .option('--start <id>', 'Start node ID', '1')
  .option('--end <id>', 'End node ID', '2')
  .action(async (options) => {
    try {
      // Create database connection
      const pgClient = new Pool({
        database: options.database,
        user: options.user,
        host: 'localhost',
        port: 5432,
      });

      // Create pgRouting helpers
      const pgrouting = createPgRoutingHelpers(options.stagingSchema, pgClient);

      console.log(`🔍 Finding shortest path from ${options.start} to ${options.end}...`);

      // Create pgRouting views
      const viewsCreated = await pgrouting.createPgRoutingViews();
      if (!viewsCreated) {
        console.error('❌ Failed to create pgRouting views');
        process.exit(1);
      }

      // Find shortest path
      const path = await pgrouting.findShortestPath(
        options.start,
        options.end,
        false
      );

      if (path.success && path.routes) {
        console.log(`✅ Found path with ${path.routes.length} edges:`);
        path.routes.forEach((edge, index) => {
          console.log(`  ${index + 1}. Edge ${edge.edge} (cost: ${edge.cost})`);
        });
      } else {
        console.error('❌ Path finding failed:', path.error);
      }

      // Clean up
      await pgrouting.cleanupViews();
      await pgClient.end();

    } catch (error) {
      console.error('❌ pgRouting test failed:', error);
      process.exit(1);
    }
  });

program
  .command('export')
  .description('Export pgRouting data to GeoJSON with different colors')
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'staging_test')
  .option('-d, --database <db>', 'Database name', 'trail_master_db')
  .option('-u, --user <user>', 'Database user', 'shaydu')
  .option('-o, --output <file>', 'Output GeoJSON file', 'pgrouting-export.geojson')
  .option('--distance <km>', 'Target distance for route generation', '3')
  .option('--elevation <m>', 'Target elevation for route generation', '100')
  .option('--max-routes <count>', 'Maximum routes to generate', '5')
  .option('--debug', 'Keep tables for debugging (no cleanup)', false)
  .action(async (options) => {
    try {
      // Create database connection
      const pgClient = new Pool({
        database: options.database,
        user: options.user,
        host: 'localhost',
        port: 5432,
      });

      // Create pgRouting helpers
      const pgrouting = createPgRoutingHelpers(options.stagingSchema, pgClient);

      console.log(`🗺️ Exporting pgRouting data from ${options.stagingSchema}...`);

      // Create pgRouting views
      const viewsCreated = await pgrouting.createPgRoutingViews();
      if (!viewsCreated) {
        console.error('❌ Failed to create pgRouting views');
        process.exit(1);
      }

      // Get nodes (vertices)
      const nodesResult = await pgClient.query(`
        SELECT 
          id,
          ST_AsGeoJSON(the_geom) as geometry,
          cnt,
          chk
        FROM ${options.stagingSchema}.ways_vertices_pgr
        WHERE the_geom IS NOT NULL
      `);

      // Get edges (ways)
      const edgesResult = await pgClient.query(`
        SELECT 
          gid,
          source,
          target,
          cost,
          reverse_cost,
          ST_AsGeoJSON(the_geom) as geometry
        FROM ${options.stagingSchema}.ways
        WHERE the_geom IS NOT NULL
      `);

      // Generate some routes
      const routesResult = await pgrouting.generateRouteRecommendations(
        parseFloat(options.distance),
        parseFloat(options.elevation),
        parseInt(options.maxRoutes)
      );

      // Build GeoJSON
      const geojson: any = {
        type: 'FeatureCollection',
        features: []
      };

      // Add nodes (red)
      nodesResult.rows.forEach((node: any) => {
        geojson.features.push({
          type: 'Feature',
          properties: {
            type: 'node',
            id: node.id,
            cnt: node.cnt,
            chk: node.chk,
            color: '#ff0000', // Red
            stroke: '#ff0000',
            'stroke-width': 3,
            'marker-size': 'medium',
            'marker-color': '#ff0000'
          },
          geometry: JSON.parse(node.geometry)
        });
      });

      // Add edges (blue)
      console.log(`🔍 Processing ${edgesResult.rows.length} edges for GeoJSON...`);
      console.log(`  Sample edge IDs: ${edgesResult.rows.slice(0, 3).map((e: any) => e.id).join(', ')}`);
      console.log(`  Edge fields: ${Object.keys(edgesResult.rows[0] || {}).join(', ')}`);
      edgesResult.rows.forEach((edge: any) => {
        geojson.features.push({
          type: 'Feature',
          properties: {
            type: 'edge',
            id: edge.gid,
            source: edge.source,
            target: edge.target,
            cost: edge.cost,
            reverse_cost: edge.reverse_cost,
            color: '#0000ff', // Blue
            stroke: '#0000ff',
            'stroke-width': 2
          },
          geometry: JSON.parse(edge.geometry)
        });
      });

      // Add routes (green)
      console.log(`🔍 Processing ${routesResult.routes?.length || 0} routes for GeoJSON...`);
      if (routesResult.success && routesResult.routes) {
        routesResult.routes.forEach((route: any, index: number) => {
          console.log(`  Route ${index + 1}: ${route.start_node} -> ${route.end_node}, ${route.path_edges?.length || 0} edges`);
          // Create a line geometry from the actual route path
          const routeGeometry: any = {
            type: 'LineString',
            coordinates: []
          };

          // Trace the actual path through the edges
          if (route.path_edges && route.path_edges.length > 0) {
            console.log(`    Edge IDs: ${route.path_edges.join(', ')}`);
            // Get the actual edge geometries for this route
            const edgeIds = route.path_edges; // These are now integer IDs
            const edgeGeometries = edgesResult.rows.filter((edge: any) => 
              edgeIds.includes(edge.gid) // Use edge.gid (integer) to match pgRouting IDs
            );
            console.log(`    Found ${edgeGeometries.length} matching edge geometries`);

            // Build the route path from the edge geometries
            const pathCoords: number[][] = [];
            
            // Process edges in order to create a continuous path
            for (let i = 0; i < edgeGeometries.length; i++) {
              const edge = JSON.parse(edgeGeometries[i].geometry);
              if (edge.coordinates && edge.coordinates.length > 0) {
                if (i === 0) {
                  // First edge: add all coordinates
                  pathCoords.push(...edge.coordinates);
                } else {
                  // Subsequent edges: add coordinates starting from the second point
                  // to avoid duplicating the connection point
                  pathCoords.push(...edge.coordinates.slice(1));
                }
              }
            }

            routeGeometry.coordinates = pathCoords;
          } else {
            // Fallback to simple line between start and end nodes
            const startNode = nodesResult.rows.find((n: any) => n.id === route.start_node);
            const endNode = nodesResult.rows.find((n: any) => n.id === route.end_node);
            
            if (startNode && endNode) {
              const startCoords = JSON.parse(startNode.geometry).coordinates;
              const endCoords = JSON.parse(endNode.geometry).coordinates;
              routeGeometry.coordinates = [startCoords, endCoords];
            }
          }
          
          if (routeGeometry.coordinates.length > 0) {
            geojson.features.push({
              type: 'Feature',
              properties: {
                type: 'route',
                id: `route_${index}`,
                start_node: route.start_node,
                end_node: route.end_node,
                distance_km: route.distance_km,
                elevation_m: route.elevation_m,
                color: '#00ff00', // Green
                stroke: '#00ff00',
                'stroke-width': 8, // Much thicker
                'stroke-opacity': 0.9, // More opaque
                'stroke-dasharray': '10,5', // Longer dashes
                'z-index': 1000 // Render on top
              },
              geometry: routeGeometry
            });
          }
        });
      }

      // Write GeoJSON file
      fs.writeFileSync(options.output, JSON.stringify(geojson, null, 2));
      console.log(`✅ Exported GeoJSON to ${options.output}`);
      console.log(`📊 Summary:`);
      console.log(`  - Nodes (red): ${nodesResult.rows.length}`);
      console.log(`  - Edges (blue): ${edgesResult.rows.length}`);
      console.log(`  - Routes (green): ${routesResult.success ? routesResult.routes?.length || 0 : 0}`);

      // Clean up
      if (!options.debug) {
        await pgrouting.cleanupViews();
      } else {
        console.log('🔧 Debug mode: Keeping pgRouting tables for inspection');
      }
      await pgClient.end();

    } catch (error) {
      console.error('❌ pgRouting export failed:', error);
      process.exit(1);
    }
  });

program.parse(); 