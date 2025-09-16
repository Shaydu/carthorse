const { Client } = require('pg');
const fs = require('fs');

async function testHogbackRidgeNoding() {
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
    const stagingSchema = `test_hogback_ridge_${Date.now()}`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Create staging tables
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

    // Create required tables for enhanced functions
    await client.query(`
      CREATE TABLE ${stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters REAL
      )
    `);

    await client.query(`
      CREATE TABLE ${stagingSchema}.split_trails (
        id SERIAL PRIMARY KEY,
        original_trail_id INTEGER,
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

    // Test intersection splitting
    console.log('\n=== Testing Intersection Splitting ===');
    const splitResult = await client.query(`
      SELECT * FROM public.replace_trails_with_split_trails_enhanced($1, $2)
    `, [stagingSchema, 2.0]);

    console.log('Split result:', splitResult.rows[0]);

    // Check what was created in the split_trails table
    console.log('\n=== Split Trails Results ===');
    const splitTrails = await client.query(`
      SELECT id, name, ST_AsText(geometry) as geometry_text,
             ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points,
             original_trail_id
      FROM ${stagingSchema}.split_trails
      ORDER BY id
    `);

    console.log(`Found ${splitTrails.rows.length} split trails:`);
    splitTrails.rows.forEach((trail, index) => {
      console.log(`Split Trail ${index + 1}:`);
      console.log(`  ID: ${trail.id}`);
      console.log(`  Name: ${trail.name}`);
      console.log(`  Original Trail ID: ${trail.original_trail_id}`);
      console.log(`  Length: ${trail.length_meters?.toFixed(2)} meters`);
      console.log(`  Points: ${trail.num_points}`);
      console.log(`  Geometry: ${trail.geometry_text?.substring(0, 100)}...`);
      console.log('');
    });

    // Test node and edge creation
    console.log('\n=== Testing Node and Edge Creation ===');
    
    // Create nodes table
    await client.query(`
      CREATE TABLE ${stagingSchema}.nodes (
        id SERIAL PRIMARY KEY,
        point GEOMETRY(POINT, 4326),
        point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters REAL
      )
    `);

    // Create edges table
    await client.query(`
      CREATE TABLE ${stagingSchema}.edges (
        id SERIAL PRIMARY KEY,
        source_node_id INTEGER,
        target_node_id INTEGER,
        trail_id INTEGER,
        trail_name TEXT,
        geometry GEOMETRY(LINESTRING, 4326),
        length_meters REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL
      )
    `);

    // Run node creation
    console.log('Creating nodes...');
    const nodeResult = await client.query(`
      SELECT * FROM public.generate_routing_nodes_native($1, $2)
    `, [stagingSchema, 2.0]);

    console.log(`Node creation result:`, nodeResult.rows[0]);

    // Run edge creation
    console.log('Creating edges...');
    const edgeResult = await client.query(`
      SELECT * FROM public.generate_routing_edges_native($1, $2)
    `, [stagingSchema, 2.0]);

    console.log(`Edge creation result:`, edgeResult.rows[0]);

    console.log(`Created ${edgeResult.rows.length} edges`);

    // Show final results
    console.log('\n=== Final Node and Edge Summary ===');
    const nodeCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_nodes`);
    const edgeCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.routing_edges`);
    
    console.log(`Nodes: ${nodeCount.rows[0].count}`);
    console.log(`Edges: ${edgeCount.rows[0].count}`);

    // Show some sample nodes
    console.log('\n=== Sample Nodes ===');
    const sampleNodes = await client.query(`
      SELECT id, ST_AsText(the_geom) as point_text, cnt as connected_trail_count
      FROM ${stagingSchema}.routing_nodes
      ORDER BY id
      LIMIT 5
    `);

    sampleNodes.rows.forEach((node, index) => {
      console.log(`Node ${index + 1}:`);
      console.log(`  ID: ${node.id}`);
      console.log(`  Point: ${node.point_text}`);
      console.log(`  Connected Trails: ${node.connected_trail_count}`);
      console.log('');
    });

    // Show some sample edges
    console.log('\n=== Sample Edges ===');
    const sampleEdges = await client.query(`
      SELECT id, source, target, name, 
             ST_Length(the_geom::geography) as length_meters
      FROM ${stagingSchema}.routing_edges
      ORDER BY id
      LIMIT 5
    `);

    sampleEdges.rows.forEach((edge, index) => {
      console.log(`Edge ${index + 1}:`);
      console.log(`  ID: ${edge.id}`);
      console.log(`  Source Node: ${edge.source_node_id}`);
      console.log(`  Target Node: ${edge.target_node_id}`);
      console.log(`  Trail: ${edge.trail_name}`);
      console.log(`  Length: ${edge.length_meters?.toFixed(2)} meters`);
      console.log('');
    });

    // Export results to GeoJSON for visualization
    console.log('\n=== Exporting Results ===');
    
    // Export split trails
    const splitTrailsGeoJSON = await client.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'name', name,
              'original_trail_id', original_trail_id,
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

    // Export nodes
    const nodesGeoJSON = await client.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'connected_trail_count', cnt
            ),
            'geometry', ST_AsGeoJSON(the_geom)::json
          )
        )
      ) as geojson
      FROM ${stagingSchema}.routing_nodes
    `);

    fs.writeFileSync('test-output/hogback-ridge-nodes.geojson', JSON.stringify(nodesGeoJSON.rows[0].geojson, null, 2));
    console.log('✅ Exported nodes to test-output/hogback-ridge-nodes.geojson');

    // Export edges
    const edgesGeoJSON = await client.query(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
          json_build_object(
            'type', 'Feature',
            'properties', json_build_object(
              'id', id,
              'source', source,
              'target', target,
              'name', name,
              'length_meters', ST_Length(the_geom::geography)
            ),
            'geometry', ST_AsGeoJSON(the_geom)::json
          )
        )
      ) as geojson
      FROM ${stagingSchema}.routing_edges
    `);

    fs.writeFileSync('test-output/hogback-ridge-edges.geojson', JSON.stringify(edgesGeoJSON.rows[0].geojson, null, 2));
    console.log('✅ Exported edges to test-output/hogback-ridge-edges.geojson');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testHogbackRidgeNoding();
