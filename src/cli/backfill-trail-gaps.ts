#!/usr/bin/env ts-node

import { Command } from 'commander';
import { Pool } from 'pg';
import { 
  backfillTrailGaps, 
  GapBackfillConfig,
  exportBackfillVisualization,
  VisualizationConfig,
  analyzeConnectivityImpact
} from '../utils/services/network-creation/trail-gap-backfill-service';
import { getDatabaseConfig } from '../utils/config-loader';

const program = new Command();

program
  .name('backfill-trail-gaps')
  .description('Identify gaps in trail network and backfill with external data from APIs')
  .option('-r, --region <region>', 'Region to process (e.g., boulder)', 'boulder')
  .option('-d, --max-gap-distance <meters>', 'Maximum gap distance to consider (meters)', '100')
  .option('-c, --confidence-threshold <score>', 'Minimum confidence score for adding trails (0-1)', '0.6')
  .option('-e, --bbox-expansion <meters>', 'Bbox expansion for API queries (meters)', '50')
  .option('--enable-overpass', 'Enable Overpass API queries', true)
  .option('--enable-other-apis', 'Enable other API integrations', false)
  .option('--dry-run', 'Identify gaps without adding trails', false)
  .option('--visualize', 'Export visualization GeoJSON with candidates', false)
  .option('--visualize-path <path>', 'Output path for visualization GeoJSON', 'backfill-visualization.geojson')
  .option('--include-existing-trails', 'Include existing trails in visualization', false)
  .option('--include-connectivity', 'Include connectivity analysis in visualization', false)
  .option('--verbose', 'Enable verbose logging', false)
  .option('--compare-overpass', 'Compare Overpass API trails with database and add missing ones', false)
  .option('--bbox <bbox>', 'Bbox coordinates (min_lng,min_lat,max_lng,max_lat)', '')
  .action(async (options) => {
    try {
      console.log('🚀 Starting trail gap backfill operation...');
      
      // Get database configuration
      const dbConfig = getDatabaseConfig();
      const pgClient = new Pool(dbConfig);
      
      try {
        await pgClient.connect();
        console.log('✅ Connected to trail_master_db');
        
                 // Get configuration
         const config: GapBackfillConfig = {
           confidenceThreshold: parseFloat(options.confidenceThreshold),
           minCandidateLengthMeters: parseInt(options.minLength),
           maxCandidateLengthMeters: parseInt(options.maxLength),
           bboxExpansionMeters: parseInt(options.bboxExpansion),
           maxGapDistanceMeters: 100, // Default value
           enableOverpass: true, // Default value
           enableOtherApis: false // Default value
         };
        
        if (options.compareOverpass) {
          // New: Compare Overpass with database
          console.log('🔍 Running Overpass comparison mode...');
          
                     // Parse bbox if provided, otherwise use default for region
           let bbox: [number, number, number, number];
           if (options.bbox) {
             const bboxParts = options.bbox.split(',').map(Number);
             bbox = [bboxParts[0], bboxParts[1], bboxParts[2], bboxParts[3]];
           } else {
             // Use full Boulder region bbox (exact coordinates provided)
             bbox = [-105.30838099532346, 39.95647909177697, -105.25907754975815, 39.998862283465];
           }
          
          if (options.dryRun) {
            console.log('🔍 DRY RUN: Would compare Overpass trails with database');
            console.log(`   Region: ${options.region}`);
            console.log(`   Bbox: ${bbox.join(',')}`);
            console.log(`   Config:`, config);
          } else {
            const { compareAndBackfillMissingTrails } = await import('../utils/services/network-creation/trail-gap-backfill-service');
            const result = await compareAndBackfillMissingTrails(
              pgClient, 
              'public', 
              bbox, 
              options.region, 
              config
            );
            
            console.log('✅ Overpass comparison completed!');
            console.log(`📊 Results:`);
            console.log(`   Total Overpass trails: ${result.summary.totalOverpassTrails}`);
            console.log(`   Existing database trails: ${result.summary.totalExistingTrails}`);
            console.log(`   Added trails: ${result.summary.addedTrailsCount}`);
            console.log(`   Coverage: ${result.summary.coveragePercentage.toFixed(1)}%`);
          }
        } else {
          // Original gap analysis mode
          console.log('🔍 Running gap analysis mode...');
          
          // Configuration for gap backfill
          const config: GapBackfillConfig = {
            maxGapDistanceMeters: parseInt(options.maxGapDistance),
            minCandidateLengthMeters: 10,
            maxCandidateLengthMeters: 5000,
            confidenceThreshold: parseFloat(options.confidenceThreshold),
            bboxExpansionMeters: parseInt(options.bboxExpansion),
            enableOverpass: options.enableOverpass,
            enableOtherApis: options.enableOtherApis
          };
          
          console.log('⚙️ Configuration:', config);
          
          // Filter trails by region if specified
          let schema = 'public';
          let regionFilter = '';
          
          if (options.region && options.region !== 'all') {
            regionFilter = `WHERE region = '${options.region}'`;
            console.log(`🗺️ Processing trails for region: ${options.region}`);
          } else {
            console.log('🗺️ Processing all trails');
          }
          
          // Create temporary view for filtered trails
          await pgClient.query(`
            DROP VIEW IF EXISTS temp_trails_for_backfill;
            CREATE TEMP VIEW temp_trails_for_backfill AS
            SELECT * FROM public.trails ${regionFilter}
          `);
          
          // Count trails being processed
          const trailCountResult = await pgClient.query(`
            SELECT COUNT(*) as count FROM temp_trails_for_backfill
          `);
          const trailCount = parseInt(trailCountResult.rows[0].count);
          console.log(`📊 Processing ${trailCount} trails`);
          
          if (options.dryRun) {
            console.log('🔍 DRY RUN MODE: Will identify gaps but not add trails');
            
            // For dry run, we'll just identify gaps without the full backfill process
            const { identifyTrailGaps } = await import('../utils/services/network-creation/trail-gap-backfill-service');
            const gaps = await identifyTrailGaps(pgClient, 'public', config, options.region);
            
            console.log(`\n📋 GAP ANALYSIS RESULTS:`);
            console.log(`   Total gaps identified: ${gaps.length}`);
            
            if (gaps.length > 0) {
              console.log(`\n🔍 Gap details:`);
              gaps.forEach((gap, index) => {
                console.log(`   ${index + 1}. ${gap.trail1_name} (${gap.trail1_endpoint}) → ${gap.trail2_name} (${gap.trail2_endpoint})`);
                console.log(`      Distance: ${gap.gap_distance_meters.toFixed(1)}m`);
                console.log(`      Confidence: ${(gap.confidence_score * 100).toFixed(1)}%`);
                console.log(`      Coordinates: [${gap.trail1_coords.join(', ')}] → [${gap.trail2_coords.join(', ')}]`);
                console.log('');
              });
              
              // Summary statistics
              const avgDistance = gaps.reduce((sum, gap) => sum + gap.gap_distance_meters, 0) / gaps.length;
              const highConfidenceGaps = gaps.filter(gap => gap.confidence_score >= config.confidenceThreshold);
              
              console.log(`📊 Summary:`);
              console.log(`   Average gap distance: ${avgDistance.toFixed(1)}m`);
              console.log(`   High confidence gaps (≥${config.confidenceThreshold * 100}%): ${highConfidenceGaps.length}/${gaps.length}`);
              console.log(`   Estimated trails that would be added: ${highConfidenceGaps.length}`);
              
              // Generate visualization if requested
              if (options.visualize) {
                console.log('\n🎨 Generating visualization...');
                const vizConfig: VisualizationConfig = {
                  exportCandidates: true,
                  outputPath: options.visualizePath,
                  includeGaps: true,
                  includeExistingTrails: options.includeExistingTrails,
                  includeConnectivityAnalysis: options.includeConnectivity
                };
                
                const vizPath = await exportBackfillVisualization(
                  pgClient, 
                  'public', 
                  gaps, 
                  config, 
                  vizConfig
                );
                
                console.log(`✅ Visualization saved to: ${vizPath}`);
                
                // Show connectivity analysis if requested
                if (options.includeConnectivity) {
                  console.log('\n🔗 Connectivity Analysis:');
                  const connectivityAnalysis = await analyzeConnectivityImpact(
                    pgClient, 
                    'public', 
                    gaps, 
                    config
                  );
                  
                  console.log(`   Current connectivity: ${connectivityAnalysis.beforeBackfill.connectivityPercentage.toFixed(1)}%`);
                  console.log(`   Projected connectivity: ${connectivityAnalysis.afterBackfill.connectivityPercentage.toFixed(1)}%`);
                  console.log(`   Improvement: +${connectivityAnalysis.improvement.percentageIncrease.toFixed(1)}%`);
                }
              }
            }
            
          } else {
            console.log('🚀 Running full backfill process...');
            
            // Run the full backfill process
            const result = await backfillTrailGaps(pgClient, 'temp_trails_for_backfill', config);
            
            console.log(`\n✅ BACKFILL COMPLETE:`);
            console.log(`   Gaps identified: ${result.gapsIdentified}`);
            console.log(`   Candidates found: ${result.candidatesFound}`);
            console.log(`   Trails added: ${result.trailsAdded}`);
            
                         if (result.details.length > 0) {
               console.log(`\n📋 Detailed results:`);
               result.details.forEach((detail: any, index: number) => {
                 const gap = detail.gap;
                 const candidate = detail.selectedCandidate;
                 
                 console.log(`   ${index + 1}. ${gap.trail1_name} → ${gap.trail2_name} (${gap.gap_distance_meters.toFixed(1)}m)`);
                 console.log(`      Candidates found: ${detail.candidates.length}`);
                 
                 if (candidate) {
                   console.log(`      ✅ Added: ${candidate.name} (${candidate.length_meters.toFixed(1)}m, ${candidate.source})`);
                 } else {
                   console.log(`      ❌ No suitable candidate found`);
                 }
                 console.log('');
               });
             }
          }
          
          // Clean up
          await pgClient.query('DROP VIEW IF EXISTS temp_trails_for_backfill');
        }
        
      } finally {
        await pgClient.end();
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program.parse();
