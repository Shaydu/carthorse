#!/usr/bin/env ts-node

import { Command } from 'commander';
import { Pool } from 'pg';
import { 
  queryBackfilledTrails, 
  deleteBackfilledTrails, 
  getBackfilledTrailStats 
} from '../utils/services/network-creation/trail-gap-backfill-service';
import { getDatabaseConfig } from '../utils/config-loader';

const program = new Command();

program
  .name('manage-backfilled-trails')
  .description('Query, analyze, and manage backfilled trails in the master database')
  .option('-r, --region <region>', 'Region to process (e.g., boulder)', 'boulder')
  .option('--verbose', 'Enable verbose logging', false);

const listCommand = program
  .command('list')
  .description('List backfilled trails with optional filters')
  .option('--backfill-id <id>', 'Filter by specific backfill ID')
  .option('--date-start <date>', 'Filter by start date (ISO format)')
  .option('--date-end <date>', 'Filter by end date (ISO format)')
  .option('--confidence-min <score>', 'Minimum confidence score (0-1)', '0.0')
  .option('--source <source>', 'Filter by data source (overpass, other_api)')
  .option('--limit <number>', 'Limit number of results', '50')
  .action(async (options) => {
    try {
      console.log('📋 Listing backfilled trails...');
      
      const dbConfig = getDatabaseConfig();
      const pgClient = new Pool({
        host: dbConfig.host,
        port: dbConfig.port,
        database: 'trail_master_db',
        user: dbConfig.user,
        password: dbConfig.password,
      });
      
      const queryOptions: any = {
        limit: parseInt(options.limit)
      };
      
      if (options.backfillId) {
        queryOptions.backfillId = options.backfillId;
      }
      
      if (options.dateStart || options.dateEnd) {
        queryOptions.dateRange = {
          start: options.dateStart || '1970-01-01T00:00:00Z',
          end: options.dateEnd || new Date().toISOString()
        };
      }
      
      if (options.confidenceMin) {
        queryOptions.confidenceThreshold = parseFloat(options.confidenceMin);
      }
      
      if (options.source) {
        queryOptions.source = options.source;
      }
      
      const trails = await queryBackfilledTrails(pgClient, 'public', queryOptions);
      
      console.log(`\n📊 Found ${trails.length} backfilled trails:`);
      console.log('');
      
      trails.forEach((trail, index) => {
        console.log(`${index + 1}. ${trail.name}`);
        console.log(`   ID: ${trail.id}`);
        console.log(`   Length: ${trail.length_km.toFixed(2)} km`);
        console.log(`   Backfill ID: ${trail.metadata.backfill_id}`);
        console.log(`   Source: ${trail.metadata.candidate_source}`);
        console.log(`   Confidence: ${(trail.metadata.candidate_confidence * 100).toFixed(1)}%`);
        console.log(`   Gap: ${trail.metadata.gap_trail1_name} → ${trail.metadata.gap_trail2_name} (${trail.metadata.gap_distance_meters.toFixed(1)}m)`);
        console.log(`   Added: ${new Date(trail.metadata.backfill_timestamp).toLocaleString()}`);
        console.log('');
      });
      
      await pgClient.end();
      
    } catch (error) {
      console.error('❌ Error listing backfilled trails:', error);
      process.exit(1);
    }
  });

const statsCommand = program
  .command('stats')
  .description('Show statistics about backfilled trails')
  .action(async () => {
    try {
      console.log('📊 Analyzing backfilled trail statistics...');
      
      const dbConfig = getDatabaseConfig();
      const pgClient = new Pool({
        host: dbConfig.host,
        port: dbConfig.port,
        database: 'trail_master_db',
        user: dbConfig.user,
        password: dbConfig.password,
      });
      
      const stats = await getBackfilledTrailStats(pgClient, 'public');
      
      console.log('\n📈 BACKFILLED TRAIL STATISTICS:');
      console.log('================================');
      console.log(`Total backfilled trails: ${stats.totalBackfilled}`);
      console.log(`Total length: ${stats.totalLength.toFixed(2)} km`);
      console.log(`Average length: ${stats.averageLength.toFixed(2)} km`);
      console.log('');
      
      console.log('📊 By Source:');
      Object.entries(stats.bySource).forEach(([source, count]) => {
        console.log(`   ${source}: ${count} trails`);
      });
      console.log('');
      
      console.log('📊 By Confidence:');
      console.log(`   High (≥80%): ${stats.byConfidence.high} trails`);
      console.log(`   Medium (60-80%): ${stats.byConfidence.medium} trails`);
      console.log(`   Low (<60%): ${stats.byConfidence.low} trails`);
      console.log('');
      
      await pgClient.end();
      
    } catch (error) {
      console.error('❌ Error getting statistics:', error);
      process.exit(1);
    }
  });

