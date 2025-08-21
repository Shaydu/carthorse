const { Client } = require('pg');
const fs = require('fs');

async function testHogbackRidgeSimple() {
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

    // Create a staging schema for testing
    const stagingSchema = `test_hogback_simple_${Date.now()}`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Create staging tables with the correct structure
    await client.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);

    // Copy only Hogback Ridge Trail to staging
    console.log('Copying Hogback Ridge Trail to staging...');
    
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, created_at, updated_at, geometry
      )
      SELECT 
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, created_at, updated_at, geometry
      FROM public.trails
      WHERE region = 'boulder'
        AND source = 'cotrex'
        AND name ILIKE '%Hogback Ridge%'
    `);

    const trailCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} Hogback Ridge trails to staging`);

    // Show the original trail data
    console.log('\n=== Original Hogback Ridge Trail Data ===');
    const originalTrails = await client.query(`
      SELECT id, name, ST_AsText(geometry) as geometry_text, 
             ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points
      FROM ${stagingSchema}.trails
      ORDER BY id
    `);
    
    originalTrails.rows.forEach((trail, index) => {
      console.log(`Trail ${index + 1}:`);
      console.log(`  ID: ${trail.id}`);
      console.log(`  Name: ${trail.name}`);
      console.log(`  Length: ${trail.length_meters?.toFixed(2)} meters`);
      console.log(`  Points: ${trail.num_points}`);
      console.log(`  Geometry: ${trail.geometry_text?.substring(0, 100)}...`);
      console.log('');
    });

    // Test basic intersection splitting
    console.log('\n=== Testing Basic Intersection Splitting ===');
    const splitResult = await client.query(`
      SELECT * FROM public.simple_intersection_splitting($1, $2)
    `, [stagingSchema, 2.0]);

    console.log('Split result:', splitResult.rows[0]);

    // Check what was created in the split_trails table
    console.log('\n=== Split Trails Results ===');
    try {
      const splitTrails = await client.query(`
        SELECT id, name, ST_AsText(geometry) as geometry_text,
               ST_Length(geometry::geography) as length_meters,
               ST_NumPoints(geometry) as num_points
        FROM ${stagingSchema}.split_trails
        ORDER BY id
      `);

      console.log(`Found ${splitTrails.rows.length} split trails:`);
      splitTrails.rows.forEach((trail, index) => {
        console.log(`Split Trail ${index + 1}:`);
        console.log(`  ID: ${trail.id}`);
        console.log(`  Name: ${trail.name}`);
        console.log(`  Length: ${trail.length_meters?.toFixed(2)} meters`);
        console.log(`  Points: ${trail.num_points}`);
        console.log(`  Geometry: ${trail.geometry_text?.substring(0, 100)}...`);
        console.log('');
      });
    } catch (error) {
      console.log('No split_trails table created (no intersections found)');
    }

    // Test node creation using pgRouting's nodeNetwork
    console.log('\n=== Testing Node Network Creation ===');
    
    // First, let's create a simple 2D version for pgRouting
    await client.query(`
      CREATE TABLE ${stagingSchema}.trails_2d AS
      SELECT id, name, ST_Force2D(geometry) as geometry
      FROM ${stagingSchema}.trails
    `);

    // Use pgRouting's nodeNetwork function
    console.log('Running pgRouting nodeNetwork...');
    const nodeNetworkResult = await client.query(`
      SELECT * FROM public.pgr_nodeNetwork(
        '${stagingSchema}.trails_2d',
        0.0001,  -- tolerance in degrees (about 10 meters)
        'id',
        'geometry',
        'noded'
      )
    `);

    console.log('NodeNetwork result:', nodeNetworkResult.rows[0]);

    // Check the noded table
    console.log('\n=== Noded Network Results ===');
    const nodedCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails_2d_noded`);
    console.log(`Noded edges: ${nodedCount.rows[0].count}`);

    // Check what tables were created
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = $1 
      AND table_name LIKE '%noded%'
      ORDER BY table_name
    `, [stagingSchema]);
    
    console.log('Created tables:', tables.rows.map(r => r.table_name));

    // Try to find vertices table with different naming
    let verticesTable = null;
    for (const table of tables.rows) {
      if (table.table_name.includes('vertices')) {
        verticesTable = table.table_name;
        break;
      }
    }

    if (verticesTable) {
      const nodeCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.${verticesTable}`);
      console.log(`Noded vertices: ${nodeCount.rows[0].count}`);
    } else {
      console.log('No vertices table found');
    }

    // Show some sample noded edges
    console.log('\n=== Sample Noded Edges ===');
    const sampleNodedEdges = await client.query(`
      SELECT old_id, sub_id, ST_AsText(geometry) as geometry_text,
             ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails_2d_noded
      ORDER BY old_id, sub_id
      LIMIT 5
    `);

    sampleNodedEdges.rows.forEach((edge, index) => {
      console.log(`Noded Edge ${index + 1}:`);
      console.log(`  Original ID: ${edge.old_id}`);
      console.log(`  Sub ID: ${edge.sub_id}`);
      console.log(`  Length: ${edge.length_meters?.toFixed(2)} meters`);
      console.log(`  Geometry: ${edge.geometry_text?.substring(0, 100)}...`);
      console.log('');
    });

    // Show some sample vertices
    console.log('\n=== Sample Vertices ===');
    if (verticesTable) {
      const sampleVertices = await client.query(`
        SELECT id, cnt, ST_AsText(the_geom) as point_text
        FROM ${stagingSchema}.${verticesTable}
        ORDER BY id
        LIMIT 5
      `);

      sampleVertices.rows.forEach((vertex, index) => {
        console.log(`Vertex ${index + 1}:`);
        console.log(`  ID: ${vertex.id}`);
        console.log(`  Connected edges: ${vertex.cnt}`);
        console.log(`  Point: ${vertex.point_text}`);
        console.log('');
      });
    } else {
      console.log('No vertices table available');
    }

    // Export results to GeoJSON for visualization
    console.log('\n=== Exporting Results ===');
    
    // Export original trail
    const originalTrailGeoJSON = await client.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'name', name,
              'length_meters', ST_Length(geometry::geography)
            ),
            'geometry', ST_AsGeoJSON(geometry)::json
          )
        )
      ) as geojson
      FROM ${stagingSchema}.trails
    `);

    fs.writeFileSync('test-output/hogback-ridge-original.geojson', JSON.stringify(originalTrailGeoJSON.rows[0].geojson, null, 2));
    console.log('✅ Exported original trail to test-output/hogback-ridge-original.geojson');

    // Export split trails if any
    try {
      const splitTrailsCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.split_trails`);
      if (splitTrailsCount.rows[0].count > 0) {
        const splitTrailsGeoJSON = await client.query(`
          SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', json_agg(
              json_build_object(
                'type', 'Feature',
                'properties', json_build_object(
                  'id', id,
                  'name', name,
                  'length_meters', ST_Length(geometry::geography)
                ),
                'geometry', ST_AsGeoJSON(geometry)::json
              )
            )
          ) as geojson
          FROM ${stagingSchema}.split_trails
        `);

        fs.writeFileSync('test-output/hogback-ridge-split-trails.geojson', JSON.stringify(splitTrailsGeoJSON.rows[0].geojson, null, 2));
        console.log('✅ Exported split trails to test-output/hogback-ridge-split-trails.geojson');
      } else {
        console.log('No split trails to export');
      }
    } catch (error) {
      console.log('No split trails table exists');
    }

    // Export noded edges
    const nodedEdgesGeoJSON = await client.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'old_id', old_id,
              'sub_id', sub_id,
              'length_meters', ST_Length(geometry::geography)
            ),
            'geometry', ST_AsGeoJSON(geometry)::json
          )
        )
      ) as geojson
      FROM ${stagingSchema}.trails_2d_noded
    `);

    fs.writeFileSync('test-output/hogback-ridge-noded-edges.geojson', JSON.stringify(nodedEdgesGeoJSON.rows[0].geojson, null, 2));
    console.log('✅ Exported noded edges to test-output/hogback-ridge-noded-edges.geojson');

    // Export vertices
    if (verticesTable) {
      const verticesGeoJSON = await client.query(`
        SELECT json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'properties', json_build_object(
                'id', id,
                'connected_edges', cnt
              ),
              'geometry', ST_AsGeoJSON(the_geom)::json
            )
          )
        ) as geojson
        FROM ${stagingSchema}.${verticesTable}
      `);

      fs.writeFileSync('test-output/hogback-ridge-vertices.geojson', JSON.stringify(verticesGeoJSON.rows[0].geojson, null, 2));
      console.log('✅ Exported vertices to test-output/hogback-ridge-vertices.geojson');
    } else {
      console.log('No vertices table to export');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testHogbackRidgeSimple();
