#!/usr/bin/env node
import { Command } from 'commander';
import { CPWShapefileDownloader } from '../tools/cpw-shapefile-downloader';
import { CPWGeoJSONDownloader } from '../tools/cpw-geojson-downloader';

const program = new Command();

program
  .name('download-cpw-data')
  .description('Download Colorado Parks & Wildlife trail data')
  .version('1.0.0');

program
  .command('shapefiles')
  .description('Download CPW data as shapefiles (recommended)')
  .option('-o, --output <dir>', 'Output directory', 'data/cpw-shapefiles')
  .action(async (options) => {
    console.log('🗺️ Downloading CPW shapefiles...');
    console.log(`📁 Output directory: ${options.output}`);
    
    try {
      const downloader = new CPWShapefileDownloader();
      await downloader.downloadShapefiles();
      
      console.log('\n✅ Shapefile download complete!');
      console.log('\n📋 Next steps:');
      console.log('   1. Review the downloaded shapefiles in data/cpw-shapefiles/');
      console.log('   2. Use the generated GeoJSON files for processing');
      console.log('   3. Run the trail merge service to combine with your existing data');
      
    } catch (error) {
      console.error('❌ Download failed:', error);
      process.exit(1);
    }
  });

program
  .command('geojson')
  .description('Download CPW data directly as GeoJSON')
  .option('-o, --output <dir>', 'Output directory', 'data/cpw')
  .action(async (options) => {
    console.log('🗺️ Downloading CPW GeoJSON...');
    console.log(`📁 Output directory: ${options.output}`);
    
    try {
      const downloader = new CPWGeoJSONDownloader();
      await downloader.downloadAllAsGeoJSON();
      
      console.log('\n✅ GeoJSON download complete!');
      console.log('\n📋 Next steps:');
      console.log('   1. Review the downloaded GeoJSON in data/cpw/');
      console.log('   2. Run the trail merge service to combine with your existing data');
      
    } catch (error) {
      console.error('❌ Download failed:', error);
      process.exit(1);
    }
  });

program
  .command('merge')
  .description('Merge CPW data with existing trail data')
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'carthorse_timestamp')
  .option('-t, --tolerance <meters>', 'Deduplication tolerance in meters', '50')
  .option('--strategy <strategy>', 'Merge strategy: prefer_cpw, prefer_osm, longest, highest_quality', 'prefer_cpw')
  .option('--sources <sources>', 'Comma-separated list of sources to merge (osm,cpw,cotrex)', 'osm,cpw')
  .action(async (options) => {
    console.log('🔄 Starting trail merge...');
    console.log(`📊 Staging schema: ${options.stagingSchema}`);
    console.log(`📏 Tolerance: ${options.tolerance}m`);
    console.log(`🎯 Strategy: ${options.strategy}`);
    console.log(`📥 Sources: ${options.sources}`);
    
    try {
      // Import the merge service
      const { TrailMergeService } = await import('../utils/services/network-creation/trail-merge-service');
      const { getDatabasePoolConfig } = await import('../utils/config-loader');
      
      // Setup database connection
      const poolConfig = getDatabasePoolConfig();
      const { Pool } = await import('pg');
      const pgClient = new Pool(poolConfig);
      
      // Parse sources
      const sources = options.sources.split(',').reduce((acc, source) => {
        acc[source.trim()] = true;
        return acc;
      }, {} as Record<string, boolean>);
      
      // Create merge service
      const mergeService = new TrailMergeService(pgClient);
      
      // Run merge
      const result = await mergeService.mergeTrails({
        stagingSchema: options.stagingSchema,
        mergeSources: sources,
        deduplicationTolerance: parseInt(options.tolerance),
        mergeStrategy: options.strategy as any,
        enableConflictResolution: true
      });
      
      console.log('\n✅ Trail merge complete!');
      console.log('\n📊 Results:');
      console.log(`   🛤️ Total trails: ${result.totalTrails}`);
      console.log(`   🔗 Merged trails: ${result.mergedTrails}`);
      console.log(`   🗑️ Deduplicated: ${result.deduplicatedTrails}`);
      console.log(`   ⚠️ Conflicts: ${result.conflicts}`);
      
      if (result.details.length > 0) {
        console.log('\n📋 Merge details:');
        result.details.slice(0, 10).forEach(detail => {
          console.log(`   ${detail.action}: ${detail.trailName} (${detail.reason})`);
        });
        if (result.details.length > 10) {
          console.log(`   ... and ${result.details.length - 10} more`);
        }
      }
      
      await pgClient.end();
      
    } catch (error) {
      console.error('❌ Merge failed:', error);
      process.exit(1);
    }
  });

program
  .command('full-pipeline')
  .description('Run the complete CPW data pipeline: download + merge')
  .option('-f, --format <format>', 'Download format: shapefiles or geojson', 'shapefiles')
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'carthorse_timestamp')
  .option('-t, --tolerance <meters>', 'Deduplication tolerance in meters', '50')
  .option('--strategy <strategy>', 'Merge strategy: prefer_cpw, prefer_osm, longest, highest_quality', 'prefer_cpw')
  .action(async (options) => {
    console.log('🚀 Starting full CPW data pipeline...');
    console.log(`📥 Format: ${options.format}`);
    console.log(`📊 Staging schema: ${options.stagingSchema}`);
    
    try {
      // Step 1: Download data
      console.log('\n📥 Step 1: Downloading CPW data...');
      if (options.format === 'shapefiles') {
        const downloader = new CPWShapefileDownloader();
        await downloader.downloadShapefiles();
      } else {
        const downloader = new CPWGeoJSONDownloader();
        await downloader.downloadAllAsGeoJSON();
      }
      
      // Step 2: Merge with existing data
      console.log('\n🔄 Step 2: Merging with existing trail data...');
      const { TrailMergeService } = await import('../utils/services/network-creation/trail-merge-service');
      const { getDatabasePoolConfig } = await import('../utils/config-loader');
      
      const poolConfig = getDatabasePoolConfig();
      const { Pool } = await import('pg');
      const pgClient = new Pool(poolConfig);
      
      const mergeService = new TrailMergeService(pgClient);
      const result = await mergeService.mergeTrails({
        stagingSchema: options.stagingSchema,
        mergeSources: { osm: true, cpw: true, cotrex: true },
        deduplicationTolerance: parseInt(options.tolerance),
        mergeStrategy: options.strategy as any,
        enableConflictResolution: true
      });
      
      await pgClient.end();
      
      console.log('\n✅ Full pipeline complete!');
      console.log('\n📊 Final Results:');
      console.log(`   🛤️ Total trails: ${result.totalTrails}`);
      console.log(`   🔗 Merged trails: ${result.mergedTrails}`);
      console.log(`   🗑️ Deduplicated: ${result.deduplicatedTrails}`);
      console.log(`   ⚠️ Conflicts: ${result.conflicts}`);
      
      console.log('\n📋 Next steps:');
      console.log('   1. Review the merged trails in your staging schema');
      console.log('   2. Run your export command to generate routes');
      console.log('   3. Validate the results');
      
    } catch (error) {
      console.error('❌ Pipeline failed:', error);
      process.exit(1);
    }
  });

// Show help if no command provided
if (process.argv.length === 2) {
  program.help();
}

program.parse();
