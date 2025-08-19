#!/usr/bin/env ts-node

import { Pool } from 'pg';

async function checkStagingSchemaScope(): Promise<void> {
  console.log('🔍 Checking staging schema scope...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'carthorse'
  });

  try {
    const stagingSchema = 'test_vertex_aware_t_split';
    console.log(`📋 Using staging schema: ${stagingSchema}`);

    // Check what's in the trails table
    const trailsInfo = await pgClient.query(`
      SELECT 
        COUNT(*) as total_trails
      FROM ${stagingSchema}.trails
    `);

    console.log(`📊 Trails table contents:`);
    console.log(`   Total trails: ${trailsInfo.rows[0].total_trails} (Boulder/Cotrex filtered)`);

    // Check the bbox filter that was applied
    const bboxInfo = await pgClient.query(`
      SELECT 
        MIN(ST_XMin(geometry)) as min_lng,
        MAX(ST_XMax(geometry)) as max_lng,
        MIN(ST_YMin(geometry)) as min_lat,
        MAX(ST_YMax(geometry)) as max_lat
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL
    `);

    console.log(`🗺️ Geographic scope:`);
    console.log(`   Bounding box: ${bboxInfo.rows[0].min_lng}, ${bboxInfo.rows[0].min_lat}, ${bboxInfo.rows[0].max_lng}, ${bboxInfo.rows[0].max_lat}`);

    // Check if this matches the expected Boulder bbox
    const expectedBbox = [-105.30123174925316, 39.96928418458248, -105.26050515816028, 39.993172777276015];
    console.log(`   Expected Boulder bbox: ${expectedBbox.join(', ')}`);

    // Check specific trails for Bear Canyon and Fern Canyon
    const specificTrails = await pgClient.query(`
      SELECT 
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails
      WHERE LOWER(name) LIKE '%bear canyon%' OR LOWER(name) LIKE '%fern canyon%'
      ORDER BY name
    `);

    console.log(`\n🐻🌿 Bear Canyon and Fern Canyon trails in staging schema:`);
    if (specificTrails.rows.length === 0) {
      console.log('   No Bear Canyon or Fern Canyon trails found!');
    } else {
      specificTrails.rows.forEach((trail, index) => {
        console.log(`   ${index + 1}. ${trail.name} (${trail.region}, ${trail.source})`);
        console.log(`      Length: ${trail.length_meters.toFixed(1)}m`);
        console.log(`      Start: ${trail.start_point}`);
        console.log(`      End: ${trail.end_point}`);
      });
    }

    // Check the ways_noded table to see if it has the expected structure
    const waysNodedInfo = await pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(DISTINCT source) as unique_sources,
        COUNT(DISTINCT target) as unique_targets,
        MIN(source) as min_source,
        MAX(source) as max_source,
        MIN(target) as min_target,
        MAX(target) as max_target
      FROM ${stagingSchema}.ways_noded
    `);

    console.log(`\n🛤️ Ways_noded table analysis:`);
    console.log(`   Total edges: ${waysNodedInfo.rows[0].total_edges}`);
    console.log(`   Unique source nodes: ${waysNodedInfo.rows[0].unique_sources}`);
    console.log(`   Unique target nodes: ${waysNodedInfo.rows[0].unique_targets}`);
    console.log(`   Source node range: ${waysNodedInfo.rows[0].min_source} to ${waysNodedInfo.rows[0].max_source}`);
    console.log(`   Target node range: ${waysNodedInfo.rows[0].min_target} to ${waysNodedInfo.rows[0].max_target}`);

  } catch (error) {
    console.error('❌ Error checking staging schema scope:', error);
  } finally {
    await pgClient.end();
  }
}

// Run the check
checkStagingSchemaScope().catch(console.error);
