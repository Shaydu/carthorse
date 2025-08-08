#!/usr/bin/env ts-node

/**
 * Find Linear Intersection Error Threshold
 * 
 * This script tests the second batch (trails 1601-2542) in different sizes
 * to find the threshold where the linear intersection error occurs
 */

import { Pool } from 'pg';

async function findLinearIntersectionThreshold() {
  console.log('🔍 Finding linear intersection error threshold...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';

    console.log('📊 Step 1: Testing different batch sizes for second batch...');
    
    // Test different thresholds for the second batch
    const thresholds = [10, 25, 50, 100, 200, 400, 600, 800, 942];
    
    console.log('🔄 Step 2: Testing different thresholds...');
    
    let lastSuccessfulThreshold = 0;
    let firstFailureThreshold = null;
    
    for (const threshold of thresholds) {
      console.log(`🔄 Testing with ${threshold} trails from second batch...`);
      
      try {
        // Create a temporary ways table with limited trails from second batch
        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_test`);
        
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
          LIMIT ${threshold} OFFSET 1600
        `);
        
        // Check actual count
        const actualCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_test`);
        console.log(`  📍 Actually testing with ${actualCount.rows[0].count} trails`);
        
        // Try pgr_nodeNetwork
        await pgClient.query(`
          SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')
        `);
        
        console.log(`  ✅ SUCCESS with ${actualCount.rows[0].count} trails`);
        lastSuccessfulThreshold = actualCount.rows[0].count;
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMessage.includes('linear intersection')) {
          console.log(`  ❌ LINEAR INTERSECTION ERROR with ${threshold} trails: ${errorMessage}`);
          firstFailureThreshold = threshold;
          
          // Export the problematic dataset
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
                    'threshold', ${threshold}
                  )
                )
              )
            ) as geojson
            FROM ${stagingSchema}.ways_test
          `);
          
          const data = geoJSON.rows[0].geojson;
          const filename = `linear-intersection-error-threshold-${threshold}.geojson`;
          require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
          console.log(`  📁 Exported ${filename}`);
          
          break;
        } else {
          console.log(`  ⚠️ Other error with ${threshold} trails: ${errorMessage}`);
        }
      }
    }

    console.log('\n📊 Step 3: Threshold analysis results...');
    
    if (firstFailureThreshold) {
      console.log(`❌ Linear intersection error occurs between ${lastSuccessfulThreshold} and ${firstFailureThreshold} trails`);
      console.log(`✅ Last successful threshold: ${lastSuccessfulThreshold} trails`);
      console.log(`❌ First failure threshold: ${firstFailureThreshold} trails`);
      
      // Test the exact threshold with binary search
      console.log('\n🔄 Step 4: Binary search for exact threshold...');
      
      let low = lastSuccessfulThreshold;
      let high = firstFailureThreshold;
      let exactThreshold = null;
      
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        console.log(`🔄 Testing threshold: ${mid} (range: ${low}-${high})`);
        
        try {
          await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_test`);
          
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
            LIMIT ${mid} OFFSET 1600
          `);
          
          await pgClient.query(`SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')`);
          
          console.log(`  ✅ SUCCESS with ${mid} trails`);
          low = mid + 1;
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          if (errorMessage.includes('linear intersection')) {
            console.log(`  ❌ FAILURE with ${mid} trails`);
            exactThreshold = mid;
            high = mid - 1;
          } else {
            console.log(`  ⚠️ Other error with ${mid} trails: ${errorMessage}`);
            low = mid + 1;
          }
        }
      }
      
      if (exactThreshold) {
        console.log(`\n🎯 EXACT THRESHOLD: ${exactThreshold} trails`);
        console.log(`✅ ${exactThreshold - 1} trails: SUCCESS`);
        console.log(`❌ ${exactThreshold} trails: LINEAR INTERSECTION ERROR`);
      }
      
    } else {
      console.log('✅ No threshold found - all tests passed!');
    }

    console.log('✅ Linear intersection threshold analysis complete!');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
findLinearIntersectionThreshold()
  .then(() => {
    console.log('🎉 Linear intersection threshold analysis completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Linear intersection threshold analysis failed:', error);
    process.exit(1);
  }); 