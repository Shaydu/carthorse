#!/usr/bin/env node

import { Command } from 'commander';
import { Pool } from 'pg';
import { EndpointSnappingAnalysisService } from '../services/layer1/EndpointSnappingAnalysisService';

const program = new Command();

program
  .name('analyze-endpoints')
  .description('Analyze degree 1 endpoints to find nearby trails that should be snapped')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze all degree 1 endpoints for nearby trails')
  .requiredOption('--staging-schema <schema>', 'Staging schema name')
  .option('--export <filename>', 'Export results to JSON file')
  .option('--report', 'Generate a detailed report')
  .action(async (options) => {
    try {
      console.log('🔍 Starting endpoint snapping analysis...');
      console.log(`📊 Staging schema: ${options.stagingSchema}`);

      // Create database connection
      const pgClient = new Pool({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
        database: process.env.PGDATABASE || 'trail_master_db',
        user: process.env.PGUSER || 'carthorse',
        password: process.env.PGPASSWORD || '',
      });

      const service = new EndpointSnappingAnalysisService(options.stagingSchema, pgClient);

      if (options.report) {
        await service.generateReport();
      } else {
        const analyses = await service.analyzeEndpoints();
        
        console.log(`\n📊 Found ${analyses.length} endpoints with nearby trails`);
        
        // Show top 10 most promising cases
        const promisingCases = analyses
          .filter(a => a.nearbyTrails.some(t => t.shouldSnap))
          .sort((a, b) => {
            const aMinDist = Math.min(...a.nearbyTrails.filter(t => t.shouldSnap).map(t => t.distanceMeters));
            const bMinDist = Math.min(...b.nearbyTrails.filter(t => t.shouldSnap).map(t => t.distanceMeters));
            return aMinDist - bMinDist;
          })
          .slice(0, 10);

        console.log('\n🎯 Top 10 most promising snap candidates:');
        for (const analysis of promisingCases) {
          const snapCandidates = analysis.nearbyTrails.filter(t => t.shouldSnap);
          console.log(`\nNode ${analysis.nodeId}: ${snapCandidates.length} snap candidate(s)`);
          for (const trail of snapCandidates) {
            console.log(`  → ${trail.trailName} (${trail.distanceMeters}m, ${(trail.positionAlongLine * 100).toFixed(1)}%)`);
          }
        }
      }

      if (options.export) {
        await service.exportToJson(options.export);
      }

      console.log('\n✅ Analysis completed successfully!');

    } catch (error) {
      console.error('❌ Error during analysis:', error);
      process.exit(1);
    }
  });

program.parse();
