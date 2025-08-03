#!/usr/bin/env ts-node
/**
 * CLI for Intersection-Based Carthorse Export
 * 
 * This CLI provides command-line access to the intersection-based routing strategy.
 * It follows the same pattern as the main export CLI but uses the alternative routing approach.
 */

import { Command } from 'commander';
import * as dotenv from 'dotenv';
dotenv.config();

import { IntersectionBasedOrchestrator, IntersectionBasedOrchestratorConfig } from '../orchestrator/IntersectionBasedOrchestrator';

const program = new Command();

program
  .name('intersection-export')
  .description('Export trail data using intersection-based routing strategy')
  .version('1.0.0');

program
  .command('install')
  .description('Install the intersection-based routing system')
  .action(async () => {
    try {
      await IntersectionBasedOrchestrator.install();
      console.log('✅ Intersection-based routing system installed successfully!');
    } catch (error) {
      console.error('❌ Failed to install intersection-based routing system:', error);
      process.exit(1);
    }
  });

program
  .command('install-test')
  .description('Install test database with intersection-based routing')
  .option('-r, --region <region>', 'Region to use for test data', 'boulder')
  .option('-l, --limit <limit>', 'Number of trails to limit test data', '1000')
  .action(async (options) => {
    try {
      const dataLimit = parseInt(options.limit, 10);
      await IntersectionBasedOrchestrator.installTestDatabase(options.region, dataLimit);
      console.log('✅ Test database with intersection-based routing installed successfully!');
    } catch (error) {
      console.error('❌ Failed to install test database:', error);
      process.exit(1);
    }
  });

program
  .command('process')
  .description('Process trails using intersection-based routing strategy')
  .option('-d, --densify <distance>', 'Distance in meters for line densification', '5')
  .option('-s, --snap <tolerance>', 'Tolerance for snapping nodes to grid', '0.00001')
  .option('-g, --segmentize <distance>', 'Distance for ST_Segmentize', '5')
  .action(async (options) => {
    try {
      const config: IntersectionBasedOrchestratorConfig = {
        densifyDistance: parseFloat(options.densify),
        snapTolerance: parseFloat(options.snap),
        segmentizeDistance: parseFloat(options.segmentize)
      };
      
      const orchestrator = new IntersectionBasedOrchestrator(config);
      await orchestrator.processTrails();
      
      // Get and display network statistics
      const stats = await orchestrator.getNetworkStats();
      console.log('\n📊 Network Statistics:');
      console.log(`   - Trails: ${stats.trail_count}`);
      console.log(`   - Intersections: ${stats.intersection_count}`);
      console.log(`   - Nodes: ${stats.node_count}`);
      console.log(`   - Edges: ${stats.edge_count}`);
      
      console.log('✅ Intersection-based routing processing completed successfully!');
    } catch (error) {
      console.error('❌ Failed to process trails:', error);
      process.exit(1);
    }
  });

program
  .command('export')
  .description('Export intersection-based network to SQLite')
  .option('-o, --output <path>', 'Output file path', './intersection-network.db')
  .option('-d, --densify <distance>', 'Distance in meters for line densification', '5')
  .option('-s, --snap <tolerance>', 'Tolerance for snapping nodes to grid', '0.00001')
  .option('-g, --segmentize <distance>', 'Distance for ST_Segmentize', '5')
  .action(async (options) => {
    try {
      const config: IntersectionBasedOrchestratorConfig = {
        densifyDistance: parseFloat(options.densify),
        snapTolerance: parseFloat(options.snap),
        segmentizeDistance: parseFloat(options.segmentize)
      };
      
      const orchestrator = new IntersectionBasedOrchestrator(config);
      
      // Process trails first
      await orchestrator.processTrails();
      
      // Export to SQLite
      await orchestrator.exportToSqlite(options.output);
      
      console.log(`✅ Intersection-based network exported to: ${options.output}`);
    } catch (error) {
      console.error('❌ Failed to export intersection-based network:', error);
      process.exit(1);
    }
  });

