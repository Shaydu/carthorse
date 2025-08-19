#!/usr/bin/env ts-node

/**
 * Test pgRouting nodeNetwork on Bounding Box
 * 
 * This script tests pgr_nodeNetwork on a smaller bounding box area
 * to isolate whether the issue is with network complexity or specific geometries
 */

import { Pool } from 'pg';
import { createPgRoutingHelpers } from '../src/utils/pgrouting-helpers';

async function testNodeNetworkBbox() {
  console.log('🧪 Testing pgRouting nodeNetwork on bounding box...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    const stagingSchema = 'staging_boulder_1754318437837';
    
    // Define the bounding box coordinates
    const bbox = {
      minLng: -105.32047300758535,
      maxLng: -105.26687332281577,
      minLat: 39.97645469545003,
      maxLat: 40.01589890417776
    };

    console.log('📊 Step 1: Analyzing trails within bbox...');
    
    // Count trails within the bbox
    const bboxStats = await pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN ST_IsSimple(geometry) THEN 1 END) as simple_trails,
        COUNT(CASE WHEN NOT ST_IsSimple(geometry) THEN 1 END) as non_simple_trails,
        COUNT(CASE WHEN ST_IsValid(geometry) THEN 1 END) as valid_trails
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    
    console.log('📈 Bbox Trail Statistics:');
    console.log(JSON.stringify(bboxStats.rows[0], null, 2));

    console.log('🔄 Step 2: Creating ways table for bbox area...');
    
    // Create a ways table for just the bbox area
    await pgClient.query(`DROP TABLE IF EXISTS ${stagingSchema}.ways_bbox`);
    
    const waysBboxResult = await pgClient.query(`
      CREATE TABLE ${stagingSchema}.ways_bbox AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
        app_uuid as trail_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        CASE 
          WHEN ST_IsSimple(geometry) THEN ST_Force2D(ST_Force2D(geometry))
          ELSE ST_Force2D(ST_Force2D(geometry))
        END as the_geom
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    
    console.log(`✅ Created ways_bbox table with ${waysBboxResult.rowCount} rows`);

    console.log('🔍 Step 3: Analyzing bbox ways table...');
    
    // Check geometry issues in bbox ways
    const bboxGeometryIssues = await pgClient.query(`
      SELECT 
        COUNT(*) as total_ways,
        COUNT(CASE WHEN ST_IsSimple(the_geom) THEN 1 END) as simple_ways,
        COUNT(CASE WHEN NOT ST_IsSimple(the_geom) THEN 1 END) as non_simple_ways,
        COUNT(CASE WHEN ST_IsValid(the_geom) THEN 1 END) as valid_ways
      FROM ${stagingSchema}.ways_bbox
      WHERE the_geom IS NOT NULL
    `);
    
    console.log('📊 Bbox Ways Statistics:');
    console.log(JSON.stringify(bboxGeometryIssues.rows[0], null, 2));

    console.log('🔄 Step 4: Testing pgr_nodeNetwork on bbox...');
    
    // Try pgr_nodeNetwork on the bbox area
    try {
      const nodeNetworkResult = await pgClient.query(`
        SELECT pgr_nodeNetwork('${stagingSchema}.ways_bbox', 0.000001, 'id', 'the_geom')
      `);
      console.log('✅ pgr_nodeNetwork succeeded on bbox area!');
      console.log('Result:', nodeNetworkResult.rows[0]);
      
      // Get statistics about the noded network
      const nodedStats = await pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_bbox) as original_ways,
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_bbox_noded) as noded_edges,
          (SELECT COUNT(*) FROM ${stagingSchema}.ways_bbox_vertices_pgr) as vertices
      `);
      
      console.log('📈 Noded Network Statistics:');
      console.log(JSON.stringify(nodedStats.rows[0], null, 2));
      
    } catch (nodeNetworkError) {
      console.error('❌ pgr_nodeNetwork failed on bbox area:', nodeNetworkError);
      
      // Try pgr_createTopology as fallback
      console.log('🔄 Step 5: Trying pgr_createTopology as fallback...');
      try {
        const topologyResult = await pgClient.query(`
          SELECT pgr_createTopology('${stagingSchema}.ways_bbox', 0.000001, 'the_geom', 'id')
        `);
        console.log('✅ pgr_createTopology succeeded on bbox area!');
        console.log('Result:', topologyResult.rows[0]);
      } catch (topologyError) {
        console.error('❌ pgr_createTopology also failed:', topologyError);
      }
    }

    console.log('✅ Bbox nodeNetwork test complete!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// Run the test
testNodeNetworkBbox()
  .then(() => {
    console.log('🎉 Bbox nodeNetwork test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Bbox nodeNetwork test failed:', error);
    process.exit(1);
  }); 