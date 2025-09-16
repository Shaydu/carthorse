const { Client } = require('pg');
const fs = require('fs');

// Test trail geometries from the user's data
const northSkyTrail = {
  "type": "Feature",
  "properties": {
    "id": "ab36dded-56f4-4a1d-bd16-6781586a3336",
    "name": "North Sky Trail",
    "length_meters": 106.28836983903227,
    "distance_to_bbox": 0,
    "trail_category": "north_sky",
    "color": "#FF0000"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-105.291193821, 40.070110007, 1731.133178711],
      [-105.29122595, 40.070040755, 1726.449462891],
      [-105.291243129, 40.069970456, 1726.449462891],
      [-105.291266876, 40.069873291, 1727.728393555],
      [-105.291296544, 40.069653513, 1728.930541992],
      [-105.291315845, 40.069611252, 1729.321533203],
      [-105.291333853, 40.069598859, 1729.321533203],
      [-105.291371229, 40.06960322, 1729.321533203],
      [-105.291398126, 40.069624179, 1729.321533203],
      [-105.291394233, 40.069694656, 1728.997192383],
      [-105.291419156, 40.06977441, 1727.890380859],
      [-105.291427745, 40.069832987, 1727.890380859],
      [-105.291421057, 40.069978588, 1726.752563477]
    ]
  }
};

const foothillsNorthTrail = {
  "type": "Feature",
  "properties": {
    "id": "c55c0383-f02c-4761-aebe-26098441802d",
    "name": "Foothills North Trail",
    "length_meters": 833.6713479390932,
    "distance_to_bbox": 0,
    "trail_category": "foothills_north",
    "color": "#00FF00"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-105.282727593, 40.070455567, 1687.336791992],
      [-105.283430657, 40.070318704, 1687.121826172],
      [-105.283899475, 40.070254488, 1687.099975586],
      [-105.284392235, 40.070307338, 1687.581542969],
      [-105.284767464, 40.070297406, 1688.423217773],
      [-105.285294652, 40.070169973, 1691.094604492],
      [-105.285540957, 40.070178377, 1691.958129883],
      [-105.285658152, 40.070160069, 1692.993164062],
      [-105.286173462, 40.069996623, 1693.963989258],
      [-105.286700986, 40.069950269, 1696.985595703],
      [-105.287052908, 40.069976428, 1698.661499023],
      [-105.28747508, 40.06997538, 1699.495117188],
      [-105.287827153, 40.070037574, 1699.94909668],
      [-105.288976702, 40.07010679, 1705.932006836],
      [-105.289164332, 40.070106322, 1707.591918945],
      [-105.289656484, 40.070014995, 1710.877929688],
      [-105.290125639, 40.070031841, 1715.303955078],
      [-105.290336496, 40.069977254, 1715.358520508],
      [-105.290547543, 40.069967716, 1718.499755859],
      [-105.290652971, 40.069940422, 1721.354125977],
      [-105.290988133, 40.069969306, 1723.668579102],
      [-105.291177042, 40.069954216, 1726.449462891],
      [-105.291243129, 40.069970456, 1726.449462891],
      [-105.291421057, 40.069978588, 1726.752563477],
      [-105.29149735, 40.069947311, 1727.308837891],
      [-105.291532339, 40.069902174, 1727.308837891],
      [-105.291624656, 40.069550564, 1734.462280273],
      [-105.291612545, 40.069460498, 1735.524536133],
      [-105.291670757, 40.069361246, 1738.508422852]
    ]
  }
};

// Helper function to save GeoJSON
function saveGeoJSON(data, filename) {
  const geojson = {
    type: "FeatureCollection",
    features: data
  };
  fs.writeFileSync(filename, JSON.stringify(geojson, null, 2));
  console.log(`Saved: ${filename}`);
}

// Helper function to convert PostGIS result to GeoJSON features
function postgisToGeoJSON(rows, geometryColumn = 'geometry') {
  return rows.map(row => ({
    type: "Feature",
    properties: {
      id: row.id,
      name: row.name,
      length_meters: row.length_meters,
      source: row.source,
      target: row.target,
      old_id: row.old_id,
      sub_id: row.sub_id,
      segment_order: row.segment_order,
      ...row.properties
    },
    geometry: row[geometryColumn]
  }));
}

