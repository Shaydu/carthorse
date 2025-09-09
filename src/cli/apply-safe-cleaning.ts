import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';
import { NetworkCleaningService } from '../services/graphsage/NetworkCleaningService';

async function applySafeCleaning() {
  console.log('🛡️  Safe Network Cleaning CLI');
  
  const sourceSchema = process.argv[2];
  if (!sourceSchema) {
    console.error('❌ Please provide a source schema name as argument');
    console.log('Usage: npx ts-node src/cli/apply-safe-cleaning.ts <source_schema>');
    process.exit(1);
  }

  const targetSchema = `${sourceSchema}_cleaned`;
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Check if predictions exist
    const predictionsExistQuery = `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'graphsage_predictions'
      )
    `;
    
    const predictionsExist = await pgClient.query(predictionsExistQuery, [sourceSchema]);
    
    if (!predictionsExist.rows[0].exists) {
      console.log(`❌ No GraphSAGE predictions found in schema ${sourceSchema}`);
      console.log('   Run the training script first:');
      console.log(`   python scripts/graphsage/train_graphsage_direct.py ${sourceSchema} --user carthorse`);
      return;
    }

    console.log(`\n🛡️  Creating safe cleaned schema: ${targetSchema}`);
    console.log(`   Original schema ${sourceSchema} will remain untouched`);

    // Create new schema
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${targetSchema}`);
    
    // Copy original tables to new schema
    console.log('📋 Copying original data...');
    
    await pgClient.query(`
      CREATE TABLE ${targetSchema}.ways_noded_vertices_pgr AS 
      SELECT * FROM ${sourceSchema}.ways_noded_vertices_pgr
    `);
    
    await pgClient.query(`
      CREATE TABLE ${targetSchema}.ways_noded AS 
      SELECT * FROM ${sourceSchema}.ways_noded
    `);
    
    await pgClient.query(`
      CREATE TABLE ${targetSchema}.graphsage_predictions AS 
      SELECT * FROM ${sourceSchema}.graphsage_predictions
    `);
    
    console.log(`✅ Created cleaned schema: ${targetSchema}`);
    console.log(`   • Copied ${sourceSchema}.ways_noded_vertices_pgr`);
    console.log(`   • Copied ${sourceSchema}.ways_noded`);
    console.log(`   • Copied ${sourceSchema}.graphsage_predictions`);

    // Now apply cleaning to the new schema
    console.log(`\n🔧 Applying GraphSAGE-based cleaning to ${targetSchema}...`);
    
    const cleaningService = new NetworkCleaningService(pgClient, {
      stagingSchema: targetSchema,
      confidence_threshold: 0.5, // Lower threshold to catch more predictions
      dry_run: false // Actually apply the changes
    });

    const result = await cleaningService.applyNetworkCleaning();
    
    // Validate the cleaned network
    console.log(`\n🔍 Validating cleaned network...`);
    await cleaningService.validateNetwork();

    console.log(`\n🎉 Safe cleaning complete!`);
    console.log(`📊 Cleaning Summary:`);
    console.log(`   • Nodes processed: ${result.nodes_processed}`);
    console.log(`   • Nodes merged: ${result.nodes_merged}`);
    console.log(`   • Nodes split: ${result.nodes_split}`);
    console.log(`   • Edges created: ${result.edges_created}`);
    console.log(`   • Edges removed: ${result.edges_removed}`);
    
    console.log(`\n📁 Results:`);
    console.log(`   • Original schema: ${sourceSchema} (unchanged)`);
    console.log(`   • Cleaned schema: ${targetSchema} (modified)`);
    
    console.log(`\n🔧 Next steps:`);
    console.log(`   1. Compare original vs cleaned:`);
    console.log(`      npx ts-node src/cli/show-graphsage-predictions.ts ${sourceSchema}`);
    console.log(`      npx ts-node src/cli/show-graphsage-predictions.ts ${targetSchema}`);
    console.log(`   2. Export cleaned network:`);
    console.log(`      npx ts-node src/cli/export.ts --schema ${targetSchema} --format geojson`);
    console.log(`   3. If satisfied, you can drop the original schema:`);
    console.log(`      DROP SCHEMA ${sourceSchema} CASCADE;`);

  } catch (error) {
    console.error('❌ Error applying safe cleaning:', error);
  } finally {
    await pgClient.end();
  }
}

applySafeCleaning().catch(console.error);
