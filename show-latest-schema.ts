#!/usr/bin/env ts-node

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🔍 Finding Latest Carthorse Schema');
  console.log('==================================\n');

  // Database connection
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db_test',
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
  });

  try {
    // Test database connection
    console.log('🔌 Testing database connection...');
    await pgClient.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Find all carthorse schemas
    const result = await pgClient.query(`
      SELECT schema_name, 
             to_timestamp(split_part(schema_name, '_', 2)::bigint / 1000) as created_at
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 10
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No carthorse schemas found!');
      return;
    }
    
    console.log('📋 Available Carthorse Schemas:');
    console.log('================================');
    
    result.rows.forEach((row, index) => {
      const isLatest = index === 0;
      const marker = isLatest ? '🟢 LATEST' : '  ';
      console.log(`${marker} ${row.schema_name} (${row.created_at})`);
    });
    
    const latestSchema = result.rows[0].schema_name;
    console.log(`\n✅ Latest schema: ${latestSchema}`);
    
    // Check if this schema has GraphSAGE predictions
    const predictionsCheck = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'graphsage_predictions'
      )
    `, [latestSchema]);
    
    if (predictionsCheck.rows[0].exists) {
      console.log('🤖 GraphSAGE predictions: Available');
      
      // Count predictions
      const predictionCount = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${latestSchema}.graphsage_predictions
      `);
      console.log(`   • Total predictions: ${predictionCount.rows[0].count}`);
      
      // Count by prediction type
      const predictionTypes = await pgClient.query(`
        SELECT 
          prediction,
          COUNT(*) as count,
          CASE 
            WHEN prediction = 0 THEN 'Keep as-is'
            WHEN prediction = 1 THEN 'Merge degree-2'
            WHEN prediction = 2 THEN 'Split Y/T'
            ELSE 'Unknown'
          END as label
        FROM ${latestSchema}.graphsage_predictions
        GROUP BY prediction
        ORDER BY prediction
      `);
      
      console.log('   • By type:');
      predictionTypes.rows.forEach(row => {
        console.log(`     - ${row.label}: ${row.count}`);
      });
    } else {
      console.log('🤖 GraphSAGE predictions: Not available');
    }
    
    console.log('\n💡 Usage examples:');
    console.log(`   npx ts-node src/cli/show-graphsage-predictions.ts ${latestSchema}`);
    console.log(`   npx ts-node src/cli/apply-safe-cleaning.ts ${latestSchema}`);
    console.log(`   npx ts-node apply-graphsage-latest.ts`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}
