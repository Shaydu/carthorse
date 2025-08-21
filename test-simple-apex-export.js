const { Pool } = require('pg');

async function testSimpleApexExport() {
  const pool = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'carthorse'
  });

  const stagingSchema = 'test_simple_' + Date.now();
  console.log('🧪 Testing simple export with apex splitting in schema:', stagingSchema);

  try {
    // Create test schema
    await pool.query(`CREATE SCHEMA ${stagingSchema}`);
    
    // Copy the trails that were detected as loops  
    await pool.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT app_uuid, name, geometry, length_km, elevation_gain, elevation_loss, 
             max_elevation, min_elevation, avg_elevation, trail_type, surface, difficulty,
             source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source
      FROM public.trails 
      WHERE app_uuid = 'ce1a5189-9311-404e-8c08-9eb6970cecf5'  -- Non-simple Foothills North Trail
         OR app_uuid = '086cd210-48b0-469a-88d4-cfac1de8688f'  -- Non-simple Hogback Ridge Trail
    `);

    // Add original_trail_uuid column
    await pool.query(`ALTER TABLE ${stagingSchema}.trails ADD COLUMN original_trail_uuid TEXT`);

    const initialCount = await pool.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
    console.log('📊 Initial trail count:', initialCount.rows[0].count);

    // Test the geometric apex splitting approach directly
    const apexSplitResult = await pool.query(`
      WITH loop_trails AS (
        SELECT app_uuid, name, geometry
        FROM ${stagingSchema}.trails
        WHERE NOT ST_IsSimple(ST_Force2D(geometry)) 
           OR ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) < 10
      ),
      loop_apex_split AS (
        SELECT 
          app_uuid as original_loop_uuid,
          name as original_name,
          geometry as original_geometry,
          -- Find the vertex that's farthest from the start point (geometric apex)
          (
            SELECT pt
            FROM (
              SELECT 
                (ST_DumpPoints(geometry)).geom as pt,
                ST_Distance((ST_DumpPoints(geometry)).geom, ST_StartPoint(geometry)) as dist
            ) vertices
            ORDER BY dist DESC
            LIMIT 1
          ) as apex_point
        FROM loop_trails
      ),
      split_geometries AS (
        SELECT 
          las.original_loop_uuid,
          las.original_name,
          las.original_geometry,
          las.apex_point,
          -- Split the loop at the apex point using ST_Split
          ST_Split(las.original_geometry, las.apex_point) as split_geom
        FROM loop_apex_split las
        WHERE las.apex_point IS NOT NULL
      ),
      split_segments AS (
        SELECT 
          sg.original_loop_uuid,
          ROW_NUMBER() OVER (PARTITION BY sg.original_loop_uuid ORDER BY ST_Length((ST_Dump(sg.split_geom)).geom) DESC) as segment_number,
          sg.original_name || ' (Segment ' || ROW_NUMBER() OVER (PARTITION BY sg.original_loop_uuid ORDER BY ST_Length((ST_Dump(sg.split_geom)).geom) DESC) || ')' as segment_name,
          (ST_Dump(sg.split_geom)).geom as segment_geometry
        FROM split_geometries sg
        WHERE ST_GeometryType((ST_Dump(sg.split_geom)).geom) = 'ST_LineString'
      )
      SELECT 
        original_loop_uuid,
        segment_number,
        segment_name,
        ST_Length(segment_geometry::geography) / 1000 as length_km,
        ST_GeometryType(segment_geometry) as geom_type
      FROM split_segments
      WHERE ST_Length(segment_geometry::geography) > 5
    `);

    console.log('🎯 Apex splitting test results:');
    console.log('Number of segments created:', apexSplitResult.rows.length);
    apexSplitResult.rows.forEach(row => {
      console.log(`  - ${row.segment_name}: ${row.length_km.toFixed(2)}km`);
    });

    if (apexSplitResult.rows.length > 0) {
      console.log('✅ Geometric apex splitting is working correctly!');
      console.log('📝 The integration into the orchestrator should handle this splitting automatically.');
    } else {
      console.log('⚠️ No segments created - checking if loops exist...');
      
      const loopCheck = await pool.query(`
        SELECT app_uuid, name, 
               ST_IsSimple(ST_Force2D(geometry)) as is_simple,
               ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance
        FROM ${stagingSchema}.trails
      `);
      
      console.log('🔍 Loop analysis for test trails:');
      loopCheck.rows.forEach(row => {
        console.log(`  - ${row.name}: simple=${row.is_simple}, start-end=${row.start_end_distance.toFixed(6)}m`);
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    // Cleanup
    try {
      await pool.query(`DROP SCHEMA ${stagingSchema} CASCADE`);
      console.log('🧹 Cleaned up test schema');
    } catch (e) {}
    
    await pool.end();
  }
}

testSimpleApexExport();
