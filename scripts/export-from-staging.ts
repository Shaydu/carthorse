#!/usr/bin/env node
/**
 * Export from existing staging schema to SQLite
 * 
 * This script allows you to export data from an existing staging schema
 * to SQLite format without re-processing the data.
 */

import { Pool } from 'pg';
import { SQLiteExportStrategy, SQLiteExportConfig } from '../src/utils/export/sqlite-export-strategy';
import { getDatabasePoolConfig } from '../src/utils/config-loader';
import * as path from 'path';

async function exportFromStaging() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const stagingSchema = args.find(arg => arg.startsWith('--staging-schema='))?.split('=')[1];
  const region = args.find(arg => arg.startsWith('--region='))?.split('=')[1] || 'boulder';
  const outputPath = args.find(arg => arg.startsWith('--out='))?.split('=')[1];
  const verbose = args.includes('--verbose');
  
  if (!stagingSchema) {
    console.error('❌ Error: --staging-schema=<schema_name> is required');
    console.error('Usage: npx ts-node scripts/export-from-staging.ts --staging-schema=<schema> --region=<region> --out=<path> [--verbose]');
    process.exit(1);
  }
  
  if (!outputPath) {
    console.error('❌ Error: --out=<output_path> is required');
    console.error('Usage: npx ts-node scripts/export-from-staging.ts --staging-schema=<schema> --region=<region> --out=<path> [--verbose]');
    process.exit(1);
  }
  
  console.log(`📦 Exporting from staging schema: ${stagingSchema}`);
  console.log(`🗺️  Region: ${region}`);
  console.log(`📁 Output: ${outputPath}`);
  
  // Get database configuration
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);
  
  try {
    // Verify staging schema exists
    const schemaCheck = await pgClient.query(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
      [stagingSchema]
    );
    
    if (schemaCheck.rows.length === 0) {
      console.error(`❌ Error: Staging schema '${stagingSchema}' does not exist`);
      process.exit(1);
    }
    
    console.log(`✅ Staging schema '${stagingSchema}' found`);
    
    // Check what tables exist in the staging schema
    const tableCheck = await pgClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 
      ORDER BY table_name
    `, [stagingSchema]);
    
    console.log(`📊 Tables in ${stagingSchema}:`, tableCheck.rows.map(r => r.table_name));
    
    // Configure SQLite export
    const sqliteConfig: SQLiteExportConfig = {
      region,
      outputPath: path.resolve(outputPath),
      includeTrails: true,
      includeNodes: true,
      includeEdges: true,
      includeRecommendations: true,
      verbose
    };
    
    // Create SQLite export strategy
    const sqliteExporter = new SQLiteExportStrategy(pgClient, sqliteConfig, stagingSchema);
    
    // Export from staging
    console.log('🚀 Starting export...');
    const result = await sqliteExporter.exportFromStaging();
    
    if (!result.isValid) {
      console.error('❌ Export failed:', result.errors.join(', '));
      process.exit(1);
    }
    
    console.log('✅ Export completed successfully!');
    console.log(`   - Trails: ${result.trailsExported}`);
    console.log(`   - Nodes: ${result.nodesExported}`);
    console.log(`   - Edges: ${result.edgesExported}`);
    console.log(`   - Recommendations: ${result.recommendationsExported || 0}`);
    console.log(`   - Database size: ${result.dbSizeMB.toFixed(2)} MB`);
    console.log(`   - Output file: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Run the export
exportFromStaging().catch(console.error);
