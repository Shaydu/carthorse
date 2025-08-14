import { Pool } from 'pg';
import { config } from 'dotenv';
import { EdgeCompositionTracking } from '../src/utils/services/network-creation/edge-composition-tracking';

config();

async function testCompositionTracking() {
  const pgClient = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'trail_master_db',
    user: process.env.DB_USER || 'carthorse',
    password: process.env.DB_PASSWORD,
    statement_timeout: 30000,
    query_timeout: 30000
  });

  try {
    console.log('🧪 Testing Edge Trail Composition Tracking...');

    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema found. Run the export first.');
      return;
    }

    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);

    const compositionTracking = new EdgeCompositionTracking(stagingSchema, pgClient);

    // Test 1: Check if composition table exists and has data
    console.log('\n🔍 Test 1: Checking composition table...');
    const tableExists = await pgClient.query(`
      SELECT EXISTS(
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'edge_trail_composition'
      )
    `, [stagingSchema]);

    if (!tableExists.rows[0].exists) {
      console.log('❌ Composition table does not exist. Creating it...');
      await compositionTracking.createCompositionTable();
      await compositionTracking.initializeCompositionFromSplitTrails();
    }

    // Test 2: Check composition data
    console.log('\n🔍 Test 2: Checking composition data...');
    const compositionCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.edge_trail_composition
    `);
    console.log(`📊 Found ${compositionCount.rows[0].count} composition records`);

    // Test 3: Show sample composition data
    console.log('\n🔍 Test 3: Sample composition data...');
    const sampleComposition = await pgClient.query(`
      SELECT 
        etc.edge_id,
        etc.original_trail_uuid,
        etc.trail_name,
        etc.segment_percentage,
        etc.composition_type,
        wn.app_uuid as edge_app_uuid,
        wn.name as edge_name
      FROM ${stagingSchema}.edge_trail_composition etc
      JOIN ${stagingSchema}.ways_noded wn ON etc.edge_id = wn.id
      ORDER BY etc.edge_id, etc.segment_sequence
      LIMIT 10
    `);

    console.log('📋 Sample composition records:');
    sampleComposition.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Edge ${row.edge_id} (${row.edge_name}) contains ${row.trail_name} (${row.segment_percentage}%) [${row.composition_type}]`);
    });

    // Test 4: Check for merged edges
    console.log('\n🔍 Test 4: Checking for merged edges...');
    const mergedEdges = await pgClient.query(`
      SELECT 
        wn.id,
        wn.app_uuid,
        wn.name,
        COUNT(etc.split_trail_id) as trail_segments
      FROM ${stagingSchema}.ways_noded wn
      LEFT JOIN ${stagingSchema}.edge_trail_composition etc ON wn.id = etc.edge_id
      WHERE wn.app_uuid LIKE 'merged-degree2-chain-%'
      GROUP BY wn.id, wn.app_uuid, wn.name
      ORDER BY trail_segments DESC
      LIMIT 5
    `);

    console.log('🔗 Merged edges:');
    mergedEdges.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Edge ${row.id} (${row.name}) contains ${row.trail_segments} trail segments`);
    });

    // Test 5: Validate composition integrity
    console.log('\n🔍 Test 5: Validating composition integrity...');
    const validation = await compositionTracking.validateComposition();
    if (validation.valid) {
      console.log('✅ Composition data integrity validated');
    } else {
      console.log('⚠️ Composition validation issues:');
      validation.issues.forEach(issue => console.log(`   - ${issue}`));
    }

    // Test 6: Show route composition example
    console.log('\n🔍 Test 6: Route composition example...');
    const sampleEdgeIds = await pgClient.query(`
      SELECT id FROM ${stagingSchema}.ways_noded 
      WHERE app_uuid IS NOT NULL 
      ORDER BY id 
      LIMIT 3
    `);

    if (sampleEdgeIds.rows.length > 0) {
      const edgeIds = sampleEdgeIds.rows.map(row => row.id);
      console.log(`📋 Route composition for edges [${edgeIds.join(', ')}]:`);
      
      const routeComposition = await compositionTracking.getRouteComposition(edgeIds);
      routeComposition.forEach((trail, index) => {
        console.log(`   ${index + 1}. ${trail.trail_name} (${trail.total_percentage.toFixed(1)}% of route, ${trail.segment_count} segments)`);
      });
    }

    console.log('\n✅ Composition tracking test completed!');

  } catch (error) {
    console.error('❌ Error testing composition tracking:', error);
  } finally {
    await pgClient.end();
  }
}

testCompositionTracking().catch(console.error);
