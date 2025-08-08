#!/usr/bin/env ts-node

/**
 * Test Exact GeometryCollection Threshold
 * 
 * This script tests the exact threshold between 1500 and 2000 trails
 */

import { Pool } from 'pg';

async function testExactThreshold() {
  console.log('🔍 Testing exact GeometryCollection threshold...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';

    // Test specific thresholds between 1500 and 2000
    const thresholds = [1600, 1700, 1800, 1900, 1950, 1975, 1987, 1993, 1996, 1998, 1999];
    
    console.log('🔄 Testing specific thresholds...');
    
    for (const threshold of thresholds) {
      console.log(`🔄 Testing with ${threshold} trails...`);
      
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
          LIMIT $1
        `, [threshold]);
        
        const actualCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_test`);
        console.log(`  📍 Actually testing with ${actualCount.rows[0].count} trails`);
        
        await pgClient.query(`SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')`);
        
        console.log(`  ✅ SUCCESS with ${actualCount.rows[0].count} trails`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMessage.includes('GeometryCollection')) {
          console.log(`  ❌ GEOMETRYCOLLECTION ERROR with ${threshold} trails: ${errorMessage}`);
          
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
          const filename = `geometrycollection-error-exact-${threshold}.geojson`;
          require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
          console.log(`  📁 Exported ${filename}`);
          
          break;
        } else {
          console.log(`  ⚠️ Other error with ${threshold} trails: ${errorMessage}`);
        }
      }
    }

    console.log('✅ Exact threshold testing complete!');

  } catch (error) {
    console.error('❌ Testing failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
testExactThreshold()
  .then(() => {
    console.log('🎉 Exact threshold testing completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Exact threshold testing failed:', error);
    process.exit(1);
  }); 