#!/usr/bin/env ts-node

/**
 * Find GeometryCollection Error Trail
 * 
 * This script specifically looks for the "Splitting a Line by a GeometryCollection is unsupported" error
 * by testing different combinations of trails to isolate the problematic combination
 */

import { Pool } from 'pg';

async function findGeometryCollectionError() {
  console.log('🔍 Finding GeometryCollection error trail...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';

    console.log('📊 Step 1: Getting all trail IDs...');
    
    // Get all trail IDs
    const trails = await pgClient.query(`
      SELECT app_uuid, name, ST_NumPoints(geometry) as num_points, 
             ST_IsSimple(geometry) as is_simple, ST_GeometryType(geometry) as geom_type
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ORDER BY ST_NumPoints(geometry) DESC
    `);
    
    console.log(`📈 Testing ${trails.rows.length} trails for GeometryCollection error...`);

    console.log('🔄 Step 2: Testing each trail individually for GeometryCollection error...');
    
    let geometryCollectionErrors: any[] = [];
    
    for (let i = 0; i < trails.rows.length; i++) {
      const trail = trails.rows[i];
      
      if (i % 100 === 0) {
        console.log(`Progress: ${i}/${trails.rows.length} trails tested`);
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
        console.log(`✅ Trail ${trail.name} (${trail.app_uuid}) - OK`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Only log if it's specifically a GeometryCollection error
        if (errorMessage.includes('GeometryCollection')) {
          console.log(`❌ Trail ${trail.name} (${trail.app_uuid}) - GEOMETRYCOLLECTION ERROR: ${errorMessage}`);
          
          geometryCollectionErrors.push({
            app_uuid: trail.app_uuid,
            name: trail.name,
            num_points: trail.num_points,
            is_simple: trail.is_simple,
            geom_type: trail.geom_type,
            error: errorMessage
          });
        } else {
          console.log(`⚠️ Trail ${trail.name} (${trail.app_uuid}) - Other error: ${errorMessage}`);
        }
      }
    }

    console.log('\n📊 Step 3: Summary of GeometryCollection errors...');
    
    if (geometryCollectionErrors.length > 0) {
      console.log(`❌ Found ${geometryCollectionErrors.length} trails with GeometryCollection errors:`);
      console.table(geometryCollectionErrors);
      
      // Export problematic trails to GeoJSON for inspection
      console.log('🔍 Step 4: Exporting GeometryCollection error trails to GeoJSON...');
      
      for (let i = 0; i < geometryCollectionErrors.length; i++) {
        const trail = geometryCollectionErrors[i];
        
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
                  'error', 'GeometryCollection error'
                )
              )
            )
          ) as geojson
          FROM ${stagingSchema}.trails
          WHERE app_uuid = $1
        `, [trail.app_uuid]);
        
        const data = geoJSON.rows[0].geojson;
        const filename = `geometrycollection-error-trail-${i + 1}-${trail.name.replace(/[^a-zA-Z0-9]/g, '-')}.geojson`;
        require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
        console.log(`✅ Exported ${filename}`);
      }
      
    } else {
      console.log('✅ No individual trails cause GeometryCollection errors!');
      console.log('🔍 This suggests the error occurs when multiple trails interact...');
      
      // Test with pairs of trails to find problematic combinations
      console.log('\n🔄 Step 4: Testing trail pairs for GeometryCollection errors...');
      
      let pairErrors: any[] = [];
      let pairsTested = 0;
      const maxPairsToTest = 1000; // Limit to avoid excessive testing
      
      for (let i = 0; i < Math.min(trails.rows.length, 50); i++) {
        for (let j = i + 1; j < Math.min(trails.rows.length, 50); j++) {
          if (pairsTested >= maxPairsToTest) break;
          
          const trail1 = trails.rows[i];
          const trail2 = trails.rows[j];
          
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
              WHERE app_uuid IN ($1, $2)
            `, [trail1.app_uuid, trail2.app_uuid]);
            
            await pgClient.query(`
              SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')
            `);
            
            pairsTested++;
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            if (errorMessage.includes('GeometryCollection')) {
              console.log(`❌ Pair ${trail1.name} + ${trail2.name} - GEOMETRYCOLLECTION ERROR: ${errorMessage}`);
              
              pairErrors.push({
                trail1_name: trail1.name,
                trail1_uuid: trail1.app_uuid,
                trail2_name: trail2.name,
                trail2_uuid: trail2.app_uuid,
                error: errorMessage
              });
            }
          }
        }
      }
      
      if (pairErrors.length > 0) {
        console.log(`❌ Found ${pairErrors.length} problematic trail pairs:`);
        console.table(pairErrors);
      } else {
        console.log('✅ No problematic trail pairs found in first 50 trails.');
        console.log('🔍 The GeometryCollection error may require more complex interactions...');
      }
    }

    console.log('✅ GeometryCollection error analysis complete!');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
findGeometryCollectionError()
  .then(() => {
    console.log('🎉 GeometryCollection error analysis completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 GeometryCollection error analysis failed:', error);
    process.exit(1);
  }); 