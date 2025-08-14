import { Pool } from 'pg';
import { config } from 'dotenv';
import { EdgeCompositionTracking } from '../src/utils/services/network-creation/edge-composition-tracking';

config();

async function fixCompositionTracking() {
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
    console.log('🔧 Fixing Edge Trail Composition Tracking...');

    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema found.');
      return;
    }

    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);

    const compositionTracking = new EdgeCompositionTracking(stagingSchema, pgClient);

    // Fix 1: Add composition for edges with old_id that maps to split_trails_noded
    console.log('\n🔧 Fix 1: Adding composition for edges with old_id mapping...');
    const oldIdFixResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.edge_trail_composition (
        edge_id, split_trail_id, original_trail_uuid, trail_name,
        segment_start_distance, segment_end_distance, segment_sequence,
        segment_percentage, composition_type
      )
      SELECT 
        wn.id as edge_id,
        stn.id as split_trail_id,
        stn.app_uuid as original_trail_uuid,
        stn.name as trail_name,
        0.0 as segment_start_distance,
        stn.length_km as segment_end_distance,
        1 as segment_sequence,
        100.0 as segment_percentage,
        'direct' as composition_type
      FROM ${stagingSchema}.ways_noded wn
      JOIN ${stagingSchema}.split_trails_noded stn ON wn.old_id = stn.old_id
      LEFT JOIN ${stagingSchema}.edge_trail_composition etc ON wn.id = etc.edge_id
      WHERE etc.edge_id IS NULL
        AND wn.old_id IS NOT NULL
      ON CONFLICT (edge_id, split_trail_id) DO NOTHING
    `);
    console.log(`✅ Added composition for ${oldIdFixResult.rowCount} edges with old_id mapping`);

    // Fix 2: Add composition for connector-bridged edges
    console.log('\n🔧 Fix 2: Adding composition for connector-bridged edges...');
    const connectorFixResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.edge_trail_composition (
        edge_id, split_trail_id, original_trail_uuid, trail_name,
        segment_start_distance, segment_end_distance, segment_sequence,
        segment_percentage, composition_type
      )
      SELECT 
        wn.id as edge_id,
        wn.id as split_trail_id,  -- Use edge_id as split_trail_id for connectors
        'connector-' || wn.id as original_trail_uuid,
        wn.name as trail_name,
        0.0 as segment_start_distance,
        wn.length_km as segment_end_distance,
        1 as segment_sequence,
        100.0 as segment_percentage,
        'connector' as composition_type
      FROM ${stagingSchema}.ways_noded wn
      LEFT JOIN ${stagingSchema}.edge_trail_composition etc ON wn.id = etc.edge_id
      WHERE etc.edge_id IS NULL
        AND wn.app_uuid = 'connector-bridged'
      ON CONFLICT (edge_id, split_trail_id) DO NOTHING
    `);
    console.log(`✅ Added composition for ${connectorFixResult.rowCount} connector-bridged edges`);

    // Fix 3: Add composition for merged degree-2 chains
    console.log('\n🔧 Fix 3: Adding composition for merged degree-2 chains...');
    const mergedEdges = await pgClient.query(`
      SELECT id, app_uuid, name
      FROM ${stagingSchema}.ways_noded wn
      LEFT JOIN ${stagingSchema}.edge_trail_composition etc ON wn.id = etc.edge_id
      WHERE etc.edge_id IS NULL
        AND wn.app_uuid LIKE 'merged-degree2-chain-%'
      ORDER BY wn.id
    `);

    console.log(`📋 Found ${mergedEdges.rows.length} merged edges without composition data`);
    
    for (const mergedEdge of mergedEdges.rows) {
      console.log(`   🔗 Processing merged edge ${mergedEdge.id}: ${mergedEdge.name}`);
      
      // Extract edge count from app_uuid (format: 'merged-degree2-chain-{s}-{t}-{count}edges')
      const edgeCountMatch = mergedEdge.app_uuid.match(/merged-degree2-chain-\d+-\d+-(\d+)edges/);
      if (edgeCountMatch) {
        const edgeCount = parseInt(edgeCountMatch[1]);
        console.log(`      Expected ${edgeCount} constituent edges`);
        
        // For now, add a placeholder composition entry
        await pgClient.query(`
          INSERT INTO ${stagingSchema}.edge_trail_composition (
            edge_id, split_trail_id, original_trail_uuid, trail_name,
            segment_start_distance, segment_end_distance, segment_sequence,
            segment_percentage, composition_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (edge_id, split_trail_id) DO NOTHING
        `, [
          mergedEdge.id,
          mergedEdge.id,  // Use edge_id as split_trail_id for merged edges
          'merged-' + mergedEdge.id,
          mergedEdge.name,
          0.0,
          mergedEdge.length_km || 0.0,
          1,
          100.0,
          'merged'
        ]);
      }
    }

    // Fix 4: Add composition for edges with no app_uuid (likely original connectors)
    console.log('\n🔧 Fix 4: Adding composition for edges with no app_uuid...');
    const noUuidFixResult = await pgClient.query(`
      INSERT INTO ${stagingSchema}.edge_trail_composition (
        edge_id, split_trail_id, original_trail_uuid, trail_name,
        segment_start_distance, segment_end_distance, segment_sequence,
        segment_percentage, composition_type
      )
      SELECT 
        wn.id as edge_id,
        wn.id as split_trail_id,
        'original-' || wn.id as original_trail_uuid,
        COALESCE(wn.name, 'Unnamed Trail') as trail_name,
        0.0 as segment_start_distance,
        wn.length_km as segment_end_distance,
        1 as segment_sequence,
        100.0 as segment_percentage,
        'direct' as composition_type
      FROM ${stagingSchema}.ways_noded wn
      LEFT JOIN ${stagingSchema}.edge_trail_composition etc ON wn.id = etc.edge_id
      WHERE etc.edge_id IS NULL
        AND (wn.app_uuid IS NULL OR wn.app_uuid = '')
      ON CONFLICT (edge_id, split_trail_id) DO NOTHING
    `);
    console.log(`✅ Added composition for ${noUuidFixResult.rowCount} edges with no app_uuid`);

    // Final validation
    console.log('\n🔍 Final validation...');
    const validation = await compositionTracking.validateComposition();
    if (validation.valid) {
      console.log('✅ All edges now have composition data!');
    } else {
      console.log('⚠️ Remaining composition issues:');
      validation.issues.forEach(issue => console.log(`   - ${issue}`));
    }

    // Show final composition summary
    const finalCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.edge_trail_composition
    `);
    console.log(`📊 Final composition records: ${finalCount.rows[0].count}`);

    console.log('\n✅ Composition tracking fix completed!');

  } catch (error) {
    console.error('❌ Error fixing composition tracking:', error);
  } finally {
    await pgClient.end();
  }
}

fixCompositionTracking().catch(console.error);