async function testPgRoutingFunctions() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Create base table for testing
    await client.query(`
      DROP TABLE IF EXISTS test_trails_base;
      CREATE TABLE test_trails_base (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_meters DOUBLE PRECISION
      )
    `);

    // Insert the test trails
    await client.query(`
      INSERT INTO test_trails_base (app_uuid, name, geometry, length_meters)
      VALUES 
        ($1, $2, ST_GeomFromGeoJSON($3), $4),
        ($5, $6, ST_GeomFromGeoJSON($7), $8)
    `, [
      northSkyTrail.properties.id,
      northSkyTrail.properties.name,
      JSON.stringify(northSkyTrail.geometry),
      northSkyTrail.properties.length_meters,
      foothillsNorthTrail.properties.id,
      foothillsNorthTrail.properties.name,
      JSON.stringify(foothillsNorthTrail.geometry),
      foothillsNorthTrail.properties.length_meters
    ]);

    console.log('Inserted test trails');

    // Save original trails
    const originalTrails = await client.query(`
      SELECT 
        id, app_uuid, name, length_meters,
        ST_AsGeoJSON(geometry)::json as geometry
      FROM test_trails_base
      ORDER BY name
    `);
    saveGeoJSON(postgisToGeoJSON(originalTrails.rows), 'test-output/01-original-trails.geojson');

    // Test 1: Basic pgr_createTopology
    console.log('\n=== TEST 1: pgr_createTopology ===');
    await testPgCreateTopology(client);

    // Test 2: pgr_nodenetwork
    console.log('\n=== TEST 2: pgr_nodenetwork ===');
    await testPgNodeNetwork(client);

    // Test 3: pgr_createTopology with different tolerances
    console.log('\n=== TEST 3: pgr_createTopology with different tolerances ===');
    await testPgCreateTopologyTolerances(client);

    // Test 4: Manual ST_Node approach
    console.log('\n=== TEST 4: Manual ST_Node approach ===');
    await testManualSTNode(client);

    // Test 5: pgr_createTopology with 2D geometry
    console.log('\n=== TEST 5: pgr_createTopology with 2D geometry ===');
    await testPgCreateTopology2D(client);

    // Test 6: pgr_createTopology with simplified geometry
    console.log('\n=== TEST 6: pgr_createTopology with simplified geometry ===');
    await testPgCreateTopologySimplified(client);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

async function testPgCreateTopology(client) {
  try {
    // Create table for pgRouting
    await client.query(`
      DROP TABLE IF EXISTS test_trails_pgr;
      CREATE TABLE test_trails_pgr AS
      SELECT 
        id,
        ST_Force2D(geometry) as the_geom,
        name,
        length_meters
      FROM test_trails_base
    `);

    // Add source/target columns
    await client.query(`
      ALTER TABLE test_trails_pgr ADD COLUMN source INTEGER;
      ALTER TABLE test_trails_pgr ADD COLUMN target INTEGER;
    `);

    // Try pgr_createTopology
    const result = await client.query(`
      SELECT pgr_createTopology('test_trails_pgr', 1.0, 'the_geom', 'id')
    `);
    console.log('pgr_createTopology result:', result.rows[0]);

    // Save vertices
    const vertices = await client.query(`
      SELECT 
        id, x, y, cnt, chk, ein, eout,
        ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(x, y), 4326))::json as geometry
      FROM test_trails_pgr_vertices_pgr 
      ORDER BY id
    `);
    saveGeoJSON(postgisToGeoJSON(vertices.rows), 'test-output/02-pgr-create-topology-vertices.geojson');

    // Save edges
    const edges = await client.query(`
      SELECT 
        id, source, target, name, 
        ST_Length(the_geom::geography) as length_meters,
        ST_AsGeoJSON(the_geom)::json as geometry
      FROM test_trails_pgr
      WHERE source IS NOT NULL AND target IS NOT NULL
      ORDER BY id
    `);
    saveGeoJSON(postgisToGeoJSON(edges.rows), 'test-output/02-pgr-create-topology-edges.geojson');

    console.log(`Created ${vertices.rows.length} vertices and ${edges.rows.length} edges`);

  } catch (error) {
    console.log('pgr_createTopology failed:', error.message);
  }
}

