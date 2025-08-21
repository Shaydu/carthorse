const fs = require('fs');
const { Pool } = require('pg');

// Configuration - using the same settings as the main application
const config = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'tester',
  password: process.env.PGPASSWORD || '',
};

// Test parameters to try
  const testParams = [
    { name: 'default', intersectionTolerance: 2, edgeToVertexTolerance: 2, minTrailLengthMeters: 0.1 },
    // { name: 'loose', intersectionTolerance: 5, edgeToVertexTolerance: 5, minTrailLengthMeters: 0.1 },
    // { name: 'tight', intersectionTolerance: 1, edgeToVertexTolerance: 1, minTrailLengthMeters: 0.1 },
    // { name: 'very_loose', intersectionTolerance: 10, edgeToVertexTolerance: 10, minTrailLengthMeters: 0.1 },
    // { name: 'no_length_filter', intersectionTolerance: 2, edgeToVertexTolerance: 2, minTrailLengthMeters: 0 },
  ];

async function main() {
  const pool = new Pool(config);
  
  try {
    console.log('🔍 Debugging Hogback Ridge Trail Layer 2 conversion...');
    
    // Step 1: Extract Hogback Ridge Trail and surrounding trails from GeoJSON
    console.log('\n📊 Step 1: Extracting Hogback Ridge Trail and surrounding trails from GeoJSON...');
    const trails = await extractHogbackAndSurroundingTrailsFromGeoJSON();
    
    console.log(`✅ Found ${trails.length} trails in the area`);
    console.log('Trails found:');
    trails.forEach(trail => {
      console.log(`  - ${trail.name} (${trail.length_km?.toFixed(2)}km, ${trail.geometry_type})`);
    });
    
    // Step 2: Test each parameter set
    for (const params of testParams) {
      console.log(`\n🧪 Testing parameters: ${params.name}`);
      console.log(`  - intersectionTolerance: ${params.intersectionTolerance}m`);
      console.log(`  - edgeToVertexTolerance: ${params.edgeToVertexTolerance}m`);
      console.log(`  - minTrailLengthMeters: ${params.minTrailLengthMeters}m`);
      
      const result = await testPgRoutingConversion(pool, trails, params);
      
      console.log(`  ✅ Result: ${result.nodes} nodes, ${result.edges} edges`);
      if (result.hogbackFound) {
        console.log(`  🎯 Hogback Ridge Trail found in edges!`);
      } else {
        console.log(`  ❌ Hogback Ridge Trail NOT found in edges`);
      }
      
      // Check geometry issues
      if (result.geometryIssues.length > 0) {
        console.log(`  ⚠️ Geometry issues found:`);
        result.geometryIssues.forEach(issue => {
          console.log(`    - ${issue.name}: ${issue.issue}`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

async function extractHogbackAndSurroundingTrailsFromGeoJSON() {
  const geojsonFile = 'test-output/boulder-fixed-deletion-test-layer1-trails-layer1-trails.geojson';
  
  if (!fs.existsSync(geojsonFile)) {
    throw new Error(`GeoJSON file not found: ${geojsonFile}`);
  }
  
  const geojsonData = JSON.parse(fs.readFileSync(geojsonFile, 'utf8'));
  const trails = [];
  
  for (const feature of geojsonData.features) {
    const props = feature.properties;
    const geometry = feature.geometry;
    
    // Filter for trails in the EXPANDED Hogback Ridge area (includes more connected trails)
    if (props.bbox_min_lng >= -105.32 && 
        props.bbox_max_lng <= -105.27 &&
        props.bbox_min_lat >= 40.04 && 
        props.bbox_max_lat <= 40.10) {
      
      trails.push({
        app_uuid: props.id,
        name: props.name,
        trail_type: props.trail_type,
        surface: props.surface_type,
        difficulty: props.difficulty,
        elevation_gain: props.elevation_gain,
        elevation_loss: props.elevation_loss,
        max_elevation: props.max_elevation,
        min_elevation: props.min_elevation,
        avg_elevation: props.avg_elevation,
        source: props.source,
        source_tags: props.source_tags,
        osm_id: props.osm_id,
        bbox_min_lng: props.bbox_min_lng,
        bbox_max_lng: props.bbox_max_lng,
        bbox_min_lat: props.bbox_min_lat,
        bbox_max_lat: props.bbox_max_lat,
        length_km: props.length_km,
        geometry: geometry,
        geometry_type: geometry.type,
        is_valid: true, // Assume valid from GeoJSON
        is_simple: true, // Assume simple from GeoJSON
        length_meters: props.length_km ? props.length_km * 1000 : null
      });
    }
  }
  
  return trails.sort((a, b) => (b.length_km || 0) - (a.length_km || 0));
}

async function testPgRoutingConversion(pool, trails, params) {
  const testSchema = `test_hogback_${Date.now()}`;
  
  try {
    // Create test schema
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${testSchema}`);
    
    // Use ALL trails in the expanded area to test connected network
    const allTrails = trails;
    console.log(`  📊 Testing ${allTrails.length} trails in expanded area (including Hogback Ridge Trail)`);
    
    // Log the trail names to see what's in the network
    console.log(`  📋 Trails in network:`);
    allTrails.forEach((trail, i) => {
      console.log(`    ${i+1}. ${trail.name} (${trail.length_km?.toFixed(3) || 'N/A'} km)`);
    });
    
    // Check if Hogback Ridge Trail is a loop
    const hogbackTrails = allTrails.filter(t => t.name.includes('Hogback Ridge Trail'));
    if (hogbackTrails.length > 0) {
      console.log(`  🔍 Hogback Ridge Trail analysis:`);
      hogbackTrails.forEach((trail, i) => {
        console.log(`    ${i+1}. ${trail.name}:`);
        console.log(`       - Length: ${trail.length_km?.toFixed(3) || 'N/A'} km`);
        console.log(`       - Geometry type: ${trail.geometry.type}`);
        console.log(`       - Coordinates count: ${trail.geometry.coordinates.length}`);
        
        // Check if it's a loop by examining start/end points
        const coords = trail.geometry.coordinates;
        if (coords.length > 0) {
          const start = coords[0];
          const end = coords[coords.length - 1];
          const distance = Math.sqrt(
            Math.pow(start[0] - end[0], 2) + Math.pow(start[1] - end[1], 2)
          );
          console.log(`       - Start point: [${start[0].toFixed(6)}, ${start[1].toFixed(6)}]`);
          console.log(`       - End point: [${end[0].toFixed(6)}, ${end[1].toFixed(6)}]`);
          console.log(`       - Start-end distance: ${distance.toFixed(6)} degrees`);
          console.log(`       - Is loop (distance < 0.001): ${distance < 0.001}`);
        }
      });
    }
    
    if (allTrails.length === 0) {
      return {
        nodes: 0,
        edges: 0,
        hogbackFound: false,
        geometryIssues: []
      };
    }
    
    // Test both 3D and 2D geometry approaches
    const use3D = params.name === 'default'; // Only test 3D for the first parameter set
    
    // Create a proper pgRouting-compatible ways table that matches the main system
    console.log(`  🔧 Testing with pgRouting-compatible table structure`);
    await pool.query(`
      CREATE TABLE ${testSchema}.ways (
        id INTEGER PRIMARY KEY,
        name TEXT,
        length_km REAL,
        the_geom GEOMETRY(LINESTRING, 4326),
        cost DOUBLE PRECISION,
        reverse_cost DOUBLE PRECISION
      )
    `);
    
    for (let i = 0; i < allTrails.length; i++) {
      const trail = allTrails[i];
      const geomJson = JSON.stringify(trail.geometry);
      
      await pool.query(`
        INSERT INTO ${testSchema}.ways (id, name, length_km, the_geom, cost, reverse_cost)
        VALUES ($1, $2, $3, ST_Force2D(ST_GeomFromGeoJSON($4)), $5, $6)
      `, [i + 1, trail.name, trail.length_km || 0, geomJson, trail.length_km || 1, trail.length_km || 1]);
    }
    
    // Debug: Check geometry validity before topology creation
    const geometryCheck = await pool.query(`
      SELECT 
        id, name,
        ST_IsValid(the_geom) as is_valid,
        ST_IsSimple(the_geom) as is_simple,
        ST_GeometryType(the_geom) as geom_type,
        ST_Length(the_geom::geography) as length_meters,
        ST_NumPoints(the_geom) as num_points
      FROM ${testSchema}.ways
    `);
    
    console.log(`  🔍 Geometry check:`);
    geometryCheck.rows.forEach(row => {
      console.log(`    - ${row.name}: valid=${row.is_valid}, simple=${row.is_simple}, type=${row.geom_type}, length=${row.length_meters?.toFixed(1)}m, points=${row.num_points}`);
    });
    
    // Create topology
    const topologyResult = await pool.query(`
      SELECT pgr_createTopology('${testSchema}.ways', ${params.edgeToVertexTolerance}, 'the_geom', 'id')
    `);
    
    console.log(`  📊 Topology result: ${JSON.stringify(topologyResult.rows[0])}`);
    
    // If topology failed, check for specific issues
    if (topologyResult.rows[0].pgr_createtopology === 'FAIL') {
      console.log(`  🔍 Investigating topology failure...`);
      
      // Check if any geometries are null or empty
      const nullCheck = await pool.query(`
        SELECT COUNT(*) as count 
        FROM ${testSchema}.ways 
        WHERE the_geom IS NULL OR ST_IsEmpty(the_geom)
      `);
      console.log(`    - Null/empty geometries: ${nullCheck.rows[0].count}`);
      
      // Check for very short geometries
      const shortCheck = await pool.query(`
        SELECT COUNT(*) as count 
        FROM ${testSchema}.ways 
        WHERE ST_Length(the_geom::geography) < 1.0
      `);
      console.log(`    - Very short geometries (<1m): ${shortCheck.rows[0].count}`);
      
      // Check coordinate bounds
      const boundsCheck = await pool.query(`
        SELECT 
          ST_XMin(ST_Extent(the_geom)) as min_x,
          ST_XMax(ST_Extent(the_geom)) as max_x,
          ST_YMin(ST_Extent(the_geom)) as min_y,
          ST_YMax(ST_Extent(the_geom)) as max_y
        FROM ${testSchema}.ways
      `);
      console.log(`    - Coordinate bounds: X=${boundsCheck.rows[0].min_x?.toFixed(6)} to ${boundsCheck.rows[0].max_x?.toFixed(6)}, Y=${boundsCheck.rows[0].min_y?.toFixed(6)} to ${boundsCheck.rows[0].max_y?.toFixed(6)}`);
      
      // Check connectivity between the two segments 
      const connectivityCheck = await pool.query(`
        WITH endpoints AS (
          SELECT 
            id, name,
            ST_StartPoint(the_geom) as start_pt,
            ST_EndPoint(the_geom) as end_pt
          FROM ${testSchema}.ways
        )
        SELECT 
          a.name as trail1, b.name as trail2,
          ST_Distance(a.start_pt, b.start_pt) as start_to_start,
          ST_Distance(a.start_pt, b.end_pt) as start_to_end,
          ST_Distance(a.end_pt, b.start_pt) as end_to_start,
          ST_Distance(a.end_pt, b.end_pt) as end_to_end,
          CASE 
            WHEN ST_DWithin(a.start_pt, b.start_pt, ${params.edgeToVertexTolerance}) OR
                 ST_DWithin(a.start_pt, b.end_pt, ${params.edgeToVertexTolerance}) OR
                 ST_DWithin(a.end_pt, b.start_pt, ${params.edgeToVertexTolerance}) OR
                 ST_DWithin(a.end_pt, b.end_pt, ${params.edgeToVertexTolerance})
            THEN true ELSE false 
          END as connected_within_tolerance
        FROM endpoints a, endpoints b 
        WHERE a.id < b.id
      `);
      
      connectivityCheck.rows.forEach(row => {
        console.log(`    - Connection ${row.trail1} <-> ${row.trail2}: connected=${row.connected_within_tolerance}, min_dist=${Math.min(row.start_to_start, row.start_to_end, row.end_to_start, row.end_to_end).toFixed(2)}m`);
      });
      
      // Test with a single geometry to see if that works
      console.log(`  🧪 Testing with single geometry...`);
      const singleTestResult = await pool.query(`
        CREATE TABLE ${testSchema}.ways_single AS 
        SELECT * FROM ${testSchema}.ways LIMIT 1
      `);
      
      const singleTopologyResult = await pool.query(`
        SELECT pgr_createTopology('${testSchema}.ways_single', ${params.edgeToVertexTolerance}, 'the_geom', 'id')
      `);
      console.log(`    - Single geometry topology result: ${JSON.stringify(singleTopologyResult.rows[0])}`);
      
      await pool.query(`DROP TABLE IF EXISTS ${testSchema}.ways_single`);
      
      // Test what happens when we apply the main system's geometry processing
      console.log(`  🔧 Testing main system geometry processing...`);
      const mainSystemProcessing = await pool.query(`
        SELECT 
          name,
          ST_IsSimple(ST_GeomFromGeoJSON($1)) as is_simple,
          ST_IsValid(ST_GeomFromGeoJSON($1)) as is_valid,
          CASE 
            WHEN ST_IsSimple(ST_GeomFromGeoJSON($1)) THEN 'ST_Force2D(geometry)'
            ELSE 'ST_Force2D(ST_MakeValid(geometry))'
          END as processing_method,
          CASE 
            WHEN ST_IsSimple(ST_GeomFromGeoJSON($1)) THEN ST_Force2D(ST_GeomFromGeoJSON($1))
            ELSE ST_Force2D(ST_MakeValid(ST_GeomFromGeoJSON($1)))
          END as processed_geometry
        FROM (SELECT 'Hogback Ridge Trail' as name) t
      `, [JSON.stringify(hogbackTrails[0].geometry)]);
      
      console.log(`    - Original geometry is simple: ${mainSystemProcessing.rows[0].is_simple}`);
      console.log(`    - Original geometry is valid: ${mainSystemProcessing.rows[0].is_valid}`);
      console.log(`    - Processing method: ${mainSystemProcessing.rows[0].processing_method}`);
      
      // Check what the processed geometry looks like
      const processedGeom = mainSystemProcessing.rows[0].processed_geometry;
      if (processedGeom) {
        const processedInfo = await pool.query(`
          SELECT 
            ST_GeometryType($1) as geom_type,
            ST_NumGeometries($1) as num_geometries,
            ST_NumPoints($1) as num_points,
            ST_IsValid($1) as is_valid,
            ST_IsSimple($1) as is_simple
        `, [processedGeom]);
        
        console.log(`    - Processed geometry type: ${processedInfo.rows[0].geom_type}`);
        console.log(`    - Processed geometry count: ${processedInfo.rows[0].num_geometries}`);
        console.log(`    - Processed points count: ${processedInfo.rows[0].num_points}`);
        console.log(`    - Processed is valid: ${processedInfo.rows[0].is_valid}`);
        console.log(`    - Processed is simple: ${processedInfo.rows[0].is_simple}`);
      }
      
      // Test if pgRouting extension is available
      console.log(`  🔧 Checking pgRouting extension availability...`);
      try {
        const extensionCheck = await pool.query(`
          SELECT extname, extversion 
          FROM pg_extension 
          WHERE extname = 'pgrouting'
        `);
        
        if (extensionCheck.rows.length > 0) {
          console.log(`    - pgRouting extension found: version ${extensionCheck.rows[0].extversion}`);
        } else {
          console.log(`    - ❌ pgRouting extension NOT installed`);
        }
        
        // Check available pgRouting functions
        const functionsCheck = await pool.query(`
          SELECT proname 
          FROM pg_proc 
          WHERE proname LIKE 'pgr_%' 
          ORDER BY proname 
          LIMIT 10
        `);
        
        if (functionsCheck.rows.length > 0) {
          console.log(`    - pgRouting functions available: ${functionsCheck.rows.map(r => r.proname).join(', ')}`);
        } else {
          console.log(`    - ❌ No pgRouting functions found`);
        }
        
      } catch (err) {
        console.log(`    - Error checking pgRouting: ${err.message}`);
      }
    }
    
    // Check results
    const waysResult = await pool.query(`SELECT COUNT(*) as count FROM ${testSchema}.ways`);
    
    let verticesResult = { rows: [{ count: 0 }] };
    try {
      verticesResult = await pool.query(`SELECT COUNT(*) as count FROM ${testSchema}.ways_vertices_pgr`);
    } catch (error) {
      console.log(`  ⚠️ Vertices table doesn't exist (topology creation failed)`);
    }
    
    const hogbackResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${testSchema}.ways 
      WHERE name ILIKE '%hogback%'
    `);
    
    // Check for geometry issues
    const geometryIssues = await pool.query(`
      SELECT 
        name,
        CASE 
          WHEN NOT ST_IsValid(the_geom) THEN 'Invalid geometry'
          WHEN NOT ST_IsSimple(the_geom) THEN 'Not simple (self-intersecting)'
          WHEN ST_Length(the_geom::geography) <= $1 THEN 'Too short'
          ELSE 'Unknown issue'
        END as issue
      FROM ${testSchema}.ways
      WHERE NOT ST_IsValid(the_geom) 
         OR NOT ST_IsSimple(the_geom)
         OR ST_Length(the_geom::geography) <= $1
    `, [params.minTrailLengthMeters]);
    
    return {
      nodes: parseInt(verticesResult.rows[0].count),
      edges: parseInt(waysResult.rows[0].count),
      hogbackFound: parseInt(hogbackResult.rows[0].count) > 0,
      geometryIssues: geometryIssues.rows
    };
    
  } finally {
    // Clean up test schema
    await pool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
  }
}

// Run the test
main().catch(console.error);
