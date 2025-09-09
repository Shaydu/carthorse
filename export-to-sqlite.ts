#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { SQLiteExportStrategy, SQLiteExportConfig } from './src/utils/export/sqlite-export-strategy';
import { getDatabasePoolConfig } from './src/utils/config-loader';
import path from 'path';

async function exportToSQLite() {
  console.log('📦 Exporting latest staging data to SQLite...');
  
  // Database configuration
  const poolConfig = getDatabasePoolConfig();
  const pgClient = new Pool(poolConfig);
  
  // Latest staging schema from your recent runs
  const stagingSchema = 'carthorse_1757439503665';
  
  // Output path for SQLite database
  const outputPath = path.join(process.cwd(), 'test-output', 'boulder-latest-data.sqlite');
  
  console.log(`📊 Using staging schema: ${stagingSchema}`);
  console.log(`📁 Output SQLite database: ${outputPath}`);
  
  try {
    // Create SQLite export configuration
    const exportConfig: SQLiteExportConfig = {
      region: 'boulder',
      outputPath: outputPath,
      includeTrails: true,        // Include trail data
      includeNodes: true,         // Include routing nodes
      includeEdges: true,         // Include routing edges
      includeRecommendations: true, // Include route recommendations
      includeRouteTrails: false,  // Skip legacy route_trails table
      verbose: true
    };
    
    // Create and run SQLite export strategy
    const sqliteExporter = new SQLiteExportStrategy(pgClient, exportConfig, stagingSchema);
    
    console.log('🚀 Starting SQLite export...');
    const result = await sqliteExporter.exportFromStaging();
    
    console.log('\n✅ SQLite export completed!');
    console.log('📊 Export Results:');
    console.log(`   🛤️  Trails exported: ${result.trailsExported}`);
    console.log(`   🔗 Nodes exported: ${result.nodesExported}`);
    console.log(`   🛣️  Edges exported: ${result.edgesExported}`);
    console.log(`   🎯 Recommendations exported: ${result.recommendationsExported}`);
    console.log(`   📈 Route analysis exported: ${result.routeAnalysisExported}`);
    console.log(`   💾 Database size: ${result.dbSizeMB.toFixed(2)} MB`);
    console.log(`   ✅ Valid: ${result.isValid ? 'Yes' : 'No'}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.forEach(error => console.log(`   - ${error}`));
    }
    
    console.log(`\n📁 SQLite database saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error during SQLite export:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the export
if (require.main === module) {
  exportToSQLite()
    .then(() => {
      console.log('✅ Export completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Export failed:', error);
      process.exit(1);
    });
}

export { exportToSQLite };
