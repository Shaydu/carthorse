#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { Command } from 'commander';
import { loadConfig } from '../utils/config-loader';
import { Degree2MergerService } from '../services/standalone/Degree2MergerService';

const program = new Command();

program
  .name('test-degree2-merger')
  .description('Test degree-2 intersection merging to reduce network complexity')
  .version('1.0.0');

program
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'carthorse_latest')
  .option('--analyze-only', 'Only analyze network, do not merge')
  .option('--preserve-trail-names', 'Preserve original trail names in merged segments')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      console.log('🔄 [DEGREE2-MERGER] Starting degree-2 merger test...');
      console.log(`📊 [DEGREE2-MERGER] Options:`, options);

      // Load configuration
      const config = loadConfig();

      // Create database connection
      const pgClient = new Pool({
        host: config.database.connection.host,
        port: config.database.connection.port,
        database: config.database.connection.database,
        user: config.database.connection.user,
        password: config.database.connection.password,
        max: 1
      });

      // Test connection
      await pgClient.query('SELECT 1');
      console.log('✅ [DEGREE2-MERGER] Database connection established');

      // Check if staging schema exists
      const schemaExists = await pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.schemata 
          WHERE schema_name = $1
        )
      `, [options.stagingSchema]);

      if (!schemaExists.rows[0].exists) {
        throw new Error(`Staging schema '${options.stagingSchema}' does not exist`);
      }

      // Create service
      const mergerService = new Degree2MergerService(pgClient, {
        stagingSchema: options.stagingSchema,
        preserveTrailNames: options.preserveTrailNames
      });

      // Analyze network before merging
      console.log('\n📊 [DEGREE2-MERGER] Analyzing network before merging...');
      const beforeAnalysis = await mergerService.analyzeNetwork();
      
      console.log(`📈 [DEGREE2-MERGER] Network analysis:`);
      console.log(`   🔗 Total edges: ${beforeAnalysis.totalEdges}`);
      console.log(`   🔵 Total vertices: ${beforeAnalysis.totalVertices}`);
      console.log(`   📊 Degree distribution:`);
      
      Object.entries(beforeAnalysis.degreeDistribution).forEach(([degree, count]) => {
        const percentage = ((count / beforeAnalysis.totalVertices) * 100).toFixed(1);
        console.log(`     Degree ${degree}: ${count} vertices (${percentage}%)`);
      });

      if (options.analyzeOnly) {
        console.log('✅ [DEGREE2-MERGER] Analysis complete (no merging performed)');
        await pgClient.end();
        return;
      }

      // Perform merging
      console.log('\n🔄 [DEGREE2-MERGER] Starting degree-2 merging...');
      const mergeResult = await mergerService.mergeDegree2Intersections();

      // Analyze network after merging
      console.log('\n📊 [DEGREE2-MERGER] Analyzing network after merging...');
      const afterAnalysis = await mergerService.analyzeNetwork();
      
      console.log(`📈 [DEGREE2-MERGER] Post-merge analysis:`);
      console.log(`   🔗 Total edges: ${afterAnalysis.totalEdges}`);
      console.log(`   🔵 Total vertices: ${afterAnalysis.totalVertices}`);
      console.log(`   📊 Degree distribution:`);
      
      Object.entries(afterAnalysis.degreeDistribution).forEach(([degree, count]) => {
        const percentage = ((count / afterAnalysis.totalVertices) * 100).toFixed(1);
        console.log(`     Degree ${degree}: ${count} vertices (${percentage}%)`);
      });

      // Calculate improvements
      const edgeReduction = beforeAnalysis.totalEdges - afterAnalysis.totalEdges;
      const vertexReduction = beforeAnalysis.totalVertices - afterAnalysis.totalVertices;
      const edgeReductionPercent = ((edgeReduction / beforeAnalysis.totalEdges) * 100).toFixed(1);
      const vertexReductionPercent = ((vertexReduction / beforeAnalysis.totalVertices) * 100).toFixed(1);

      console.log(`\n🎉 [DEGREE2-MERGER] Merging completed successfully!`);
      console.log(`📊 [DEGREE2-MERGER] Improvements:`);
      console.log(`   🔗 Edges reduced: ${edgeReduction} (${edgeReductionPercent}%)`);
      console.log(`   🔵 Vertices reduced: ${vertexReduction} (${vertexReductionPercent}%)`);
      console.log(`   🧮 Merged segments: ${mergeResult.mergedSegments}`);
      console.log(`   🗑️ Deleted vertices: ${mergeResult.deletedVertices}`);

      // Estimate memory savings for Hawick circuits
      const complexityReduction = (vertexReduction / beforeAnalysis.totalVertices) * 100;
      console.log(`\n💾 [DEGREE2-MERGER] Estimated memory savings for Hawick circuits:`);
      console.log(`   📉 Network complexity reduced by: ${complexityReduction.toFixed(1)}%`);
      console.log(`   🚀 Expected performance improvement: ${(complexityReduction * 2).toFixed(1)}%`);

      await pgClient.end();
      console.log('✅ [DEGREE2-MERGER] Database connection closed');

    } catch (error) {
      console.error('❌ [DEGREE2-MERGER] Error:', error);
      process.exit(1);
    }
  });

program.parse();
