#!/usr/bin/env ts-node

/**
 * Find GeometryCollection Error by Geographic Block
 * 
 * This script tests pgr_nodeNetwork on different geographic blocks of the Boulder region
 * to isolate which area is causing the GeometryCollection error
 */

import { Pool } from 'pg';

async function findGeometryCollectionErrorByBlock() {
  console.log('🔍 Finding GeometryCollection error by geographic block...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';

    // Define Boulder region bounds
    const boulderBounds = {
      minLon: -105.32047300758535,
      maxLon: -105.26687332281577,
      minLat: 39.97645469545003,
      maxLat: 40.01589890417776
    };

    console.log('📊 Boulder region bounds:', boulderBounds);

    // Create a grid of smaller blocks to test
    const blockSize = 0.01; // Roughly 1km blocks
    const blocks: any[] = [];

    for (let lon = boulderBounds.minLon; lon < boulderBounds.maxLon; lon += blockSize) {
      for (let lat = boulderBounds.minLat; lat < boulderBounds.maxLat; lat += blockSize) {
        const blockLon = Math.min(lon + blockSize, boulderBounds.maxLon);
        const blockLat = Math.min(lat + blockSize, boulderBounds.maxLat);
        
        blocks.push({
          id: `${lon.toFixed(3)}_${lat.toFixed(3)}`,
          bounds: {
            minLon: lon,
            maxLon: blockLon,
            minLat: lat,
            maxLat: blockLat
          },
          center: {
            lon: (lon + blockLon) / 2,
            lat: (lat + blockLat) / 2
          }
        });
      }
    }

    console.log(`📈 Testing ${blocks.length} geographic blocks...`);

    let geometryCollectionErrors: any[] = [];
    let successfulBlocks: any[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      console.log(`🔄 Testing block ${i + 1}/${blocks.length}: ${block.id} (${block.center.lon.toFixed(4)}, ${block.center.lat.toFixed(4)})`);
      
      try {
        // Create a temporary ways table with trails in this block
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
          WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
        `, [block.bounds.minLon, block.bounds.minLat, block.bounds.maxLon, block.bounds.maxLat]);
        
        // Check if we have any trails in this block
        const trailCount = await pgClient.query(`
          SELECT COUNT(*) as count FROM ${stagingSchema}.ways_test
        `);
        
        if (trailCount.rows[0].count === 0) {
          console.log(`  ⚪ Block ${block.id}: No trails in this area`);
          continue;
        }
        
        console.log(`  📍 Block ${block.id}: ${trailCount.rows[0].count} trails`);
        
        // Try pgr_nodeNetwork on this block
        await pgClient.query(`
          SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')
        `);
        
        // If we get here, this block is OK
        console.log(`  ✅ Block ${block.id}: SUCCESS`);
        successfulBlocks.push({
          id: block.id,
          center: block.center,
          trail_count: trailCount.rows[0].count
        });
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMessage.includes('GeometryCollection')) {
          console.log(`  ❌ Block ${block.id}: GEOMETRYCOLLECTION ERROR - ${errorMessage}`);
          
          geometryCollectionErrors.push({
            id: block.id,
            bounds: block.bounds,
            center: block.center,
            error: errorMessage
          });
          
          // Export the problematic block to GeoJSON for inspection
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
                    'block_id', '${block.id}',
                    'num_points', ST_NumPoints(geometry),
                    'is_simple', ST_IsSimple(geometry),
                    'geom_type', ST_GeometryType(geometry)
                  )
                )
              )
            ) as geojson
            FROM ${stagingSchema}.trails
            WHERE geometry IS NOT NULL 
              AND ST_IsValid(geometry)
              AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
          `, [block.bounds.minLon, block.bounds.minLat, block.bounds.maxLon, block.bounds.maxLat]);
          
          const data = geoJSON.rows[0].geojson;
          const filename = `geometrycollection-error-block-${block.id}.geojson`;
          require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
          console.log(`  📁 Exported ${filename}`);
          
        } else {
          console.log(`  ⚠️ Block ${block.id}: Other error - ${errorMessage}`);
        }
      }
    }

    console.log('\n📊 Summary of GeometryCollection errors by block...');
    
    if (geometryCollectionErrors.length > 0) {
      console.log(`❌ Found ${geometryCollectionErrors.length} blocks with GeometryCollection errors:`);
      console.table(geometryCollectionErrors);
      
      // Create a summary GeoJSON showing all problematic blocks
      const summaryGeoJSON = {
        type: 'FeatureCollection',
        features: geometryCollectionErrors.map(block => ({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [block.bounds.minLon, block.bounds.minLat],
              [block.bounds.maxLon, block.bounds.minLat],
              [block.bounds.maxLon, block.bounds.maxLat],
              [block.bounds.minLon, block.bounds.maxLat],
              [block.bounds.minLon, block.bounds.minLat]
            ]]
          },
          properties: {
            block_id: block.id,
            center_lon: block.center.lon,
            center_lat: block.center.lat,
            error: block.error
          }
        }))
      };
      
      require('fs').writeFileSync('geometrycollection-error-blocks-summary.geojson', JSON.stringify(summaryGeoJSON, null, 2));
      console.log('✅ Exported geometrycollection-error-blocks-summary.geojson');
      
    } else {
      console.log('✅ No individual blocks cause GeometryCollection errors!');
      console.log(`✅ ${successfulBlocks.length} blocks tested successfully`);
      
      // Test with larger blocks
      console.log('\n🔄 Testing larger blocks...');
      
      const largeBlockSize = 0.02; // 2km blocks
      const largeBlocks: any[] = [];
      
      for (let lon = boulderBounds.minLon; lon < boulderBounds.maxLon; lon += largeBlockSize) {
        for (let lat = boulderBounds.minLat; lat < boulderBounds.maxLat; lat += largeBlockSize) {
          const blockLon = Math.min(lon + largeBlockSize, boulderBounds.maxLon);
          const blockLat = Math.min(lat + largeBlockSize, boulderBounds.maxLat);
          
          largeBlocks.push({
            id: `large_${lon.toFixed(3)}_${lat.toFixed(3)}`,
            bounds: {
              minLon: lon,
              maxLon: blockLon,
              minLat: lat,
              maxLat: blockLat
            }
          });
        }
      }
      
      for (const block of largeBlocks) {
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
            WHERE geometry IS NOT NULL 
              AND ST_IsValid(geometry)
              AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
          `, [block.bounds.minLon, block.bounds.minLat, block.bounds.maxLon, block.bounds.maxLat]);
          
          const trailCount = await pgClient.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.ways_test`);
          
          if (trailCount.rows[0].count > 0) {
            await pgClient.query(`SELECT pgr_nodeNetwork('${stagingSchema}.ways_test', 0.000001, 'id', 'the_geom')`);
            console.log(`✅ Large block ${block.id}: SUCCESS (${trailCount.rows[0].count} trails)`);
          }
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          if (errorMessage.includes('GeometryCollection')) {
            console.log(`❌ Large block ${block.id}: GEOMETRYCOLLECTION ERROR - ${errorMessage}`);
            
            // Export the problematic large block
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
                      'block_id', '${block.id}'
                    )
                  )
                )
              ) as geojson
              FROM ${stagingSchema}.trails
              WHERE geometry IS NOT NULL 
                AND ST_IsValid(geometry)
                AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
            `, [block.bounds.minLon, block.bounds.minLat, block.bounds.maxLon, block.bounds.maxLat]);
            
            const data = geoJSON.rows[0].geojson;
            const filename = `geometrycollection-error-large-block-${block.id}.geojson`;
            require('fs').writeFileSync(filename, JSON.stringify(data, null, 2));
            console.log(`📁 Exported ${filename}`);
          }
        }
      }
    }

    console.log('✅ GeometryCollection error analysis by block complete!');

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
findGeometryCollectionErrorByBlock()
  .then(() => {
    console.log('🎉 GeometryCollection error analysis by block completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 GeometryCollection error analysis by block failed:', error);
    process.exit(1);
  }); 