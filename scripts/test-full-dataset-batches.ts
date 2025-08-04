#!/usr/bin/env ts-node

/**
 * Test Full Dataset Batch Processing
 * 
 * This script tests if the full dataset can be processed successfully
 * in batches of 1600 trails (our safe threshold)
 */

import { Pool } from 'pg';

async function testFullDatasetBatches() {
  console.log('🔍 Testing full dataset batch processing...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';

    console.log('📊 Step 1: Getting total trail count...');
    
    // Get total trail count
    const totalTrails = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    const totalCount = totalTrails.rows[0].count;
    console.log(`📈 Total trails: ${totalCount}`);

    // Process in batches of 1600 (our safe threshold)
    const batchSize = 1600;
    const totalBatches = Math.ceil(totalCount / batchSize);
    
    console.log(`🔄 Step 2: Processing full dataset in ${totalBatches} batches of ${batchSize}...`);
    
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < totalBatches; i++) {
      const offset = i * batchSize;
      
      console.log(`\n📦 Processing batch ${i + 1}/${totalBatches} (offset: ${offset})`);
      
      try {
        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_test`);
        
        // Create ways table with this batch
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
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
          ORDER BY app_uuid
          LIMIT ${batchSize} OFFSET ${offset}
        `);
        
        const actualCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_test`);
        console.log(`  📍 Batch has ${actualCount.rows[0].count} trails`);
        
        // Try pgr_nodeNetwork on this batch
        await pgClient.query(`SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')`);
        
        console.log(`  ✅ SUCCESS - Batch ${i + 1} processed successfully`);
        successCount++;
        
        // Export successful batch to GeoJSON for verification
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
                  'batch_number', ${i + 1},
                  'batch_size', ${actualCount.rows[0].count}
                )
              )
            )
          ) as geojson
          FROM ${stagingSchema}.ways_test
        `);
        
        const data = geoJSON.rows[0].geojson;
        const filename = `successful-batch-${i + 1}-${actualCount.rows[0].count}-trails.geojson`;
        require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
        console.log(`  📁 Exported ${filename}`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMessage.includes('GeometryCollection')) {
          console.log(`  ❌ GEOMETRYCOLLECTION ERROR - Batch ${i + 1}: ${errorMessage}`);
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
                    'batch_number', ${i + 1}
                  )
                )
              )
            ) as geojson
            FROM ${stagingSchema}.ways_test
          `);
          
          const data = geoJSON.rows[0].geojson;
          const filename = `failed-batch-${i + 1}.geojson`;
          require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
          console.log(`  📁 Exported ${filename}`);
          
        } else {
          console.log(`  ⚠️ Other error - Batch ${i + 1}: ${errorMessage}`);
          failureCount++;
        }
      }
    }

    console.log('\n📊 Full dataset batch processing results:');
    console.log(`  ✅ Successful batches: ${successCount}`);
    console.log(`  ❌ Failed batches: ${failureCount}`);
    console.log(`  📈 Success rate: ${((successCount / totalBatches) * 100).toFixed(1)}%`);
    
    if (failureCount === 0) {
      console.log('\n🎉 SUCCESS: Full dataset can be processed in batches of 1600!');
      console.log('💡 This confirms that batch processing is a viable solution.');
    } else {
      console.log('\n⚠️ Some batches failed - further investigation needed.');
    }

    console.log('✅ Full dataset batch processing complete!');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
testFullDatasetBatches()
  .then(() => {
    console.log('🎉 Full dataset batch processing completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Full dataset batch processing failed:', error);
    process.exit(1);
  }); 