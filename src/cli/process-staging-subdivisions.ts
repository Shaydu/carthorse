#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { createBboxSubdivider } from '../utils/bbox-subdivision';
import { createGeometryPreprocessor } from '../utils/sql/geometry-preprocessing';
import { createPgRoutingHelpers } from '../utils/pgrouting-helpers';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: npx ts-node src/cli/process-staging-subdivisions.ts <sourceStagingSchema> <region> [maxTrailsPerChunk] [minChunkSize]');
    process.exit(1);
  }

  const sourceStagingSchema = args[0];
  const region = args[1];
  const maxTrailsPerChunk = args[2] ? parseInt(args[2]) : 300; // Smaller chunks for testing
  const minChunkSize = args[3] ? parseInt(args[3]) : 50;

  console.log(`🔧 Processing staging subdivisions for region: ${region}`);
  console.log(`📦 Source staging schema: ${sourceStagingSchema}`);
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

    // Step 1: Check if source staging schema exists and has data
    console.log('\n🔍 Step 1: Checking source staging data...');
    const stagingCheck = await pool.query(`
      SELECT COUNT(*) as count FROM ${sourceStagingSchema}.trails
    `);
    
    const trailCount = parseInt(stagingCheck.rows[0].count);
    if (trailCount === 0) {
      throw new Error(`No trails found in staging schema '${sourceStagingSchema}'`);
    }
    
    console.log(`✅ Found ${trailCount} trails in ${sourceStagingSchema}`);

    // Step 2: Subdivide the staging data
    console.log('\n🗺️ Step 2: Subdividing staging data...');
    const subdivisions = await subdivider.subdivideStagingData(
      sourceStagingSchema,
      maxTrailsPerChunk,
      minChunkSize
    );

    if (subdivisions.length === 0) {
      console.log('❌ No subdivisions created');
      return;
    }

    console.log(`\n✅ Created ${subdivisions.length} subdivisions`);

    // Step 3: Process each subdivision
    console.log('\n🔧 Step 3: Processing subdivisions...');
    const results = [];

    for (const subdivision of subdivisions) {
      const targetStagingSchema = `staging_${subdivision.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      console.log(`\n📦 Processing subdivision: ${subdivision.name}`);
      
      // Process the subdivision
      const processResult = await subdivider.processStagingSubdivision(
        subdivision, 
        sourceStagingSchema, 
        targetStagingSchema
      );
      
      if (processResult.success && processResult.trailCount > 0) {
        console.log(`🔧 Running geometry preprocessing on ${processResult.trailCount} trails...`);
        
        try {
          const preprocessResult = await geometryPreprocessor.preprocessTrailGeometries({
            schemaName: targetStagingSchema,
            tableName: 'trails',
            region: subdivision.name,
            maxPasses: 3, // Fewer passes for testing
            tolerance: 0.00001
          });

          if (preprocessResult.success) {
            console.log(`✅ Subdivision ${subdivision.name}: Preprocessing successful`);
            console.log(`   - Initial: ${preprocessResult.initialCount} trails`);
            console.log(`   - Final: ${preprocessResult.finalCount} trails`);
            console.log(`   - Dropped: ${preprocessResult.droppedCount} trails`);
            console.log(`   - Passes: ${preprocessResult.passes}`);

            // Step 4: Generate routing network and recommendations
            if (preprocessResult.finalCount > 0) {
              console.log(`🔧 Generating routing network for ${preprocessResult.finalCount} trails...`);
              
              try {
                const pgRoutingHelpers = createPgRoutingHelpers(pool, targetStagingSchema);
                await pgRoutingHelpers.createPgRoutingViews();
                
                console.log(`✅ Subdivision ${subdivision.name}: Routing network created successfully`);
                
                // Generate some test recommendations
                console.log(`🔧 Generating test recommendations...`);
                const recommendations = await pool.query(`
                  SELECT 
                    '${subdivision.name}' as subdivision,
                    COUNT(*) as trail_count,
                    COUNT(DISTINCT ST_GeometryType(geometry)) as geometry_types
                  FROM ${targetStagingSchema}.trails
                `);
                
                console.log(`✅ Subdivision ${subdivision.name}: Recommendations summary`);
                console.log(`   - Trail count: ${recommendations.rows[0].trail_count}`);
                console.log(`   - Geometry types: ${recommendations.rows[0].geometry_types}`);

                results.push({
                  subdivision: subdivision.name,
                  success: true,
                  initialCount: preprocessResult.initialCount,
                  finalCount: preprocessResult.finalCount,
                  droppedCount: preprocessResult.droppedCount,
                  routingSuccess: true,
                  recommendations: recommendations.rows[0]
                });

              } catch (routingError) {
                console.error(`❌ Error creating routing network for subdivision ${subdivision.name}:`, routingError);
                results.push({
                  subdivision: subdivision.name,
                  success: true,
                  initialCount: preprocessResult.initialCount,
                  finalCount: preprocessResult.finalCount,
                  droppedCount: preprocessResult.droppedCount,
                  routingSuccess: false,
                  routingError: routingError instanceof Error ? routingError.message : String(routingError)
                });
              }

            } else {
              console.log(`⚠️ Subdivision ${subdivision.name}: No trails remaining after preprocessing`);
              results.push({
                subdivision: subdivision.name,
                success: true,
                initialCount: preprocessResult.initialCount,
                finalCount: 0,
                droppedCount: preprocessResult.droppedCount,
                routingSuccess: false,
                routingError: 'No trails remaining after preprocessing'
              });
            }

          } else {
            console.log(`❌ Subdivision ${subdivision.name}: Preprocessing failed`);
            console.log(`   - Errors: ${preprocessResult.errors.join(', ')}`);
            results.push({
              subdivision: subdivision.name,
              success: false,
              initialCount: preprocessResult.initialCount,
              finalCount: 0,
              droppedCount: preprocessResult.droppedCount,
              routingSuccess: false,
              errors: preprocessResult.errors
            });
          }

        } catch (error) {
          console.error(`❌ Error preprocessing subdivision ${subdivision.name}:`, error);
          results.push({
            subdivision: subdivision.name,
            success: false,
            initialCount: processResult.trailCount,
            finalCount: 0,
            droppedCount: processResult.trailCount,
            routingSuccess: false,
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
          routingSuccess: false,
          errors: processResult.errors
        });
      }
    }

    // Step 5: Summary
    console.log('\n📊 Step 5: Processing Summary');
    console.log('='.repeat(50));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const routingSuccessful = results.filter(r => r.routingSuccess);
    
    console.log(`✅ Successful subdivisions: ${successful.length}/${results.length}`);
    console.log(`❌ Failed subdivisions: ${failed.length}/${results.length}`);
    console.log(`🔧 Successful routing: ${routingSuccessful.length}/${results.length}`);
    
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
        console.log(`   - ${r.subdivision}: ${r.errors?.join(', ') || 'Unknown error'}`);
      });
    }

    // Step 6: Cleanup
    console.log('\n🧹 Step 6: Cleaning up subdivision staging schemas...');
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