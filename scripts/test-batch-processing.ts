#!/usr/bin/env ts-node

/**
 * Test Batch Processing of Problematic Dataset
 * 
 * This script tests if the same 1700 trails that cause the GeometryCollection error
 * can be processed successfully in smaller batches
 */

import { Pool } from 'pg';

async function testBatchProcessing() {
  console.log('🔍 Testing batch processing of problematic dataset...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';

    console.log('📊 Step 1: Getting the problematic 1700 trails...');
    
    // Get the first 1700 trails (the ones that cause the error)
    const problematicTrails = await pgClient.query(`
      SELECT app_uuid, name, ST_NumPoints(geometry) as num_points, 
             ST_IsSimple(geometry) as is_simple, ST_GeometryType(geometry) as geom_type
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ORDER BY app_uuid
      LIMIT 1700
    `);
    
    console.log(`📈 Got ${problematicTrails.rows.length} problematic trails`);
    
    // Test different batch sizes
    const batchSizes = [100, 200, 400, 800, 1600];
    
    console.log('🔄 Step 2: Testing different batch sizes...');
    
    for (const batchSize of batchSizes) {
      console.log(`\n🔄 Testing batch size: ${batchSize}`);
      
      let successCount = 0;
      let failureCount = 0;
      const totalBatches = Math.ceil(problematicTrails.rows.length / batchSize);
      
      for (let i = 0; i < totalBatches; i++) {
        const startIndex = i * batchSize;
        const endIndex = Math.min(startIndex + batchSize, problematicTrails.rows.length);
        const batchTrails = problematicTrails.rows.slice(startIndex, endIndex);
        
        console.log(`  📦 Processing batch ${i + 1}/${totalBatches} (trails ${startIndex + 1}-${endIndex})`);
        
        try {
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_test`);
          
          // Create ways table with this batch
          const trailUuids = batchTrails.map(t => `'${t.app_uuid}'`).join(',');
          
          await pgClient.query(`
            CREATE TABLE ${stagingSchema}.ways_test AS
            SELECT 
              ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
              app_uuid as trail_uuid,
              name,
              CASE 
                WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
                ELSE ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
              END as the_geom
            FROM ${stagingSchema}.trails
            WHERE app_uuid IN (${trailUuids})
          `);
          
          const actualCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_test`);
          console.log(`    📍 Batch has ${actualCount.rows[0].count} trails`);
          
          // Try pgr_nodeNetwork on this batch
          await pgClient.query(`SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')`);
          
          console.log(`    ✅ SUCCESS - Batch ${i + 1} processed successfully`);
          successCount++;
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          if (errorMessage.includes('GeometryCollection')) {
            console.log(`    ❌ GEOMETRYCOLLECTION ERROR - Batch ${i + 1}: ${errorMessage}`);
            failureCount++;
            
            // Export the problematic batch
            const geoJSON = await pgClient.query(`
              SELECT json_build_object(
                'type', 'FeatureCollection',
                'features', json_agg(
                  json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(the_geom)::json,
                    'properties', json_build_object(
                      'id', trail_uuid,
                      'name', name,
                      'batch_size', ${batchSize},
                      'batch_number', ${i + 1}
                    )
                  )
                )
              ) as geojson
              FROM ${stagingSchema}.ways_test
            `);
            
            const data = geoJSON.rows[0].geojson;
            const filename = `geometrycollection-error-batch-${batchSize}-${i + 1}.geojson`;
            require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
            console.log(`    📁 Exported ${filename}`);
            
          } else {
            console.log(`    ⚠️ Other error - Batch ${i + 1}: ${errorMessage}`);
            failureCount++;
          }
        }
      }
      
      console.log(`\n📊 Batch size ${batchSize} results:`);
      console.log(`  ✅ Successful batches: ${successCount}`);
      console.log(`  ❌ Failed batches: ${failureCount}`);
      console.log(`  📈 Success rate: ${((successCount / totalBatches) * 100).toFixed(1)}%`);
    }

    console.log('\n✅ Batch processing analysis complete!');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
testBatchProcessing()
  .then(() => {
    console.log('🎉 Batch processing analysis completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Batch processing analysis failed:', error);
    process.exit(1);
  }); 