#!/usr/bin/env ts-node

/**
 * Find Linear Intersection Error Trail
 * 
 * This script tests each trail individually in the second batch (trails 1601-2542)
 * to find which specific trail(s) cause the "Splitter line has linear intersection with input" error
 */

import { Pool } from 'pg';

async function findLinearIntersectionTrail() {
  console.log('🔍 Finding linear intersection error trail...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';

    console.log('📊 Step 1: Getting trails 1601-2542 (second batch)...');
    
    // Get trails from the second batch (offset 1600)
    const secondBatchTrails = await pgClient.query(`
      SELECT app_uuid, name, ST_NumPoints(geometry) as num_points, 
             ST_IsSimple(geometry) as is_simple, ST_GeometryType(geometry) as geom_type
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ORDER BY app_uuid
      LIMIT 942 OFFSET 1600
    `);
    
    console.log(`📈 Testing ${secondBatchTrails.rows.length} trails from second batch...`);

    console.log('🔄 Step 2: Testing each trail individually...');
    
    let linearIntersectionErrors: any[] = [];
    let otherErrors: any[] = [];
    let successCount = 0;
    
    for (let i = 0; i < secondBatchTrails.rows.length; i++) {
      const trail = secondBatchTrails.rows[i];
      
      if (i % 50 === 0) {
        console.log(`Progress: ${i}/${secondBatchTrails.rows.length} trails tested`);
      }
      
      try {
        // Create a temporary ways table with just this trail
        await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_test`);
        
        await pgClient.query(`
          CREATE TABLE ${stagingSchema}.ways_test AS
          SELECT 
            1 as id,
            $1 as trail_uuid,
            $2 as name,
            CASE 
              WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
              ELSE ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001))
            END as the_geom
          FROM ${stagingSchema}.trails
          WHERE app_uuid = $1
        `, [trail.app_uuid, trail.name]);
        
        // Try pgr_nodeNetwork on this single trail
        await pgClient.query(`
          SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')
        `);
        
        // If we get here, this trail is OK
        successCount++;
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMessage.includes('linear intersection')) {
          console.log(`❌ Trail ${trail.name} (${trail.app_uuid}) - LINEAR INTERSECTION ERROR: ${errorMessage}`);
          
          linearIntersectionErrors.push({
            app_uuid: trail.app_uuid,
            name: trail.name,
            num_points: trail.num_points,
            is_simple: trail.is_simple,
            geom_type: trail.geom_type,
            error: errorMessage
          });
          
          // Export the problematic trail to GeoJSON for inspection
          const geoJSON = await pgClient.query(`
            SELECT json_build_object(
              'type', 'FeatureCollection',
              'features', json_agg(
                json_build_object(
                  'type', 'Feature',
                  'geometry', ST_AsGeoJSON(geometry)::json,
                  'properties', json_build_object(
                    'id', app_uuid,
                    'name', name,
                    'num_points', ST_NumPoints(geometry),
                    'is_simple', ST_IsSimple(geometry),
                    'geom_type', ST_GeometryType(geometry),
                    'error', 'linear_intersection_error'
                  )
                )
              )
            ) as geojson
            FROM ${stagingSchema}.trails
            WHERE app_uuid = $1
          `, [trail.app_uuid]);
          
          const data = geoJSON.rows[0].geojson;
          const filename = `linear-intersection-error-trail-${trail.name.replace(/[^a-zA-Z0-9]/g, '-')}.geojson`;
          require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
          console.log(`  📁 Exported ${filename}`);
          
        } else {
          console.log(`⚠️ Trail ${trail.name} (${trail.app_uuid}) - Other error: ${errorMessage}`);
          otherErrors.push({
            app_uuid: trail.app_uuid,
            name: trail.name,
            error: errorMessage
          });
        }
      }
    }

    console.log('\n📊 Step 3: Summary of linear intersection errors...');
    
    if (linearIntersectionErrors.length > 0) {
      console.log(`❌ Found ${linearIntersectionErrors.length} trails with linear intersection errors:`);
      console.table(linearIntersectionErrors);
      
      // Create a summary GeoJSON of all problematic trails
      const summaryGeoJSON = {
        type: 'FeatureCollection',
        features: linearIntersectionErrors.map(trail => ({
          type: 'Feature',
          geometry: null, // We'll add this later
          properties: {
            id: trail.app_uuid,
            name: trail.name,
            num_points: trail.num_points,
            is_simple: trail.is_simple,
            geom_type: trail.geom_type,
            error: 'linear_intersection_error'
          }
        }))
      };
      
      require('fs').writeFileSync('linear-intersection-error-summary.json', JSON.stringify(summaryGeoJSON, null, 2));
      console.log('✅ Exported linear-intersection-error-summary.json');
      
    } else {
      console.log('✅ No individual trails cause linear intersection errors!');
      console.log('🔍 This suggests the error occurs when multiple trails interact...');
    }
    
    if (otherErrors.length > 0) {
      console.log(`⚠️ Found ${otherErrors.length} trails with other errors:`);
      console.table(otherErrors);
    }
    
    console.log(`\n📈 Overall results:`);
    console.log(`  ✅ Successful trails: ${successCount}`);
    console.log(`  ❌ Linear intersection errors: ${linearIntersectionErrors.length}`);
    console.log(`  ⚠️ Other errors: ${otherErrors.length}`);
    console.log(`  📊 Success rate: ${((successCount / secondBatchTrails.rows.length) * 100).toFixed(1)}%`);

    console.log('✅ Linear intersection error analysis complete!');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
findLinearIntersectionTrail()
  .then(() => {
    console.log('🎉 Linear intersection error analysis completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Linear intersection error analysis failed:', error);
    process.exit(1);
  }); 