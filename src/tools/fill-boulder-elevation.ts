#!/usr/bin/env ts-node
/**
 * Simple script to fill elevation data in the master database
 * No staging, no validation, just fill the elevation data
 */

import { AtomicTrailInserter } from './carthorse-postgres-atomic-insert';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main(): Promise<void> {
  console.log('🚀 Filling Boulder elevation data in master database');
  console.log('=' .repeat(50));
  
  const inserter = new AtomicTrailInserter('trail_master_db');
  
  try {
    await inserter.connect();
    console.log('✅ Connected to PostgreSQL master database');
    
    // Load TIFF metadata (this will show which TIFF files are available)
    await inserter.loadTiffMetadata();
    
    // Get trails that need elevation data
    const trailsWithoutElevation = await inserter.getTrailsWithoutElevation('boulder');
    console.log(`📊 Found ${trailsWithoutElevation.length} trails without elevation data`);
    
    if (trailsWithoutElevation.length === 0) {
      console.log('✅ All trails already have elevation data!');
      return;
    }
    
    // Process trails in batches to avoid memory issues
    const batchSize = 100;
    let processed = 0;
    let updated = 0;
    let failed = 0;
    
    for (let i = 0; i < trailsWithoutElevation.length; i += batchSize) {
      const batch = trailsWithoutElevation.slice(i, i + batchSize);
      console.log(`\n🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(trailsWithoutElevation.length / batchSize)} (${batch.length} trails)`);
      
      for (const trail of batch) {
        try {
          const success = await inserter.updateTrailElevation(trail.id);
          if (success) {
            updated++;
          } else {
            failed++;
          }
          processed++;
          
          if (processed % 10 === 0) {
            console.log(`   Progress: ${processed}/${trailsWithoutElevation.length} (${updated} updated, ${failed} failed)`);
          }
        } catch (error) {
          console.error(`❌ Failed to update trail ${trail.id}: ${error}`);
          failed++;
          processed++;
        }
      }
    }
    
    console.log('\n📊 Final Results:');
    console.log(`   - Total processed: ${processed}`);
    console.log(`   - Successfully updated: ${updated}`);
    console.log(`   - Failed: ${failed}`);
    console.log(`   - Success rate: ${((updated / processed) * 100).toFixed(1)}%`);
    
    // CRITICAL: If any trails failed, throw an error
    if (failed > 0) {
      throw new Error(`Elevation processing failed for ${failed} trails. Process cannot complete.`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await inserter.disconnect();
  }
}

if (require.main === module) {
  main().catch(console.error);
} 