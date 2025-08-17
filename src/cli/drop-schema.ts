#!/usr/bin/env ts-node
/**
 * CLI command to drop a specific staging schema
 * Usage: npx ts-node src/cli/drop-schema.ts <schema-name>
 */

import { Client } from 'pg';
import { getDbConfig } from '../utils/env';
import { CleanupService } from '../services/CleanupService';

async function dropSchema(schemaName: string): Promise<void> {
  console.log(`🗑️ Dropping schema: ${schemaName}`);
  
  const dbConfig = getDbConfig();
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // First, terminate any conflicting connections
    console.log('🔌 Terminating conflicting connections...');
    const terminateResult = await client.query(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE query LIKE $1 
        AND pid != pg_backend_pid()
    `, [`%${schemaName}%`]);
    
    console.log(`✅ Terminated ${terminateResult.rows.length} conflicting connections`);
    
    // Wait a moment for connections to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if schema exists
    const schemaCheck = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = $1
    `, [schemaName]);
    
    if (schemaCheck.rows.length === 0) {
      console.log(`✅ Schema ${schemaName} does not exist`);
      return;
    }
    
    // Get table count for reporting
    const tableCount = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = $1
    `, [schemaName]);
    
    console.log(`📊 Schema contains ${tableCount.rows[0].count} tables`);
    
    // Force drop with CASCADE
    console.log(`🗑️ Force dropping schema ${schemaName} with CASCADE...`);
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    
    // Verify the drop
    const verifyResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = $1
    `, [schemaName]);
    
    if (verifyResult.rows.length === 0) {
      console.log(`✅ Successfully dropped schema: ${schemaName}`);
    } else {
      throw new Error(`Failed to drop schema ${schemaName}`);
    }
    
  } catch (error) {
    console.error(`❌ Failed to drop schema ${schemaName}:`, error);
    throw error;
  } finally {
    await client.end();
  }
}

// Main execution
if (require.main === module) {
  const schemaName = process.argv[2];
  
  if (!schemaName) {
    console.error('❌ Please provide a schema name');
    console.error('Usage: npx ts-node src/cli/drop-schema.ts <schema-name>');
    process.exit(1);
  }
  
  dropSchema(schemaName)
    .then(() => {
      console.log('✅ Schema drop completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Schema drop failed:', error);
      process.exit(1);
    });
} 