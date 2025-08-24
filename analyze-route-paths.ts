#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function main() {
  console.log('🔍 Analyzing route paths to check if they are true loops...');
  
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD,
  });

  try {
    const stagingSchema = 'bear_canyon_test';
    
    // Get the complex loop routes with their full paths
    const routesResult = await pool.query(`
      SELECT 
        route_uuid,
        route_name,
        route_shape,
        recommended_length_km,
        recommended_elevation_gain,
        route_path,
        route_edges
      FROM ${stagingSchema}.route_recommendations
      WHERE route_name LIKE '%Complex Loop%'
      ORDER BY recommended_length_km DESC
    `);
    
    console.log(`📊 Found ${routesResult.rows.length} complex loop routes to analyze\n`);
    
    for (const route of routesResult.rows) {
      console.log(`🔍 Analyzing: ${route.route_name}`);
      console.log(`   Length: ${route.recommended_length_km.toFixed(2)}km`);
      console.log(`   Elevation: ${route.recommended_elevation_gain.toFixed(0)}m`);
      
      // Parse the route path (node sequence)
      const routePath = route.route_path;
      console.log(`   Node Path: ${JSON.stringify(routePath)}`);
      
      // Parse route edges
      const routeEdges = route.route_edges;
      console.log(`   Edge Count: ${routeEdges.length}`);
      
      // Check if edges are unique or duplicated
      const edgeIds = routeEdges.map((edge: any) => edge.edge_id);
      const uniqueEdgeIds = [...new Set(edgeIds)];
      
      console.log(`   Unique Edges: ${uniqueEdgeIds.length} / ${edgeIds.length}`);
      
      if (uniqueEdgeIds.length < edgeIds.length) {
        console.log(`   ⚠️  DUPLICATE EDGES DETECTED - This is an out-and-back route, not a true loop!`);
        
        // Find which edges are duplicated
        const edgeCounts: { [key: number]: number } = {};
        edgeIds.forEach((id: number) => {
          edgeCounts[id] = (edgeCounts[id] || 0) + 1;
        });
        
        const duplicates = Object.entries(edgeCounts).filter(([id, count]) => count > 1);
        console.log(`   Duplicated Edges: ${duplicates.map(([id, count]) => `Edge ${id} (${count}x)`).join(', ')}`);
      } else {
        console.log(`   ✅ All edges are unique - This appears to be a true loop`);
      }
      
      // Check if the path forms a circuit
      if (routePath.length > 0 && routePath[0] === routePath[routePath.length - 1]) {
        console.log(`   ✅ Path starts and ends at same node (${routePath[0]})`);
      } else {
        console.log(`   ❌ Path does not form a circuit`);
      }
      
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error analyzing routes:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
