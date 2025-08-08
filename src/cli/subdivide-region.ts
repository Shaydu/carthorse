#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { createBboxSubdivider } from '../utils/bbox-subdivision';
import { createGeometryPreprocessor } from '../utils/sql/geometry-preprocessing';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: npx ts-node src/cli/subdivide-region.ts <region> [maxTrailsPerChunk] [minChunkSize]');
    process.exit(1);
  }

  const region = args[0];
  const maxTrailsPerChunk = args[1] ? parseInt(args[1]) : 500; // Smaller chunks for testing
  const minChunkSize = args[2] ? parseInt(args[2]) : 50;

  console.log(`🔧 Testing subdivision for region: ${region}`);
  console.log(`📊 Max trails per chunk: ${maxTrailsPerChunk}`);
  console.log(`📊 Min trails per chunk: ${minChunkSize}`);

  // Connect to database
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
  });

  try {
    const subdivider = createBboxSubdivider(pool);
    const geometryPreprocessor = createGeometryPreprocessor(pool);

    // Step 1: Subdivide the region
    console.log('\n🗺️ Step 1: Subdividing region...');
    const subdivisions = await subdivider.subdivideRegion({
      region,
      maxTrailsPerChunk,
      minChunkSize,
      overlapPercentage: 0.1
    });

    if (subdivisions.length === 0) {
      console.log('❌ No subdivisions created');
      return;
    }

    console.log(`\n✅ Created ${subdivisions.length} subdivisions`);

    // Step 2: Process each subdivision
    console.log('\n🔧 Step 2: Processing subdivisions...');
    const results = [];

    for (const subdivision of subdivisions) {
      const stagingSchema = `staging_${subdivision.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      console.log(`\n📦 Processing subdivision: ${subdivision.name}`);
      
      // Process the subdivision
      const processResult = await subdivider.processSubdivision(subdivision, stagingSchema, region);
      
      if (processResult.success && processResult.trailCount > 0) {
        console.log(`🔧 Running geometry preprocessing on ${processResult.trailCount} trails...`);
        
        try {
          const preprocessResult = await geometryPreprocessor.preprocessTrailGeometries({
            schemaName: stagingSchema,
            tableName: 'trails',
            region: subdivision.name,
            maxPasses: 3, // Fewer passes for testing
            minLengthMeters: 1.0,
            tolerance: 0.00001
          });

          if (preprocessResult.success) {
            console.log(`✅ Subdivision ${subdivision.name}: Preprocessing successful`);
            console.log(`   - Initial: ${preprocessResult.initialCount} trails`);
            console.log(`   - Final: ${preprocessResult.finalCount} trails`);
            console.log(`   - Dropped: ${preprocessResult.droppedCount} trails`);
            console.log(`   - Passes: ${preprocessResult.passes}`);
          } else {
            console.log(`❌ Subdivision ${subdivision.name}: Preprocessing failed`);
            console.log(`   - Errors: ${preprocessResult.errors.join(', ')}`);
          }

          results.push({
            subdivision: subdivision.name,
            success: preprocessResult.success,
            initialCount: preprocessResult.initialCount,
            finalCount: preprocessResult.finalCount,
            droppedCount: preprocessResult.droppedCount,
            errors: preprocessResult.errors
          });

        } catch (error) {
          console.error(`❌ Error preprocessing subdivision ${subdivision.name}:`, error);
          results.push({
            subdivision: subdivision.name,
            success: false,
            initialCount: processResult.trailCount,
            finalCount: 0,
            droppedCount: processResult.trailCount,
            errors: [error instanceof Error ? error.message : String(error)]
          });
        }
      } else {
        console.log(`⚠️ Subdivision ${subdivision.name}: No trails or processing failed`);
        results.push({
          subdivision: subdivision.name,
          success: false,
          initialCount: 0,
          finalCount: 0,
          droppedCount: 0,
          errors: processResult.errors
        });
      }
    }

    // Step 3: Summary
    console.log('\n📊 Step 3: Processing Summary');
    console.log('='.repeat(50));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successful subdivisions: ${successful.length}/${results.length}`);
    console.log(`❌ Failed subdivisions: ${failed.length}/${results.length}`);
    
    if (successful.length > 0) {
      const totalInitial = successful.reduce((sum, r) => sum + r.initialCount, 0);
      const totalFinal = successful.reduce((sum, r) => sum + r.finalCount, 0);
      const totalDropped = successful.reduce((sum, r) => sum + r.droppedCount, 0);
      
      console.log(`📊 Total trails processed: ${totalInitial}`);
      console.log(`📊 Total trails after preprocessing: ${totalFinal}`);
      console.log(`📊 Total trails dropped: ${totalDropped}`);
      console.log(`📊 Drop rate: ${((totalDropped / totalInitial) * 100).toFixed(1)}%`);
    }

    if (failed.length > 0) {
      console.log('\n❌ Failed subdivisions:');
      failed.forEach(r => {
        console.log(`   - ${r.subdivision}: ${r.errors.join(', ')}`);
      });
    }

    // Step 4: Cleanup
    console.log('\n🧹 Step 4: Cleaning up...');
    await subdivider.cleanupSubdivisions(subdivisions);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(console.error);
} 