const deleteCommand = program
  .command('delete')
  .description('Delete backfilled trails by criteria')
  .option('--backfill-id <id>', 'Delete by specific backfill ID')
  .option('--date-start <date>', 'Delete by start date (ISO format)')
  .option('--date-end <date>', 'Delete by end date (ISO format)')
  .option('--confidence-max <score>', 'Delete trails with confidence below this score (0-1)')
  .option('--source <source>', 'Delete trails from specific source')
  .option('--dry-run', 'Show what would be deleted without actually deleting', false)
  .action(async (options) => {
    try {
      console.log('🗑️ Preparing to delete backfilled trails...');
      
      const dbConfig = getDatabaseConfig();
      const pgClient = new Pool({
        host: dbConfig.host,
        port: dbConfig.port,
        database: 'trail_master_db',
        user: dbConfig.user,
        password: dbConfig.password,
      });
      
      const criteria: any = {};
      
      if (options.backfillId) {
        criteria.backfillId = options.backfillId;
      }
      
      if (options.dateStart || options.dateEnd) {
        criteria.dateRange = {
          start: options.dateStart || '1970-01-01T00:00:00Z',
          end: options.dateEnd || new Date().toISOString()
        };
      }
      
      if (options.confidenceMax) {
        criteria.confidenceThreshold = parseFloat(options.confidenceMax);
      }
      
      if (options.source) {
        criteria.source = options.source;
      }
      
      if (options.dryRun) {
        console.log('🔍 DRY RUN: Showing what would be deleted...');
        
        // Query trails that would be deleted
        const trailsToDelete = await queryBackfilledTrails(pgClient, 'public', {
          ...criteria,
          limit: 1000 // Get all matching trails
        });
        
        console.log(`\n📋 Would delete ${trailsToDelete.length} trails:`);
        trailsToDelete.forEach((trail, index) => {
          console.log(`   ${index + 1}. ${trail.name} (${trail.metadata.candidate_source}, ${(trail.metadata.candidate_confidence * 100).toFixed(1)}%)`);
        });
        
        if (trailsToDelete.length === 0) {
          console.log('   No trails match the deletion criteria.');
        }
        
      } else {
        console.log('⚠️ WARNING: This will permanently delete trails from the database!');
        console.log('Criteria:', criteria);
        
        // Get count first
        const trailsToDelete = await queryBackfilledTrails(pgClient, 'public', {
          ...criteria,
          limit: 1000
        });
        
        console.log(`\n🗑️ About to delete ${trailsToDelete.length} trails.`);
        
        if (trailsToDelete.length > 0) {
          console.log('\nFirst few trails to be deleted:');
          trailsToDelete.slice(0, 5).forEach((trail, index) => {
            console.log(`   ${index + 1}. ${trail.name} (${trail.metadata.candidate_source})`);
          });
          
          if (trailsToDelete.length > 5) {
            console.log(`   ... and ${trailsToDelete.length - 5} more`);
          }
          
          console.log('\n❓ Are you sure? Type "DELETE" to confirm:');
          
          // Simple confirmation (in a real app, you might want more sophisticated input handling)
          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          
          rl.question('', (answer: string) => {
            rl.close();
            
            if (answer.trim() === 'DELETE') {
              deleteBackfilledTrails(pgClient, 'public', criteria)
                .then(result => {
                  console.log(`✅ Successfully deleted ${result.deletedCount} trails`);
                  pgClient.end();
                })
                .catch(error => {
                  console.error('❌ Error deleting trails:', error);
                  pgClient.end();
                  process.exit(1);
                });
            } else {
              console.log('❌ Deletion cancelled');
              pgClient.end();
            }
          });
        } else {
          console.log('No trails match the deletion criteria.');
          await pgClient.end();
        }
      }
      
    } catch (error) {
      console.error('❌ Error deleting trails:', error);
      process.exit(1);
    }
  });

program.parse();
