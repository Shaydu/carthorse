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

// Helper function to get different colors for segments
function getSegmentColor(trailName, segmentOrder, index) {
  const colors = [
    '#FF0000', // Red
    '#00FF00', // Green
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
    '#FFA500', // Orange
    '#800080', // Purple
    '#008000', // Dark Green
    '#FFC0CB'  // Pink
  ];
  
  // Use segment order if available, otherwise use index
  const colorIndex = segmentOrder ? (segmentOrder - 1) % colors.length : index % colors.length;
  return colors[colorIndex];
}

async function testWorkingSolution() {
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

    // Create test table
    await client.query(`
      DROP TABLE IF EXISTS test_trails_working;
      CREATE TABLE test_trails_working (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_meters DOUBLE PRECISION
      )
    `);

    // Insert test trails
    await client.query(`
      INSERT INTO test_trails_working (app_uuid, name, geometry, length_meters)
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

    // Test 1: Enhanced ST_Split approach (Recommended)
    console.log('\n=== TEST 1: Enhanced ST_Split Approach ===');
    
    const enhancedSplitResult = await client.query(`
      WITH trail_intersections AS (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t2.app_uuid as trail2_uuid,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_point
        FROM test_trails_working t1
        JOIN test_trails_working t2 ON t1.id < t2.id
        WHERE ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > 5
          AND ST_Length(t2.geometry::geography) > 5
      ),
      split_trails AS (
        SELECT
          t.id, t.app_uuid, t.name, t.geometry,
          (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).geom as split_geometry,
          (ST_Dump(ST_Split(t.geometry, ti.intersection_point))).path[1] as segment_order
        FROM test_trails_working t
        JOIN trail_intersections ti ON t.app_uuid IN (ti.trail1_uuid, ti.trail2_uuid)
      )
      SELECT 
        id, app_uuid, name, segment_order,
        ST_GeometryType(split_geometry) as geometry_type,
        ST_Length(split_geometry::geography) as length_meters,
        ST_AsGeoJSON(split_geometry)::json as geometry
      FROM split_trails
      WHERE ST_GeometryType(split_geometry) = 'ST_LineString'
        AND ST_Length(split_geometry::geography) > 5
      ORDER BY name, segment_order
    `);

    console.log(`Enhanced ST_Split created ${enhancedSplitResult.rows.length} segments:`);
    enhancedSplitResult.rows.forEach(row => {
      console.log(`  ${row.name} segment ${row.segment_order}: ${row.length_meters}m`);
    });

    // Save enhanced split results
    const enhancedFeatures = enhancedSplitResult.rows.map((row, index) => ({
      type: "Feature",
      properties: {
        id: row.id,
        app_uuid: row.app_uuid,
        name: row.name,
        segment_order: row.segment_order,
        geometry_type: row.geometry_type,
        length_meters: row.length_meters,
        color: getSegmentColor(row.name, row.segment_order, index)
      },
      geometry: row.geometry
    }));
    saveGeoJSON(enhancedFeatures, 'test-output/08-enhanced-st-split-segments.geojson');

    // Test 2: ST_Node + ST_Split approach
    console.log('\n=== TEST 2: ST_Node + ST_Split Approach ===');
    
    const stNodeSplitResult = await client.query(`
      WITH noded_network AS (
        SELECT ST_Node(ST_Collect(geometry)) as network_geometry
        FROM test_trails_working
      ),
      split_trails AS (
        SELECT 
          t.id, t.app_uuid, t.name, t.geometry,
          (ST_Dump(ST_Split(t.geometry, nn.network_geometry))).geom as split_geometry,
          (ST_Dump(ST_Split(t.geometry, nn.network_geometry))).path[1] as segment_order
        FROM test_trails_working t
        CROSS JOIN noded_network nn
      )
      SELECT 
        id, app_uuid, name, segment_order,
        ST_GeometryType(split_geometry) as geometry_type,
        ST_Length(split_geometry::geography) as length_meters,
        ST_AsGeoJSON(split_geometry)::json as geometry
      FROM split_trails
      WHERE ST_GeometryType(split_geometry) = 'ST_LineString'
        AND ST_Length(split_geometry::geography) > 5
      ORDER BY name, segment_order
    `);

    console.log(`ST_Node + ST_Split created ${stNodeSplitResult.rows.length} segments:`);
    stNodeSplitResult.rows.forEach(row => {
      console.log(`  ${row.name} segment ${row.segment_order}: ${row.length_meters}m`);
    });

    // Save ST_Node + ST_Split results
    const stNodeFeatures = stNodeSplitResult.rows.map((row, index) => ({
      type: "Feature",
      properties: {
        id: row.id,
        app_uuid: row.app_uuid,
        name: row.name,
        segment_order: row.segment_order,
        geometry_type: row.geometry_type,
        length_meters: row.length_meters,
        color: getSegmentColor(row.name, row.segment_order, index)
      },
      geometry: row.geometry
    }));
    saveGeoJSON(stNodeFeatures, 'test-output/09-st-node-split-segments.geojson');

    // Test 3: Post-process with pgRouting after splitting
    console.log('\n=== TEST 3: pgRouting after Enhanced ST_Split ===');
    
    if (enhancedSplitResult.rows.length > 0) {
      // Create table with split segments
      await client.query(`
        DROP TABLE IF EXISTS test_split_segments;
        CREATE TABLE test_split_segments (
          id SERIAL PRIMARY KEY,
          app_uuid TEXT,
          name TEXT,
          the_geom GEOMETRY(LINESTRING, 4326),
          length_meters DOUBLE PRECISION
        )
      `);

      // Insert split segments
      for (const row of enhancedSplitResult.rows) {
        await client.query(`
          INSERT INTO test_split_segments (app_uuid, name, the_geom, length_meters)
          VALUES ($1, $2, ST_Force2D(ST_GeomFromGeoJSON($3)), $4)
        `, [row.app_uuid, row.name, JSON.stringify(row.geometry), row.length_meters]);
      }

      // Add source/target columns
      await client.query(`
        ALTER TABLE test_split_segments ADD COLUMN source INTEGER;
        ALTER TABLE test_split_segments ADD COLUMN target INTEGER;
      `);

      // Try pgRouting topology creation
      try {
        const pgrResult = await client.query(`
          SELECT pgr_createTopology('test_split_segments', 1.0, 'the_geom', 'id')
        `);
        console.log('pgRouting topology creation result:', pgrResult.rows[0]);

        // Check results
        const vertices = await client.query(`
          SELECT COUNT(*) as vertex_count FROM test_split_segments_vertices_pgr
        `);
        
        const edges = await client.query(`
          SELECT COUNT(*) as edge_count 
          FROM test_split_segments 
          WHERE source IS NOT NULL AND target IS NOT NULL
        `);

        console.log(`pgRouting after splitting: ${vertices.rows[0].vertex_count} vertices, ${edges.rows[0].edge_count} edges`);

        // Save pgRouting results
        const pgrEdges = await client.query(`
          SELECT 
            id, source, target, name, 
            ST_Length(the_geom::geography) as length_meters,
            ST_AsGeoJSON(the_geom)::json as geometry
          FROM test_split_segments
          WHERE source IS NOT NULL AND target IS NOT NULL
          ORDER BY id
        `);
        
        const pgrFeatures = pgrEdges.rows.map(row => ({
          type: "Feature",
          properties: {
            id: row.id,
            source: row.source,
            target: row.target,
            name: row.name,
            length_meters: row.length_meters
          },
          geometry: row.geometry
        }));
        saveGeoJSON(pgrFeatures, 'test-output/10-pgr-after-splitting-edges.geojson');

      } catch (error) {
        console.log('pgRouting after splitting failed:', error.message);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testWorkingSolution().catch(console.error);
