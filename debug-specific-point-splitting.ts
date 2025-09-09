#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { PointSnapAndSplitService, PointToSnapAndSplit } from './src/services/layer1/PointSnapAndSplitService';

async function debugSpecificPointSplitting() {
  console.log('🔍 Debugging specific point splitting case...');
  
  // Database connection
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
  });

  try {
    // Get the latest staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      throw new Error('No staging schema found');
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);
    
    // The specific point that's not splitting
    const problemPoint: PointToSnapAndSplit = {
      lng: -105.263325,
      lat: 39.94533,
      elevation: 0,
      description: "Problem point that should split LineString"
    };
    
    console.log(`📍 Problem point: (${problemPoint.lng}, ${problemPoint.lat}, ${problemPoint.elevation})`);
    
    // First, let's check what trails exist near this point
    const nearbyTrailsQuery = `
      WITH target_point AS (
        SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326) as point_geom
      )
      SELECT 
        id,
        app_uuid,
        name,
        trail_type,
        ST_AsText(geometry) as geom_text,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
        ST_Distance(geometry, tp.point_geom) * 111320 as distance_meters,
        ST_ClosestPoint(geometry, tp.point_geom) as closest_point,
        ST_Distance(ST_StartPoint(geometry), tp.point_geom) * 111320 as distance_to_start,
        ST_Distance(ST_EndPoint(geometry), tp.point_geom) * 111320 as distance_to_end
      FROM ${stagingSchema}.trails, target_point tp
      WHERE ST_IsValid(geometry)
        AND ST_GeometryType(geometry) = 'ST_LineString'
        AND ST_DWithin(geometry, tp.point_geom, 0.001) -- Within ~100m
      ORDER BY distance_meters
      LIMIT 5;
    `;
    
    const nearbyTrailsResult = await pgClient.query(nearbyTrailsQuery, [problemPoint.lng, problemPoint.lat]);
    
    console.log(`\n🛤️  Found ${nearbyTrailsResult.rows.length} nearby trails:`);
    nearbyTrailsResult.rows.forEach((trail, index) => {
      console.log(`   ${index + 1}. "${trail.name || 'Unnamed'}" (ID: ${trail.id})`);
      console.log(`      Distance: ${trail.distance_meters.toFixed(3)}m`);
      console.log(`      Distance to start: ${trail.distance_to_start.toFixed(3)}m`);
      console.log(`      Distance to end: ${trail.distance_to_end.toFixed(3)}m`);
      console.log(`      Trail type: ${trail.trail_type || 'N/A'}`);
    });
    
    // Now let's test the PointSnapAndSplitService with different tolerances
    console.log(`\n🧪 Testing PointSnapAndSplitService with different tolerances...`);
    
    const tolerances = [1, 2, 5, 10, 20]; // meters
    
    for (const tolerance of tolerances) {
      console.log(`\n   Testing with ${tolerance}m tolerance:`);
      
      const service = new PointSnapAndSplitService({
        stagingSchema,
        pgClient,
        snapToleranceMeters: tolerance,
        verbose: true
      });
      
      service.addPoint(problemPoint);
      const result = await service.execute();
      
      console.log(`      Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      if (!result.success && result.error) {
        console.log(`      Error: ${result.error}`);
      }
      console.log(`      Points processed: ${result.pointsProcessed}`);
      console.log(`      Trails split: ${result.trailsSplit}`);
      console.log(`      Intersections created: ${result.intersectionsCreated}`);
    }
    
    // Let's also check if there are any existing routing nodes near this point
    console.log(`\n📍 Checking existing routing nodes near the point...`);
    
    const existingNodesQuery = `
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326),
          ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)
        ) * 111320 as distance_meters
      FROM ${stagingSchema}.routing_nodes
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326),
        ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326),
        0.001  -- Within ~100m
      )
      ORDER BY distance_meters
      LIMIT 5;
    `;
    
    const existingNodesResult = await pgClient.query(existingNodesQuery, [problemPoint.lng, problemPoint.lat]);
    
    console.log(`   Found ${existingNodesResult.rows.length} existing nodes:`);
    existingNodesResult.rows.forEach((node, index) => {
      console.log(`   ${index + 1}. Node ${node.id} (${node.node_uuid})`);
      console.log(`      Position: (${node.lng}, ${node.lat}, ${node.elevation})`);
      console.log(`      Distance: ${node.distance_meters.toFixed(3)}m`);
      console.log(`      Type: ${node.node_type}, Connected trails: ${node.connected_trails}`);
    });
    
    // Let's also check if there are any GraphSAGE predictions for nodes near this point
    console.log(`\n🤖 Checking GraphSAGE predictions near the point...`);
    
    const predictionsQuery = `
      SELECT 
        p.node_id,
        p.prediction,
        p.confidence,
        rn.lat,
        rn.lng,
        rn.node_type,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(rn.lng::float8, rn.lat::float8), 4326),
          ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)
        ) * 111320 as distance_meters
      FROM ${stagingSchema}.graphsage_predictions p
      JOIN ${stagingSchema}.routing_nodes rn ON p.node_id = rn.id
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(rn.lng::float8, rn.lat::float8), 4326),
        ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326),
        0.001  -- Within ~100m
      )
      ORDER BY distance_meters
      LIMIT 5;
    `;
    
    const predictionsResult = await pgClient.query(predictionsQuery, [problemPoint.lng, problemPoint.lat]);
    
    console.log(`   Found ${predictionsResult.rows.length} predictions:`);
    predictionsResult.rows.forEach((pred, index) => {
      const label = pred.prediction === 0 ? 'Keep as-is' : 
                   pred.prediction === 1 ? 'Merge degree-2' : 
                   pred.prediction === 2 ? 'Split Y/T' : 'Unknown';
      console.log(`   ${index + 1}. Node ${pred.node_id}: ${label} (confidence: ${pred.confidence})`);
      console.log(`      Position: (${pred.lng}, ${pred.lat})`);
      console.log(`      Distance: ${pred.distance_meters.toFixed(3)}m`);
    });
    
  } catch (error) {
    console.error('❌ Error debugging point splitting:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the function
if (require.main === module) {
  debugSpecificPointSplitting()
    .then(() => {
      console.log('\n🎉 Point splitting debug complete!');
    })
    .catch(error => {
      console.error('❌ Failed to debug point splitting:', error);
      process.exit(1);
    });
}

export { debugSpecificPointSplitting };
