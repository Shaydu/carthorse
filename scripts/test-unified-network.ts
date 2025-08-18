import { Pool } from 'pg';
import { UnifiedPgRoutingNetworkGenerator } from '../src/utils/routing/unified-pgrouting-network-generator';

async function testUnifiedNetwork() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    console.log('🧪 Testing unified pgRouting network generation...');
    
    // Get the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schemaname 
      FROM pg_tables 
      WHERE tablename = 'trails' 
      ORDER BY schemaname DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema with trails found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schemaname;
    console.log(`📋 Using staging schema: ${stagingSchema}`);
    
    // Check if we have trails data
    const trailCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    `);
    
    console.log(`📊 Found ${trailCount.rows[0].count} trails in staging schema`);
    
    if (parseInt(trailCount.rows[0].count) === 0) {
      console.error('❌ No trails found in staging schema');
      return;
    }
    
    // Create unified network generator
    const unifiedGenerator = new UnifiedPgRoutingNetworkGenerator(pgClient, {
      stagingSchema,
      tolerance: 1.0, // 1 meter tolerance
      maxEndpointDistance: 500 // 500 meters for virtual connections
    });
    
    // Generate unified network
    console.log('\n🔄 Generating unified routing network...');
    const result = await unifiedGenerator.generateUnifiedNetwork();
    
    if (result.success) {
      console.log(`✅ ${result.message}`);
      
      // Get network statistics
      const stats = await unifiedGenerator.getNetworkStats();
      console.log('\n📊 Network Statistics:');
      console.log(`  Nodes: ${stats.nodes}`);
      console.log(`  Edges: ${stats.edges}`);
      console.log(`  Isolated Nodes: ${stats.isolatedNodes}`);
      
      // Test Bear Peak loop detection
      console.log('\n🔍 Testing Bear Peak loop detection...');
      const bearPeakLoops = await unifiedGenerator.findBearPeakLoop();
      
      if (bearPeakLoops.length > 0) {
        console.log(`✅ Found ${bearPeakLoops.length} Bear Peak loops:`);
        bearPeakLoops.forEach((loop, index) => {
          console.log(`  ${index + 1}. Loop distance: ${loop.cost.toFixed(2)}km`);
        });
      } else {
        console.log('❌ No Bear Peak loops found');
      }
      
      // Check the export tables
      console.log('\n📤 Checking export tables...');
      
      const exportNodes = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.export_nodes
      `);
      
      const exportEdges = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.export_edges
      `);
      
      console.log(`  Export nodes: ${exportNodes.rows[0].count}`);
      console.log(`  Export edges: ${exportEdges.rows[0].count}`);
      
      // Check for Bear Peak related edges in export
      const bearPeakExportEdges = await pgClient.query(`
        SELECT id, source, target, trail_name, length_km
        FROM ${stagingSchema}.export_edges
        WHERE trail_name ILIKE '%bear%' 
           OR trail_name ILIKE '%fern%' 
           OR trail_name ILIKE '%mesa%'
        ORDER BY trail_name
      `);
      
      console.log(`\n📍 Bear Peak related edges in export: ${bearPeakExportEdges.rows.length}`);
      bearPeakExportEdges.rows.forEach(edge => {
        console.log(`  ${edge.id}: ${edge.trail_name} (${edge.source} → ${edge.target}, ${edge.length_km.toFixed(2)}km)`);
      });
      
    } else {
      console.error(`❌ ${result.message}`);
    }
    
  } catch (error) {
    console.error('❌ Error during unified network test:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the test
testUnifiedNetwork().catch(console.error);
