#!/usr/bin/env node

const fs = require('fs');
const { Pool } = require('pg');

async function validateRouteExport() {
  const pool = new Pool({
    database: 'trail_master_db',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
  });

  try {
    // Find the most recent staging schema
    const schemaResult = await pool.query(`
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
    console.log(`🔍 Validating routes in schema: ${stagingSchema}`);

    // Get a sample route
    const routeResult = await pool.query(`
      SELECT route_uuid, route_name, route_edges, route_path
      FROM ${stagingSchema}.route_recommendations 
      WHERE route_edges IS NOT NULL 
      LIMIT 1
    `);

    if (routeResult.rows.length === 0) {
      console.log('❌ No routes found');
      return;
    }

    const route = routeResult.rows[0];
    console.log(`\n📋 Sample Route: ${route.route_name}`);
    console.log(`   UUID: ${route.route_uuid}`);
    console.log(`   Edge count: ${route.route_edges.length}`);

    // Extract edge IDs
    const edgeIds = route.route_edges.map(edge => edge.id);
    console.log(`   Edge IDs: [${edgeIds.join(', ')}]`);

    // Check if these edges exist in ways_noded
    const edgesResult = await pool.query(`
      SELECT id, source, target, name, length_km, 
             ST_AsText(ST_StartPoint(the_geom)) as start_point,
             ST_AsText(ST_EndPoint(the_geom)) as end_point
      FROM ${stagingSchema}.ways_noded 
      WHERE id = ANY($1)
      ORDER BY id
    `, [edgeIds]);

    console.log(`\n🔗 Edge Details:`);
    for (const edge of edgesResult.rows) {
      console.log(`   Edge ${edge.id}: ${edge.name}`);
      console.log(`     Source: ${edge.source} → Target: ${edge.target}`);
      console.log(`     Length: ${edge.length_km}km`);
      console.log(`     Start: ${edge.start_point}`);
      console.log(`     End: ${edge.end_point}`);
    }

    // Check connectivity
    console.log(`\n🔗 Edge Connectivity:`);
    for (let i = 0; i < edgesResult.rows.length - 1; i++) {
      const currentEdge = edgesResult.rows[i];
      const nextEdge = edgesResult.rows[i + 1];
      
      if (currentEdge.target === nextEdge.source) {
        console.log(`   ✅ Edge ${currentEdge.id} → Edge ${nextEdge.id}: Connected`);
      } else {
        console.log(`   ❌ Edge ${currentEdge.id} → Edge ${nextEdge.id}: NOT CONNECTED!`);
        console.log(`      ${currentEdge.id}.target (${currentEdge.target}) ≠ ${nextEdge.id}.source (${nextEdge.source})`);
      }
    }

    // Check if the route path matches the edges
    console.log(`\n📊 Route Path Analysis:`);
    if (route.route_path && route.route_path.steps) {
      console.log(`   Route path has ${route.route_path.steps.length} steps`);
      
      const pathEdgeIds = route.route_path.steps.map(step => step.edge);
      console.log(`   Path edge IDs: [${pathEdgeIds.join(', ')}]`);
      
      const pathMatchesEdges = JSON.stringify(pathEdgeIds.sort()) === JSON.stringify(edgeIds.sort());
      console.log(`   Path matches edges: ${pathMatchesEdges ? '✅' : '❌'}`);
    }

    // Validate that edges are within reasonable distance
    console.log(`\n📏 Distance Validation:`);
    for (const edge of edgesResult.rows) {
      if (edge.length_km > 2.0) {
        console.log(`   ⚠️  Edge ${edge.id} (${edge.name}) is ${edge.length_km}km - may cause straight lines`);
      } else {
        console.log(`   ✅ Edge ${edge.id} (${edge.name}) is ${edge.length_km}km - reasonable`);
      }
    }

  } catch (error) {
    console.error('❌ Validation error:', error);
  } finally {
    await pool.end();
  }
}

validateRouteExport(); 