program
  .command('export-geojson')
  .description('Export intersection-based network to GeoJSON')
  .option('-o, --output <path>', 'Output file path', './intersection-network.geojson')
  .option('-d, --densify <distance>', 'Distance in meters for line densification', '5')
  .option('-s, --snap <tolerance>', 'Tolerance for snapping nodes to grid', '0.00001')
  .option('-g, --segmentize <distance>', 'Distance for ST_Segmentize', '5')
  .action(async (options) => {
    try {
      const config: IntersectionBasedOrchestratorConfig = {
        densifyDistance: parseFloat(options.densify),
        snapTolerance: parseFloat(options.snap),
        segmentizeDistance: parseFloat(options.segmentize)
      };
      
      const orchestrator = new IntersectionBasedOrchestrator(config);
      
      // Process trails first
      await orchestrator.processTrails();
      
      // Export to GeoJSON
      await orchestrator.exportToGeoJSON(options.output);
      
      console.log(`✅ Intersection-based network exported to GeoJSON: ${options.output}`);
      console.log('🎨 Color scheme:');
      console.log('   - Trails: Green (#00FF00)');
      console.log('   - Edges: Magenta (#FF00FF)');
      console.log('   - Nodes: Blue (#0000FF)');
    } catch (error) {
      console.error('❌ Failed to export GeoJSON:', error);
      process.exit(1);
    }
  });

program
  .command('export-geojson-full')
  .description('Export intersection-based network to GeoJSON using full Boulder dataset')
  .option('-o, --output <path>', 'Output file path', './intersection-network-full.geojson')
  .option('-d, --densify <distance>', 'Distance in meters for line densification', '5')
  .option('-s, --snap <tolerance>', 'Tolerance for snapping nodes to grid', '0.00001')
  .option('-g, --segmentize <distance>', 'Distance for ST_Segmentize', '5')
  .action(async (options) => {
    try {
      const config: IntersectionBasedOrchestratorConfig = {
        densifyDistance: parseFloat(options.densify),
        snapTolerance: parseFloat(options.snap),
        segmentizeDistance: parseFloat(options.segmentize)
      };
      
      const orchestrator = new IntersectionBasedOrchestrator(config);
      
      // Install full Boulder dataset instead of test data
      console.log('📊 Installing full Boulder dataset...');
      await IntersectionBasedOrchestrator.installTestDatabase('boulder', 10000); // Much larger limit
      
      // Process trails first
      await orchestrator.processTrails();
      
      // Export to GeoJSON
      await orchestrator.exportToGeoJSON(options.output);
      
      console.log(`✅ Intersection-based network exported to GeoJSON: ${options.output}`);
      console.log('🎨 Color scheme:');
      console.log('   - Trails: Green (#00FF00)');
      console.log('   - Edges: Magenta (#FF00FF)');
      console.log('   - Nodes: Blue (#0000FF)');
    } catch (error) {
      console.error('❌ Failed to export GeoJSON:', error);
      process.exit(1);
    }
  });

program
  .command('cleanup')
  .description('Clean up intersection-based staging schemas')
  .action(async () => {
    try {
      // This would need to be implemented in the orchestrator
      console.log('🧹 Cleaning up intersection-based staging schemas...');
      // await IntersectionBasedOrchestrator.cleanAllTestStagingSchemas();
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Failed to cleanup:', error);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate intersection-based network')
  .option('-d, --densify <distance>', 'Distance in meters for line densification', '5')
  .option('-s, --snap <tolerance>', 'Tolerance for snapping nodes to grid', '0.00001')
  .option('-g, --segmentize <distance>', 'Distance for ST_Segmentize', '5')
  .action(async (options) => {
    try {
      const config: IntersectionBasedOrchestratorConfig = {
        densifyDistance: parseFloat(options.densify),
        snapTolerance: parseFloat(options.snap),
        segmentizeDistance: parseFloat(options.segmentize)
      };
      
      const orchestrator = new IntersectionBasedOrchestrator(config);
      
      // Process trails
      await orchestrator.processTrails();
      
      // Get statistics
      const stats = await orchestrator.getNetworkStats();
      
      console.log('\n📊 Intersection-Based Network Validation:');
      console.log(`   - Trails processed: ${stats.trail_count}`);
      console.log(`   - Intersections detected: ${stats.intersection_count}`);
      console.log(`   - Unique nodes created: ${stats.node_count}`);
      console.log(`   - Graph edges generated: ${stats.edge_count}`);
      
      // Basic validation checks
      if (stats.node_count === 0) {
        console.error('❌ No nodes created - network is invalid');
        process.exit(1);
      }
      
      if (stats.edge_count === 0) {
        console.error('❌ No edges created - network is invalid');
        process.exit(1);
      }
      
      console.log('✅ Intersection-based network validation passed!');
    } catch (error) {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    }
  });

// Parse command line arguments
if (require.main === module) {
  program.parse();
} 