async function testPgNodeNetwork(client) {
  try {
    // Create table for pgr_nodenetwork
    await client.query(`
      DROP TABLE IF EXISTS test_trails_nodenetwork;
      CREATE TABLE test_trails_nodenetwork AS
      SELECT 
        id,
        ST_Force2D(geometry) as the_geom,
        name,
        length_meters
      FROM test_trails_base
    `);

    // Try pgr_nodenetwork
    const result = await client.query(`
      SELECT pgr_nodenetwork('test_trails_nodenetwork', 1.0, 'id', 'the_geom', 'test_trails_nodenetwork_noded')
    `);
    console.log('pgr_nodenetwork result:', result.rows[0]);

    // Save noded edges
    const nodedEdges = await client.query(`
      SELECT 
        id, old_id, sub_id, name, 
        ST_Length(the_geom::geography) as length_meters,
        ST_AsGeoJSON(the_geom)::json as geometry
      FROM test_trails_nodenetwork_noded
      ORDER BY old_id, sub_id
    `);
    saveGeoJSON(postgisToGeoJSON(nodedEdges.rows), 'test-output/03-pgr-nodenetwork-edges.geojson');

    console.log(`Created ${nodedEdges.rows.length} noded edges`);

  } catch (error) {
    console.log('pgr_nodenetwork failed:', error.message);
  }
}

async function testPgCreateTopologyTolerances(client) {
  const tolerances = [0.1, 0.5, 1.0, 2.0, 5.0];
  
  for (const tolerance of tolerances) {
    try {
      console.log(`\nTesting tolerance: ${tolerance}m`);
      
      // Create table for this test
      await client.query(`
        DROP TABLE IF EXISTS test_trails_pgr_tol;
        CREATE TABLE test_trails_pgr_tol AS
        SELECT 
          id,
          ST_Force2D(geometry) as the_geom,
          name,
          length_meters
        FROM test_trails_base
      `);

      await client.query(`
        ALTER TABLE test_trails_pgr_tol ADD COLUMN source INTEGER;
        ALTER TABLE test_trails_pgr_tol ADD COLUMN target INTEGER;
      `);

      const result = await client.query(`
        SELECT pgr_createTopology('test_trails_pgr_tol', $1, 'the_geom', 'id')
      `, [tolerance]);

      const vertices = await client.query(`
        SELECT COUNT(*) as vertex_count FROM test_trails_pgr_tol_vertices_pgr
      `);
      
      const edges = await client.query(`
        SELECT COUNT(*) as edge_count 
        FROM test_trails_pgr_tol 
        WHERE source IS NOT NULL AND target IS NOT NULL
      `);

      // Save edges for this tolerance
      const edgesData = await client.query(`
        SELECT 
          id, source, target, name, 
          ST_Length(the_geom::geography) as length_meters,
          ST_AsGeoJSON(the_geom)::json as geometry
        FROM test_trails_pgr_tol
        WHERE source IS NOT NULL AND target IS NOT NULL
        ORDER BY id
      `);
      saveGeoJSON(postgisToGeoJSON(edgesData.rows), `test-output/04-pgr-tolerance-${tolerance}-edges.geojson`);

      console.log(`  Tolerance ${tolerance}m: ${vertices.rows[0].vertex_count} vertices, ${edges.rows[0].edge_count} edges`);

    } catch (error) {
      console.log(`  Tolerance ${tolerance}m failed:`, error.message);
    }
  }
}

async function testManualSTNode(client) {
  try {
    console.log('Testing manual ST_Node approach...');
    
    // Use ST_Node to split all trails at intersections
    const nodedResult = await client.query(`
      SELECT 
        id,
        app_uuid,
        name,
        (ST_Dump(ST_Node(ST_Force2D(geometry)))).geom as noded_geom,
        (ST_Dump(ST_Node(ST_Force2D(geometry)))).path[1] as segment_order,
        ST_Length((ST_Dump(ST_Node(ST_Force2D(geometry)))).geom::geography) as length_meters
      FROM test_trails_base
      WHERE ST_IsValid(geometry)
    `);

    // Save ST_Node results
    const stNodeFeatures = nodedResult.rows.map(row => ({
      type: "Feature",
      properties: {
        id: row.id,
        app_uuid: row.app_uuid,
        name: row.name,
        segment_order: row.segment_order,
        length_meters: row.length_meters
      },
      geometry: row.noded_geom
    }));
    saveGeoJSON(stNodeFeatures, 'test-output/05-st-node-segments.geojson');

    console.log(`ST_Node created ${nodedResult.rows.length} segments`);

    // Check for intersections between noded segments
    const intersections = await client.query(`
      WITH noded_trails AS (
        SELECT 
          id,
          app_uuid,
          name,
          (ST_Dump(ST_Node(ST_Force2D(geometry)))).geom as noded_geom
        FROM test_trails_base
        WHERE ST_IsValid(geometry)
      )
      SELECT 
        t1.name as trail1_name,
        t2.name as trail2_name,
        ST_Intersects(t1.noded_geom, t2.noded_geom) as intersects,
        ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) as intersection_type,
        ST_AsGeoJSON(ST_Intersection(t1.noded_geom, t2.noded_geom))::json as intersection_geometry
      FROM noded_trails t1
      JOIN noded_trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.noded_geom, t2.noded_geom)
    `);

    // Save intersection points
    const intersectionFeatures = intersections.rows.map(row => ({
      type: "Feature",
      properties: {
        trail1_name: row.trail1_name,
        trail2_name: row.trail2_name,
        intersection_type: row.intersection_type
      },
      geometry: row.intersection_geometry
    }));
    saveGeoJSON(intersectionFeatures, 'test-output/05-st-node-intersections.geojson');

    console.log(`Found ${intersections.rows.length} intersections between noded trails`);

  } catch (error) {
    console.log('Manual ST_Node failed:', error.message);
  }
}

