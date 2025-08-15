import { Client } from 'pg';

const STAGING_SCHEMA = 'test_intersection_splitting_1234567890';

async function testIntersectionSplitting() {
  const client = new Client({
    host: 'localhost',
    user: 'carthorse',
    password: 'carthorse',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('🧪 Testing ST_Split intersection splitting...\n');

    // Step 1: Create fresh staging schema
    console.log(`📋 Creating fresh staging schema: ${STAGING_SCHEMA}`);
    await client.query(`DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${STAGING_SCHEMA}`);

    // Step 2: Create trails table
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails (
        id INTEGER PRIMARY KEY,
        old_id INTEGER,
        app_uuid TEXT,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        region TEXT,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB,
        osm_id TEXT
      )
    `);

    // Step 3: Copy COTREX trails from the bbox
    await client.query(`
      INSERT INTO ${STAGING_SCHEMA}.trails (
        id, old_id, app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      )
      SELECT 
        id, id as old_id, app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, osm_id
      FROM public.trails
      WHERE ST_Intersects(geometry, ST_MakeEnvelope(-105.29123174925316, 39.96928418458248, -105.28050515816028, 39.981172777276015, 4326))
        AND geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND source = 'cotrex'
    `);

    const trailCountResult = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
    console.log(`✅ Copied ${trailCountResult.rows[0].count} COTREX trails`);

        // Step 4: Simplify geometries (handle GeometryCollections)
    console.log('\n🔧 Step 4: Simplifying geometries...');
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.trails
      SET geometry = ST_CollectionExtract(geometry, 2)
      WHERE GeometryType(geometry) LIKE 'GEOMETRYCOLLECTION%'
    `);
    
    const simplifiedCount = await client.query(`
      SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails 
      WHERE GeometryType(geometry) LIKE 'GEOMETRYCOLLECTION%'
    `);
    console.log(`📊 Found ${simplifiedCount.rows[0].count} remaining GeometryCollections after simplification`);

    // Step 5: Create intersection points table
    console.log('\n🔍 Step 5: Creating intersection points table...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trail_intersections AS
      WITH intersection_dump AS (
        SELECT (ST_Dump(ST_Intersection(a.geometry, b.geometry))).geom AS geometry
        FROM ${STAGING_SCHEMA}.trails a
        JOIN ${STAGING_SCHEMA}.trails b
        ON a.id < b.id  -- prevent self-join duplicates
        WHERE ST_Intersects(a.geometry, b.geometry)
      )
      SELECT geometry FROM intersection_dump
      WHERE ST_GeometryType(geometry) = 'ST_Point'
    `);
    
    const intersectionCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trail_intersections`);
    console.log(`📊 Found ${intersectionCount.rows[0].count} intersection points`);

    // Step 6a: Simplify intersection points (handle GeometryCollections)
    console.log('\n🔧 Step 6a: Simplifying intersection points...');
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.trail_intersections
      SET geometry = ST_CollectionExtract(geometry, 1)
      WHERE GeometryType(geometry) LIKE 'GEOMETRYCOLLECTION%'
    `);
    
    const intersectionSimplifiedCount = await client.query(`
      SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trail_intersections 
      WHERE GeometryType(geometry) LIKE 'GEOMETRYCOLLECTION%'
    `);
    console.log(`📊 Found ${intersectionSimplifiedCount.rows[0].count} remaining GeometryCollections in intersection points`);

    // Step 6b: Create split trails table
    console.log('\n🔧 Step 6b: Creating split trails table...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_split AS
      SELECT a.id AS orig_id,
             (ST_Dump(ST_Split(a.geometry, ST_Collect(ti.geometry)))).geom AS geometry
      FROM ${STAGING_SCHEMA}.trails a
      LEFT JOIN ${STAGING_SCHEMA}.trail_intersections ti
      ON ST_Intersects(a.geometry, ti.geometry)
      GROUP BY a.id, a.geometry
    `);
    
    const splitCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_split`);
    console.log(`📊 Created ${splitCount.rows[0].count} split segments`);

    // Step 6c: Add source/target columns for pgRouting
    console.log('\n🔧 Step 6c: Adding source/target columns for pgRouting...');
    await client.query(`
      ALTER TABLE ${STAGING_SCHEMA}.trails_split ADD COLUMN source BIGINT;
      ALTER TABLE ${STAGING_SCHEMA}.trails_split ADD COLUMN target BIGINT;
    `);
    
    // Step 6d: Create topology
    console.log('\n🔧 Step 6d: Creating pgRouting topology...');
    await client.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.trails_split', 0.0001, 'geometry', 'id');
    `);
    
    // Check if topology was created successfully
    const topologyResult = await client.query(`
      SELECT COUNT(*) as edges FROM ${STAGING_SCHEMA}.trails_split
    `);
    console.log(`📊 Topology created: ${topologyResult.rows[0].edges} edges`);
    
    // Check for vertices table
    try {
      const verticesResult = await client.query(`
        SELECT COUNT(*) as vertices FROM ${STAGING_SCHEMA}.trails_split_vertices_pgr
      `);
      console.log(`📊 Vertices: ${verticesResult.rows[0].vertices} nodes`);
    } catch (error) {
      console.log(`⚠️ Vertices table not created: ${(error as Error).message}`);
    }

    // Step 7: Create results table
    console.log('\n📋 Step 7: Creating results table...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_split_results (
        original_id INTEGER,
        sub_id INTEGER,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Step 8: Insert split results with metadata
    console.log('\n🔧 Step 8: Inserting split results with metadata...');
    
    const splitResult = await client.query(`
      INSERT INTO ${STAGING_SCHEMA}.trails_split_results (
        original_id, sub_id, osm_id, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry
      )
      SELECT 
        ts.orig_id AS original_id,
        ROW_NUMBER() OVER (PARTITION BY ts.orig_id ORDER BY ST_Length(ts.geometry::geography) DESC) AS sub_id,
        t.osm_id,
        t.name,
        t.region,
        t.trail_type,
        t.surface,
        t.difficulty,
        ST_Length(ts.geometry::geography) / 1000 AS length_km,
        t.elevation_gain,
        t.elevation_loss,
        t.max_elevation,
        t.min_elevation,
        t.avg_elevation,
        t.bbox_min_lng,
        t.bbox_max_lng,
        t.bbox_min_lat,
        t.bbox_max_lat,
        t.source,
        t.source_tags,
        ts.geometry
      FROM ${STAGING_SCHEMA}.trails_split ts
      JOIN ${STAGING_SCHEMA}.trails t ON ts.orig_id = t.id
      WHERE ST_GeometryType(ts.geometry) = 'ST_LineString'
        AND ST_Length(ts.geometry::geography) > 1
      ORDER BY ts.orig_id, sub_id
    `);
    
    console.log(`✅ Split trails into ${splitResult.rowCount} segments`);

    // Step 7: Show results
    const resultsCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_split_results`);
    console.log(`\n📊 Results: ${resultsCount.rows[0].count} segments in trails_split_results`);

    const resultsDetails = await client.query(`
      SELECT original_id, sub_id, name, ST_Length(geometry::geography) as length_meters,
             ST_NumPoints(geometry) as num_points, ST_IsValid(geometry) as is_valid
      FROM ${STAGING_SCHEMA}.trails_split_results
      ORDER BY original_id, sub_id
    `);

    console.log('\n📋 Split results:');
    resultsDetails.rows.forEach(row => {
      console.log(`   Original ID ${row.original_id}, Sub ${row.sub_id}: ${row.name} - ${row.length_meters.toFixed(1)}m (${row.num_points} points, valid: ${row.is_valid})`);
    });

    // Step 8: Export results
    console.log('\n📤 Exporting results for visualization...');
    await exportResults(client);

  } catch (error) {
    console.error('❌ Error in test:', error);
  } finally {
    console.log(`🔍 Keeping schema ${STAGING_SCHEMA} for debugging`);
    await client.end();
  }
}

async function exportResults(client: Client) {
  try {
    const fs = require('fs');
    
    const result = await client.query(`
      SELECT 
        original_id,
        sub_id,
        osm_id,
        name,
        region,
        trail_type,
        surface,
        difficulty,
        length_km,
        ST_AsGeoJSON(ST_Force2D(geometry)) as geometry_json
      FROM ${STAGING_SCHEMA}.trails_split_results
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
      ORDER BY original_id, sub_id
    `);
    
    console.log(`📊 Found ${result.rows.length} trails in results`);
    
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row, index) => ({
        type: 'Feature',
        id: index,
        properties: {
          original_id: row.original_id,
          sub_id: row.sub_id,
          osm_id: row.osm_id,
          name: row.name,
          region: row.region,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          is_split: row.sub_id > 1 ? 'Yes' : 'No'
        },
        geometry: JSON.parse(row.geometry_json)
      }))
    };
    
    const outputFile = 'test-output/intersection-splitting-results.geojson';
    fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Exported ${result.rows.length} trails to ${outputFile}`);
    
    const originalTrails = new Set(result.rows.map(r => r.original_id).filter(id => id !== null));
    const splitTrails = result.rows.filter(r => r.sub_id > 1).length;
    const unsplitTrails = result.rows.filter(r => r.sub_id === 1).length;
    
    console.log('\n📋 Summary:');
    console.log(`   - Total segments: ${result.rows.length}`);
    console.log(`   - Original trail IDs: ${originalTrails.size}`);
    console.log(`   - Split segments: ${splitTrails}`);
    console.log(`   - Unsplit trails: ${unsplitTrails}`);
    
  } catch (error) {
    console.error('❌ Error exporting results:', error);
  }
}

// Run the test
testIntersectionSplitting().catch(console.error);
