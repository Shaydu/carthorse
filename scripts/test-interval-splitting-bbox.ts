#!/usr/bin/env ts-node

import { Client } from 'pg';
import * as fs from 'fs';

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'shaydu'
});

// The problematic bbox that contains the Ute Trail
const PROBLEMATIC_BBOX = {
  minLon: -105.32047300758535,
  maxLon: -105.26687332281577,
  minLat: 39.97645469545003,
  maxLat: 40.01589890417776
};

async function testIntervalSplittingBbox() {
  try {
    await client.connect();
    console.log('🔧 Testing interval splitting on problematic bbox...');
    console.log(`Bbox: [${PROBLEMATIC_BBOX.minLon}, ${PROBLEMATIC_BBOX.minLat}] to [${PROBLEMATIC_BBOX.maxLon}, ${PROBLEMATIC_BBOX.maxLat}]`);

    // Step 1: Get trails in the bbox
    console.log('\n📊 Step 1: Getting trails in bbox...');
    const bboxTrails = await getTrailsInBbox();
    console.log(`Found ${bboxTrails.length} trails in bbox`);

    // Step 2: Identify loops vs simple trails
    console.log('\n📊 Step 2: Identifying loops vs simple trails...');
    const { loopTrails, simpleTrails } = await categorizeTrails(bboxTrails);
    console.log(`Loops: ${loopTrails.length}, Simple: ${simpleTrails.length}`);

    // Step 3: Split loops using interval splitting
    console.log('\n📊 Step 3: Splitting loops using interval splitting...');
    const splitTrails = await splitLoopsWithIntervals(loopTrails);
    console.log(`Created ${splitTrails.length} segments from loops`);

    // Step 4: Process simple trails with pgr_nodeNetwork
    console.log('\n📊 Step 4: Processing simple trails with pgr_nodeNetwork...');
    const nodeNetworkResult = await processSimpleTrailsWithNodeNetwork(simpleTrails);
    console.log(`NodeNetwork created ${nodeNetworkResult.nodeCount} nodes and ${nodeNetworkResult.edgeCount} edges`);

    // Step 5: Combine results
    console.log('\n📊 Step 5: Combining results...');
    const combinedResult = await combineResults(splitTrails, nodeNetworkResult);
    console.log(`Combined network: ${combinedResult.totalEdges} edges, ${combinedResult.totalNodes} nodes`);

    // Step 6: Test routing
    console.log('\n🧪 Step 6: Testing routing...');
    await testCombinedRouting(combinedResult);

    // Step 7: Export results
    console.log('\n📁 Step 7: Exporting results...');
    await exportBboxResults(combinedResult, loopTrails, simpleTrails, splitTrails);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

async function getTrailsInBbox() {
  const query = `
    SELECT 
      app_uuid,
      name,
      geometry,
      ST_NumPoints(geometry) as num_points,
      ST_IsSimple(geometry) as is_simple,
      ST_IsValid(geometry) as is_valid
    FROM staging_boulder_1754318437837.trails 
    WHERE geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    ORDER BY name
  `;
  
  const result = await client.query(query, [
    PROBLEMATIC_BBOX.minLon,
    PROBLEMATIC_BBOX.minLat,
    PROBLEMATIC_BBOX.maxLon,
    PROBLEMATIC_BBOX.maxLat
  ]);
  
  return result.rows;
}

async function categorizeTrails(trails: any[]) {
  const loopTrails = trails.filter(t => !t.is_simple);
  const simpleTrails = trails.filter(t => t.is_simple);
  
  console.log('  Loop trails:');
  loopTrails.forEach(t => console.log(`    ${t.name} (${t.num_points} points)`));
  
  console.log('  Simple trails:');
  simpleTrails.forEach(t => console.log(`    ${t.name} (${t.num_points} points)`));
  
  return { loopTrails, simpleTrails };
}

async function splitLoopsWithIntervals(loopTrails: any[]) {
  console.log('  Splitting loops using interval splitting...');
  
  const splitTrails: any[] = [];
  let nextId = 1;
  
  for (const trail of loopTrails) {
    try {
      console.log(`    Processing ${trail.name} (${trail.num_points} points)...`);
      
      // Split the loop at regular intervals (every N points)
      const intervalSize = Math.max(5, Math.floor(trail.num_points / 4)); // Split into ~4 segments, min 5 points
      
      const intervalQuery = `
        WITH loop_geom AS (
          SELECT ST_Force2D(geometry) as geom, ST_NumPoints(geometry) as num_points
          FROM staging_boulder_1754318437837.trails 
          WHERE app_uuid = '${trail.app_uuid}'
        ),
        split_points AS (
          SELECT 
            generate_series(1, num_points - 1, ${intervalSize}) as point_index
          FROM loop_geom
        ),
        segments AS (
          SELECT 
            ST_LineSubstring(geom, 
              (point_index::float / num_points), 
              LEAST((point_index + ${intervalSize})::float / num_points, 1.0)
            ) as segment,
            point_index
          FROM split_points, loop_geom
          WHERE point_index < num_points
        )
        SELECT 
          ST_GeometryType(segment) as geom_type,
          ST_NumPoints(segment) as num_points,
          ST_IsSimple(segment) as is_simple,
          segment as the_geom,
          point_index
        FROM segments
        WHERE ST_GeometryType(segment) = 'ST_LineString'
          AND ST_NumPoints(segment) > 1
        ORDER BY point_index
      `;
      
      const intervalResult = await client.query(intervalQuery);
      console.log(`      Created ${intervalResult.rows.length} segments`);
      
      for (const segment of intervalResult.rows) {
        if (segment.is_simple) {
          splitTrails.push({
            id: nextId++,
            trail_uuid: trail.app_uuid,
            name: `${trail.name}_segment_${segment.point_index}`,
            the_geom: segment.the_geom,
            original_trail_uuid: trail.app_uuid,
            segment_index: segment.point_index,
            num_points: segment.num_points
          });
        } else {
          console.log(`      ⚠️  Segment ${segment.point_index} is not simple, skipping`);
        }
      }
      
    } catch (error) {
      console.log(`      ❌ Error processing ${trail.name}: ${(error as Error).message}`);
    }
  }
  
  return splitTrails;
}

async function processSimpleTrailsWithNodeNetwork(simpleTrails: any[]) {
  console.log('  Processing simple trails with pgr_nodeNetwork...');
  
  if (simpleTrails.length === 0) {
    console.log('    No simple trails to process');
    return {
      tableName: null,
      nodeCount: 0,
      edgeCount: 0
    };
  }
  
  // Create table for simple trails
  const tableName = 'ways_bbox_simple_interval';
  await client.query(`DROP TABLE IF EXISTS staging_boulder_1754318437837.${tableName}`);
  
  const createQuery = `
    CREATE TABLE staging_boulder_1754318437837.${tableName} AS
    SELECT 
      ROW_NUMBER() OVER (ORDER BY app_uuid) as id,
      app_uuid as trail_uuid,
      name,
      ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001)) as the_geom
    FROM staging_boulder_1754318437837.trails 
    WHERE app_uuid = ANY($1)
      AND geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND ST_IsSimple(geometry)
  `;
  
  const trailUuids = simpleTrails.map(t => t.app_uuid);
  await client.query(createQuery, [trailUuids]);
  
  // Run pgr_nodeNetwork
  await client.query(`SELECT pgr_nodeNetwork('staging_boulder_1754318437837.${tableName}', 0.000001, 'id', 'the_geom')`);
  
  // Get statistics
  const nodeResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_noded_vertices_pgr`);
  const edgeResult = await client.query(`SELECT COUNT(*) as count FROM staging_boulder_1754318437837.${tableName}_noded`);
  
  return {
    tableName: `${tableName}_noded`,
    nodeCount: parseInt(nodeResult.rows[0].count),
    edgeCount: parseInt(edgeResult.rows[0].count)
  };
}

async function combineResults(splitTrails: any[], nodeNetworkResult: any) {
  console.log('  Combining loop segments and nodeNetwork results...');
  
  // Create combined table
  const combinedTable = 'routing_bbox_interval_combined';
  await client.query(`DROP TABLE IF EXISTS staging_boulder_1754318437837.${combinedTable}`);
  
  await client.query(`
    CREATE TABLE staging_boulder_1754318437837.${combinedTable} (
      id SERIAL PRIMARY KEY,
      trail_uuid UUID,
      name TEXT,
      the_geom GEOMETRY(LINESTRING, 4326),
      source INTEGER,
      target INTEGER,
      cost DOUBLE PRECISION,
      reverse_cost DOUBLE PRECISION,
      is_loop_segment BOOLEAN,
      original_trail_uuid UUID,
      segment_index INTEGER,
      num_points INTEGER
    )
  `);
  
  // Insert loop segments
  console.log(`    Inserting ${splitTrails.length} loop segments...`);
  for (const segment of splitTrails) {
    await client.query(`
      INSERT INTO staging_boulder_1754318437837.${combinedTable} 
      (id, trail_uuid, name, the_geom, is_loop_segment, original_trail_uuid, segment_index, num_points)
      VALUES ($1, $2, $3, $4, true, $5, $6, $7)
    `, [
      segment.id,
      segment.trail_uuid,
      segment.name,
      segment.the_geom,
      segment.original_trail_uuid,
      segment.segment_index,
      segment.num_points
    ]);
  }
  
  // Insert nodeNetwork results (if any)
  if (nodeNetworkResult.tableName && nodeNetworkResult.edgeCount > 0) {
    console.log(`    Inserting nodeNetwork results...`);
    const nodeNetworkOffset = splitTrails.length + 1;
    await client.query(`
      INSERT INTO staging_boulder_1754318437837.${combinedTable} 
      (id, trail_uuid, name, the_geom, source, target, is_loop_segment)
      SELECT 
        id + ${nodeNetworkOffset},
        trail_uuid,
        name,
        the_geom,
        source,
        target,
        false
      FROM staging_boulder_1754318437837.${nodeNetworkResult.tableName}
    `);
  }
  
  // Add cost columns
  await client.query(`
    UPDATE staging_boulder_1754318437837.${combinedTable} 
    SET 
      cost = ST_Length(the_geom::geography) / 1000.0,
      reverse_cost = ST_Length(the_geom::geography) / 1000.0
    WHERE cost IS NULL
  `);
  
  // Create topology
  await client.query(`SELECT pgr_createTopology('staging_boulder_1754318437837.${combinedTable}', 0.000001, 'the_geom', 'id')`);
  
  // Get final statistics
  const statsResult = await client.query(`
    SELECT 
      COUNT(*) as total_edges,
      COUNT(CASE WHEN is_loop_segment THEN 1 END) as loop_segments,
      COUNT(CASE WHEN NOT is_loop_segment THEN 1 END) as noded_edges,
      COUNT(DISTINCT source) + COUNT(DISTINCT target) as total_nodes
    FROM staging_boulder_1754318437837.${combinedTable}
  `);
  
  return {
    tableName: combinedTable,
    totalEdges: parseInt(statsResult.rows[0].total_edges),
    loopSegments: parseInt(statsResult.rows[0].loop_segments),
    nodedEdges: parseInt(statsResult.rows[0].noded_edges),
    totalNodes: parseInt(statsResult.rows[0].total_nodes)
  };
}

async function testCombinedRouting(combinedResult: any) {
  console.log('  Testing routing on combined network...');
  
  try {
    // Get sample nodes
    const sampleNodes = await client.query(`
      SELECT DISTINCT source 
      FROM staging_boulder_1754318437837.${combinedResult.tableName}
      WHERE source IS NOT NULL 
      ORDER BY source 
      LIMIT 10
    `);
    
    if (sampleNodes.rows.length > 1) {
      const startNode = sampleNodes.rows[0].source;
      const endNode = sampleNodes.rows[sampleNodes.rows.length - 1].source;
      
      console.log(`    Testing route from node ${startNode} to node ${endNode}...`);
      
      const routeResult = await client.query(`
        SELECT 
          seq,
          node,
          edge,
          cost,
          agg_cost
        FROM pgr_dijkstra(
          'SELECT id, source, target, cost, reverse_cost FROM staging_boulder_1754318437837.${combinedResult.tableName}',
          ${startNode}, ${endNode}, false
        )
      `);
      
      if (routeResult.rows.length > 0) {
        console.log(`    ✅ Route found with ${routeResult.rows.length} segments, total cost: ${routeResult.rows[routeResult.rows.length - 1].agg_cost}`);
      } else {
        console.log(`    ⚠️  No route found`);
      }
    } else {
      console.log(`    ⚠️  Not enough nodes for routing test`);
    }
    
  } catch (error) {
    console.log(`    ❌ Error testing routing: ${(error as Error).message}`);
  }
}

async function exportBboxResults(combinedResult: any, loopTrails: any[], simpleTrails: any[], splitTrails: any[]) {
  console.log('  Exporting bbox results...');
  
  try {
    // Export original trails for comparison
    const originalTrailsQuery = `
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'properties', json_build_object(
                'name', name,
                'app_uuid', app_uuid,
                'num_points', ST_NumPoints(geometry),
                'is_simple', ST_IsSimple(geometry),
                'is_loop', NOT ST_IsSimple(geometry)
              ),
              'geometry', ST_AsGeoJSON(geometry)::json
            )
          )
        ) as geojson
      FROM staging_boulder_1754318437837.trails 
      WHERE app_uuid = ANY($1)
    `;
    
    const allTrailUuids = [...loopTrails, ...simpleTrails].map(t => t.app_uuid);
    const originalResult = await client.query(originalTrailsQuery, [allTrailUuids]);
    fs.writeFileSync('ute-trail-bbox-original.geojson', JSON.stringify(originalResult.rows[0].geojson, null, 2));
    console.log('    ✅ Exported original trails to ute-trail-bbox-original.geojson');
    
    // Export split segments
    const splitSegmentsQuery = `
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'properties', json_build_object(
                'id', id,
                'name', name,
                'original_trail_uuid', original_trail_uuid,
                'segment_index', segment_index,
                'num_points', num_points,
                'is_loop_segment', true
              ),
              'geometry', ST_AsGeoJSON(the_geom)::json
            )
          )
        ) as geojson
      FROM staging_boulder_1754318437837.${combinedResult.tableName}
      WHERE is_loop_segment = true
    `;
    
    const splitResult = await client.query(splitSegmentsQuery);
    fs.writeFileSync('ute-trail-bbox-split-segments.geojson', JSON.stringify(splitResult.rows[0].geojson, null, 2));
    console.log('    ✅ Exported split segments to ute-trail-bbox-split-segments.geojson');
    
    // Export combined network
    const combinedQuery = `
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'properties', json_build_object(
                'id', id,
                'name', name,
                'source', source,
                'target', target,
                'cost', cost,
                'is_loop_segment', is_loop_segment,
                'original_trail_uuid', original_trail_uuid,
                'segment_index', segment_index
              ),
              'geometry', ST_AsGeoJSON(the_geom)::json
            )
          )
        ) as geojson
      FROM staging_boulder_1754318437837.${combinedResult.tableName}
    `;
    
    const combinedResult2 = await client.query(combinedQuery);
    fs.writeFileSync('ute-trail-bbox-combined-network.geojson', JSON.stringify(combinedResult2.rows[0].geojson, null, 2));
    console.log('    ✅ Exported combined network to ute-trail-bbox-combined-network.geojson');
    
    // Export statistics
    const stats = {
      bbox: PROBLEMATIC_BBOX,
      combinedResult,
      loopTrails: loopTrails.length,
      simpleTrails: simpleTrails.length,
      splitTrails: splitTrails.length,
      totalTrails: loopTrails.length + simpleTrails.length,
      loopTrailNames: loopTrails.map(t => t.name),
      simpleTrailNames: simpleTrails.map(t => t.name),
      splitTrailDetails: splitTrails.map(t => ({
        name: t.name,
        original: t.original_trail_uuid,
        segment: t.segment_index,
        points: t.num_points
      }))
    };
    
    fs.writeFileSync('ute-trail-bbox-stats.json', JSON.stringify(stats, null, 2));
    console.log('    ✅ Exported to ute-trail-bbox-stats.json');
    
  } catch (error) {
    console.log(`    ❌ Error exporting results: ${(error as Error).message}`);
  }
}

testIntervalSplittingBbox(); 