async function testPgCreateTopology2D(client) {
  try {
    console.log('Testing pgr_createTopology with 2D geometry...');
    
    // Create table with 2D geometry
    await client.query(`
      DROP TABLE IF EXISTS test_trails_pgr_2d;
      CREATE TABLE test_trails_pgr_2d AS
      SELECT 
        id,
        ST_Force2D(geometry) as the_geom,
        name,
        length_meters
      FROM test_trails_base
    `);

    await client.query(`
      ALTER TABLE test_trails_pgr_2d ADD COLUMN source INTEGER;
      ALTER TABLE test_trails_pgr_2d ADD COLUMN target INTEGER;
    `);

    const result = await client.query(`
      SELECT pgr_createTopology('test_trails_pgr_2d', 1.0, 'the_geom', 'id')
    `);

    const vertices = await client.query(`
      SELECT COUNT(*) as vertex_count FROM test_trails_pgr_2d_vertices_pgr
    `);
    
    const edges = await client.query(`
      SELECT COUNT(*) as edge_count 
      FROM test_trails_pgr_2d 
      WHERE source IS NOT NULL AND target IS NOT NULL
    `);

    // Save 2D edges
    const edgesData = await client.query(`
      SELECT 
        id, source, target, name, 
        ST_Length(the_geom::geography) as length_meters,
        ST_AsGeoJSON(the_geom)::json as geometry
      FROM test_trails_pgr_2d
      WHERE source IS NOT NULL AND target IS NOT NULL
      ORDER BY id
    `);
    saveGeoJSON(postgisToGeoJSON(edgesData.rows), 'test-output/06-pgr-2d-edges.geojson');

    console.log(`2D approach: ${vertices.rows[0].vertex_count} vertices, ${edges.rows[0].edge_count} edges`);

  } catch (error) {
    console.log('2D approach failed:', error.message);
  }
}

async function testPgCreateTopologySimplified(client) {
  try {
    console.log('Testing pgr_createTopology with simplified geometry...');
    
    // Create table with simplified geometry
    await client.query(`
      DROP TABLE IF EXISTS test_trails_pgr_simple;
      CREATE TABLE test_trails_pgr_simple AS
      SELECT 
        id,
        ST_Simplify(ST_Force2D(geometry), 0.0001) as the_geom,
        name,
        length_meters
      FROM test_trails_base
    `);

    await client.query(`
      ALTER TABLE test_trails_pgr_simple ADD COLUMN source INTEGER;
      ALTER TABLE test_trails_pgr_simple ADD COLUMN target INTEGER;
    `);

    const result = await client.query(`
      SELECT pgr_createTopology('test_trails_pgr_simple', 1.0, 'the_geom', 'id')
    `);

    const vertices = await client.query(`
      SELECT COUNT(*) as vertex_count FROM test_trails_pgr_simple_vertices_pgr
    `);
    
    const edges = await client.query(`
      SELECT COUNT(*) as edge_count 
      FROM test_trails_pgr_simple 
      WHERE source IS NOT NULL AND target IS NOT NULL
    `);

    // Save simplified edges
    const edgesData = await client.query(`
      SELECT 
        id, source, target, name, 
        ST_Length(the_geom::geography) as length_meters,
        ST_AsGeoJSON(the_geom)::json as geometry
      FROM test_trails_pgr_simple
      WHERE source IS NOT NULL AND target IS NOT NULL
      ORDER BY id
    `);
    saveGeoJSON(postgisToGeoJSON(edgesData.rows), 'test-output/07-pgr-simplified-edges.geojson');

    console.log(`Simplified approach: ${vertices.rows[0].vertex_count} vertices, ${edges.rows[0].edge_count} edges`);

  } catch (error) {
    console.log('Simplified approach failed:', error.message);
  }
}

testPgRoutingFunctions().catch(console.error);
