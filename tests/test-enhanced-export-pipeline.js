const { Client } = require('pg');
const fs = require('fs');

async function testEnhancedExportPipeline() {
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

    // Install the enhanced function
    const functionSql = fs.readFileSync('sql/organized/functions/enhanced-intersection-splitting.sql', 'utf8');
    await client.query(functionSql);
    console.log('✅ Enhanced function installed');

    // Create a staging schema for testing
    const stagingSchema = `test_enhanced_pipeline_${Date.now()}`;
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

    // Copy trails from the larger bbox area to staging
    console.log('Copying trails from larger bbox to staging...');
    const bbox = [-105.30958159914027, 40.07269607609242, -105.26885500804738, 40.09658466878596];
    
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
        AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      LIMIT 50  -- Limit for testing
    `, bbox);

    const trailCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} trails to staging`);

    // Test the enhanced intersection splitting
    console.log('\nTesting enhanced intersection splitting...');
    const result = await client.query(`
      SELECT * FROM public.replace_trails_with_split_trails_enhanced($1, $2)
    `, [stagingSchema, 2.0]);

    console.log('Enhanced function result:', result.rows[0]);

    // Analyze the results
    const splitTrails = await client.query(`
      SELECT 
        name,
        COUNT(*) as segment_count,
        SUM(ST_Length(geometry::geography)) as total_length_meters,
        AVG(ST_Length(geometry::geography)) as avg_segment_length_meters
      FROM ${stagingSchema}.trails
      GROUP BY name
      ORDER BY total_length_meters DESC
      LIMIT 10
    `);

    console.log('\nTop 10 trails by total length after splitting:');
    splitTrails.rows.forEach((row, i) => {
      console.log(`${i + 1}. ${row.name}: ${row.segment_count} segments, ${row.total_length_meters.toFixed(1)}m total, ${row.avg_segment_length_meters.toFixed(1)}m avg`);
    });

    // Check for specific trails we know should intersect
    const specificTrails = await client.query(`
      SELECT name, COUNT(*) as segment_count, SUM(ST_Length(geometry::geography)) as total_length
      FROM ${stagingSchema}.trails
      WHERE name LIKE '%North Sky%' OR name LIKE '%Foothills North%' OR name LIKE '%Hogback%'
      GROUP BY name
      ORDER BY name
    `);

    console.log('\nSpecific trails of interest:');
    specificTrails.rows.forEach(row => {
      console.log(`  ${row.name}: ${row.segment_count} segments, ${row.total_length.toFixed(1)}m total`);
    });

    // Export results to GeoJSON for visualization
    const geojsonTrails = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_AsGeoJSON(geometry)::json as geometry
      FROM ${stagingSchema}.trails
      ORDER BY name
    `);

    const geojsonFeatures = geojsonTrails.rows.map(row => ({
      type: "Feature",
      properties: {
        app_uuid: row.app_uuid,
        name: row.name,
        length_meters: row.length_meters
      },
      geometry: row.geometry
    }));

    const geojson = {
      type: "FeatureCollection",
      features: geojsonFeatures
    };

    fs.writeFileSync('test-output/enhanced-split-trails.geojson', JSON.stringify(geojson, null, 2));
    console.log('\n✅ Exported split trails to test-output/enhanced-split-trails.geojson');

    // Clean up
    await client.query(`DROP SCHEMA ${stagingSchema} CASCADE`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testEnhancedExportPipeline().catch(console.error);

