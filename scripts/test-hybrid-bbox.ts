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

async function testHybridBbox() {
  try {
    await client.connect();
    console.log('🔧 Testing hybrid approach on problematic bbox with Ute Trail...');
    console.log(`Bbox: [${PROBLEMATIC_BBOX.minLon}, ${PROBLEMATIC_BBOX.minLat}] to [${PROBLEMATIC_BBOX.maxLon}, ${PROBLEMATIC_BBOX.maxLat}]`);

    // Step 1: Get trails in the bbox
    console.log('\n📊 Step 1: Getting trails in bbox...');
    const bboxTrails = await getTrailsInBbox();
    console.log(`Found ${bboxTrails.length} trails in bbox`);

    // Step 2: Identify loops vs simple trails
    console.log('\n📊 Step 2: Identifying loops vs simple trails...');
    const { loopTrails, simpleTrails } = await categorizeTrails(bboxTrails);
    console.log(`Loops: ${loopTrails.length}, Simple: ${simpleTrails.length}`);

    // Step 3: Preprocess loops
    console.log('\n📊 Step 3: Preprocessing loops...');
    const splitTrails = await preprocessLoops(loopTrails);
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
    await exportBboxResults(combinedResult, loopTrails, simpleTrails);

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

async function preprocessLoops(loopTrails: any[]) {
  console.log('  Preprocessing loops by splitting at self-intersection points...');
  
  const splitTrails: any[] = [];
  let nextId = 1;
  
  for (const trail of loopTrails) {
    try {
      console.log(`    Processing ${trail.name} (${trail.num_points} points)...`);
      
      // Try to split the loop at self-intersection points
      const splitQuery = `
        WITH loop_geometry AS (
          SELECT '${trail.app_uuid}' as trail_uuid, '${trail.name}' as name, ST_Force2D(geometry) as geom
          FROM staging_boulder_1754318437837.trails 
          WHERE app_uuid = '${trail.app_uuid}'
        ),
        split_segments AS (
          SELECT 
            (ST_Dump(ST_Split(geom, ST_Intersection(geom, geom)))).geom as segment_geom,
            generate_series(1, ST_NumGeometries(ST_Split(geom, ST_Intersection(geom, geom)))) as segment_index
          FROM loop_geometry
        )
        SELECT 
          segment_geom,
          segment_index
        FROM split_segments
        WHERE ST_GeometryType(segment_geom) = 'ST_LineString'
          AND ST_NumPoints(segment_geom) > 1
      `;
      
      const splitResult = await client.query(splitQuery);
      
      for (const segment of splitResult.rows) {
        if (segment.segment_geom && segment.segment_index) {
          splitTrails.push({
            id: nextId++,
            trail_uuid: trail.app_uuid,
            name: `${trail.name}_segment_${segment.segment_index}`,
            the_geom: segment.segment_geom,
            original_trail_uuid: trail.app_uuid,
            segment_index: segment.segment_index
          });
        }
      }
      
      console.log(`      Created ${splitResult.rows.length} segments`);
      
    } catch (error) {
      console.log(`      ❌ Error processing ${trail.name}: ${(error as Error).message}`);
      
      // Fallback: use simplified geometry
      try {
        const fallbackQuery = `
          SELECT 
            '${trail.app_uuid}' as trail_uuid,
            '${trail.name}_simplified' as name,
            ST_Force2D(ST_SimplifyPreserveTopology(geometry, 0.00001)) as geom
          FROM staging_boulder_1754318437837.trails 
          WHERE app_uuid = '${trail.app_uuid}'
        `;
        
        const fallbackResult = await client.query(fallbackQuery);
        if (fallbackResult.rows.length > 0) {
          const fallback = fallbackResult.rows[0];
          splitTrails.push({
            id: nextId++,
            trail_uuid: trail.app_uuid,
            name: fallback.name,
            the_geom: fallback.geom,
            original_trail_uuid: trail.app_uuid,
            segment_index: 1
          });
          console.log(`      Used fallback simplified geometry`);
        }
      } catch (fallbackError) {
        console.log(`      ❌ Fallback also failed: ${(fallbackError as Error).message}`);
      }
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
  const tableName = 'ways_bbox_simple';
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
  const combinedTable = 'routing_bbox_hybrid';
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
      segment_index INTEGER
    )
  `);
  
  // Insert loop segments
  console.log(`    Inserting ${splitTrails.length} loop segments...`);
  for (const segment of splitTrails) {
    await client.query(`
      INSERT INTO staging_boulder_1754318437837.${combinedTable} 
      (id, trail_uuid, name, the_geom, is_loop_segment, original_trail_uuid, segment_index)
      VALUES ($1, $2, $3, $4, true, $5, $6)
    `, [
      segment.id,
      segment.trail_uuid,
      segment.name,
      segment.the_geom,
      segment.original_trail_uuid,
      segment.segment_index
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

async function exportBboxResults(combinedResult: any, loopTrails: any[], simpleTrails: any[]) {
  console.log('  Exporting bbox results...');
  
  try {
    // Export combined network to GeoJSON
    const geojsonQuery = `
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'properties', json_build_object(
                'id', id,
                'trail_uuid', trail_uuid,
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
    
    const result = await client.query(geojsonQuery);
    const geojson = result.rows[0].geojson;
    
    fs.writeFileSync('hybrid-bbox-network.geojson', JSON.stringify(geojson, null, 2));
    console.log('    ✅ Exported to hybrid-bbox-network.geojson');
    
    // Export statistics
    const stats = {
      bbox: PROBLEMATIC_BBOX,
      combinedResult,
      loopTrails: loopTrails.length,
      simpleTrails: simpleTrails.length,
      totalTrails: loopTrails.length + simpleTrails.length,
      loopTrailNames: loopTrails.map(t => t.name),
      simpleTrailNames: simpleTrails.map(t => t.name)
    };
    
    fs.writeFileSync('hybrid-bbox-stats.json', JSON.stringify(stats, null, 2));
    console.log('    ✅ Exported to hybrid-bbox-stats.json');
    
  } catch (error) {
    console.log(`    ❌ Error exporting results: ${(error as Error).message}`);
  }
}

testHybridBbox(); 