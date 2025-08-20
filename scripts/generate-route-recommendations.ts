#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { createPgRoutingHelpers } from '../src/utils/pgrouting-helpers';

async function generateRouteRecommendations() {
  const pgClient = new Pool({
    database: 'trail_master_db',
    user: 'shaydu',
    host: 'localhost',
    port: 5432,
  });

  try {
    console.log('🛤️ Generating route recommendations using existing network...');

    // Create pgRouting helpers for the staging schema
    const pgrouting = createPgRoutingHelpers('carthorse_1755713127766', pgClient);

    // Check if the network exists
    const networkCheck = await pgClient.query(`
      SELECT COUNT(*) as edge_count, 
             (SELECT COUNT(*) FROM carthorse_1755713127766.ways_noded_vertices_pgr) as vertex_count
      FROM carthorse_1755713127766.ways_noded
    `);

    const counts = networkCheck.rows[0];
    console.log(`📊 Found existing network: ${counts.edge_count} edges, ${counts.vertex_count} vertices`);

    if (counts.edge_count === 0) {
      console.error('❌ No edges found in carthorse_1755713127766.ways_noded. Please run the export command first.');
      return;
    }

    // Generate route recommendations
    console.log('🎯 Generating route recommendations...');
    const routes = await pgrouting.generateRouteRecommendations(3, 150, 20);

    if (routes.success && routes.routes) {
      console.log(`✅ Generated ${routes.routes.length} route recommendations:`);
      
      // Store routes in route_recommendations table
      console.log('💾 Storing route recommendations in database...');
      
      // Create route_recommendations table if it doesn't exist
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS carthorse_1755713127766.route_recommendations (
          id SERIAL PRIMARY KEY,
          route_uuid TEXT UNIQUE,
          input_length_km NUMERIC,
          input_elevation_gain NUMERIC,
          recommended_length_km NUMERIC,
          recommended_elevation_gain NUMERIC,
          route_score NUMERIC,
          route_name TEXT,
          route_shape TEXT,
          trail_count INTEGER,
          route_path JSONB,
          route_edges JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          type TEXT DEFAULT 'route',
          color TEXT DEFAULT '#FF8C00',
          stroke TEXT DEFAULT '#FF8C00',
          strokeWidth INTEGER DEFAULT 3
        )
      `);

      // Clear existing recommendations
      await pgClient.query('DELETE FROM carthorse_1755713127766.route_recommendations');

      // Insert new recommendations
      for (let i = 0; i < routes.routes.length; i++) {
        const route = routes.routes[i];
        const routeUuid = `unified-point-to-point-hawick-circuits-${Date.now()}-${i}`;
        
        await pgClient.query(`
          INSERT INTO staging.route_recommendations (
            route_uuid,
            input_length_km,
            input_elevation_gain,
            recommended_length_km,
            recommended_elevation_gain,
            route_score,
            route_name,
            route_shape,
            trail_count,
            route_path,
            route_edges
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          routeUuid,
          3, // input_length_km
          150, // input_elevation_gain
          route.distance_km,
          route.elevation_m,
          0.1, // route_score (placeholder)
          `Route ${i + 1} via ${route.path_edges?.length || 0} trails`,
          'point-to-point',
          route.path_edges?.length || 0,
          JSON.stringify(route.path_edges || []),
          JSON.stringify(route.path_edges || [])
        ]);

        console.log(`  ${i + 1}. ${route.distance_km.toFixed(2)}km route from node ${route.start_node} to ${route.end_node} (${route.path_edges?.length || 0} edges)`);
      }

      console.log(`✅ Stored ${routes.routes.length} route recommendations in carthorse_1755713127766.route_recommendations`);
    } else {
      console.error('❌ Route generation failed:', routes.error);
    }

  } catch (error) {
    console.error('❌ Error generating route recommendations:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the script
generateRouteRecommendations().catch(console.error);
