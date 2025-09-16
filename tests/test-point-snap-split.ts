#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';
import { PointSnapAndSplitService } from '../src/services/layer1/PointSnapAndSplitService';

async function testPointSnapAndSplit() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node test-point-snap-split.ts <schema>');
    process.exit(1);
  }

  console.log(`🧪 Testing Point Snap and Split Service for schema: ${schema}`);

  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);

  try {
    console.log('✅ Connected to database');

    // Create the service
    const service = new PointSnapAndSplitService({
      stagingSchema: schema,
      pgClient: pool,
      snapToleranceMeters: 10.0, // 10 meter tolerance
      verbose: true
    });

    // Add your specific point
    service.addPoint({
      lng: -105.295095,
      lat: 39.990015,
      elevation: 2176.841796875,
      description: 'Y intersection point to snap and split',
      preferredTrailName: '1st/2nd Flatiron'
    });

    console.log('\n🎯 Running Point Snap and Split Service...');
    
    // Execute the service
    const result = await service.execute();

    console.log('\n📊 Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Points processed: ${result.pointsProcessed}`);
    console.log(`   Trails split: ${result.trailsSplit}`);
    console.log(`   Intersections created: ${result.intersectionsCreated}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }

    // Verify the results by checking the database
    console.log('\n🔍 Verifying results in database...');
    
    // Check for updated predictions
    const predictionsQuery = `
      SELECT 
        gp.node_id,
        gp.prediction,
        gp.confidence,
        rn.lat,
        rn.lng,
        rn.elevation,
        rn.node_type,
        rn.connected_trails
      FROM ${schema}.graphsage_predictions gp
      JOIN ${schema}.routing_nodes rn ON gp.node_id = rn.id
      WHERE gp.confidence = 1.0
      ORDER BY gp.node_id;
    `;

    const predictionsResult = await pool.query(predictionsQuery);
    console.log(`\n📈 Expert corrections (confidence = 1.0): ${predictionsResult.rows.length} nodes`);
    
    predictionsResult.rows.forEach((row, index) => {
      const labelText = row.prediction === 0 ? 'Keep as-is' : 
                       row.prediction === 1 ? 'Merge degree-2' : 
                       row.prediction === 2 ? 'Split Y/T' : 'Unknown';
      console.log(`   ${index + 1}. Node ${row.node_id}: ${labelText} at ${row.lng}, ${row.lat}, ${row.elevation} (type: ${row.node_type}, trails: ${row.connected_trails})`);
    });

    // Check for degree-3 intersections
    const degree3Query = `
      SELECT 
        id,
        node_uuid,
        lat,
        lng,
        elevation,
        node_type,
        connected_trails
      FROM ${schema}.routing_nodes 
      WHERE node_type = 'degree3_intersection'
      ORDER BY id;
    `;

    const degree3Result = await pool.query(degree3Query);
    console.log(`\n🔗 Degree-3 intersections: ${degree3Result.rows.length} nodes`);
    
    degree3Result.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Node ${row.id}: ${row.lng}, ${row.lat}, ${row.elevation} (trails: ${row.connected_trails})`);
    });

    // Check trail count
    const trailCountQuery = `SELECT COUNT(*) as count FROM ${schema}.trails;`;
    const trailCountResult = await pool.query(trailCountQuery);
    console.log(`\n🛤️  Total trails in database: ${trailCountResult.rows[0].count}`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

testPointSnapAndSplit().catch(console.error);
