#!/usr/bin/env ts-node

/**
 * Find Problematic Trail for nodeNetwork
 * 
 * This script identifies the specific trail that's causing the GeometryCollection error
 * by testing pgr_nodeNetwork on individual trails
 */

import { Pool } from 'pg';

async function findProblematicTrail() {
  console.log('🔍 Finding problematic trail for nodeNetwork...');
  
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
    
    console.log(`📈 Testing ${trails.rows.length} trails...`);

    console.log('🔄 Step 2: Testing each trail individually...');
    
    let problematicTrails: any[] = [];
    
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
              WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_Force2D(geometry))
              ELSE ST_Force2D(ST_Force2D(geometry))
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
        console.log(`❌ Trail ${trail.name} (${trail.app_uuid}) - FAILED: ${errorMessage}`);
        
        problematicTrails.push({
          app_uuid: trail.app_uuid,
          name: trail.name,
          num_points: trail.num_points,
          is_simple: trail.is_simple,
          geom_type: trail.geom_type,
          error: errorMessage
        });
      }
    }

    console.log('\n📊 Step 3: Summary of problematic trails...');
    
    if (problematicTrails.length > 0) {
      console.log(`❌ Found ${problematicTrails.length} problematic trails:`);
      console.table(problematicTrails);
      
      // Export problematic trails to GeoJSON for inspection
      console.log('🔍 Step 4: Exporting problematic trails to GeoJSON...');
      
      for (let i = 0; i < problematicTrails.length; i++) {
        const trail = problematicTrails[i];
        
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
                  'error', '${trail.error}'
                )
              )
            )
          ) as geojson
          FROM ${stagingSchema}.trails
          WHERE app_uuid = '${trail.app_uuid}'
        `);
        
        const data = geoJSON.rows[0].geojson;
        const filename = `problematic-trail-${i + 1}-${trail.name.replace(/[^a-zA-Z0-9]/g, '-')}.geojson`;
        require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
        console.log(`✅ Exported ${filename}`);
      }
      
    } else {
      console.log('✅ No problematic trails found!');
    }

    console.log('✅ Problematic trail analysis complete!');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
findProblematicTrail()
  .then(() => {
    console.log('🎉 Problematic trail analysis completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Problematic trail analysis failed:', error);
    process.exit(1);
  }); 