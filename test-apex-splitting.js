const { Pool } = require('pg');

async function testApexSplitting() {
  const pool = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'carthorse'
  });

  const stagingSchema = 'test_apex_' + Date.now();
  console.log('🧪 Testing geometric apex splitting approach in schema:', stagingSchema);

  try {
    // Create test schema and copy Hogback Ridge trail
    await pool.query(`CREATE SCHEMA ${stagingSchema}`);
    await pool.query(`
      CREATE TABLE ${stagingSchema}.trails AS 
      SELECT app_uuid, name, geometry, length_km, elevation_gain, elevation_loss, 
             max_elevation, min_elevation, avg_elevation, trail_type, surface, difficulty,
             source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source
      FROM public.trails 
      WHERE name LIKE '%Hogback Ridge%' 
      LIMIT 1
    `);

    // Add original_trail_uuid column
    await pool.query(`ALTER TABLE ${stagingSchema}.trails ADD COLUMN original_trail_uuid TEXT`);

    console.log('📊 Initial trail count:', (await pool.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`)).rows[0].count);

    // Check if we have a loop
    const loopCheck = await pool.query(`
      SELECT app_uuid, name, 
             ST_IsSimple(ST_Force2D(geometry)) as is_simple,
             ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance
      FROM ${stagingSchema}.trails
    `);

    console.log('🔍 Loop analysis:', loopCheck.rows[0]);

    if (!loopCheck.rows[0].is_simple || loopCheck.rows[0].start_end_distance < 10) {
      console.log('✅ Trail detected as loop - testing apex splitting');
      
      // Test the new apex splitting approach - create split segments
      await pool.query(`
        CREATE TABLE ${stagingSchema}.loop_split_segments AS
        WITH loop_apex_split AS (
          SELECT 
            app_uuid as original_loop_uuid,
            name as original_name,
            geometry as original_geometry_3d,
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
            ) as apex_point,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            trail_type, surface, difficulty, source_tags, osm_id,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
          FROM ${stagingSchema}.trails
        ),
        split_geometries AS (
          SELECT 
            las.original_loop_uuid,
            las.original_name,
            las.original_geometry_3d,
            las.apex_point,
            -- Split the loop at the apex point using ST_Split
            ST_Split(las.original_geometry_3d, las.apex_point) as split_geom,
            las.length_km, las.elevation_gain, las.elevation_loss, las.max_elevation, 
            las.min_elevation, las.avg_elevation, las.trail_type, las.surface, las.difficulty,
            las.source_tags, las.osm_id, las.bbox_min_lng, las.bbox_max_lng, 
            las.bbox_min_lat, las.bbox_max_lat
          FROM loop_apex_split las
          WHERE las.apex_point IS NOT NULL
        ),
        split_segments AS (
          SELECT 
            sg.original_loop_uuid,
            ROW_NUMBER() OVER (PARTITION BY sg.original_loop_uuid ORDER BY ST_Length((ST_Dump(sg.split_geom)).geom) DESC) as segment_number,
            sg.original_name || ' (Segment ' || ROW_NUMBER() OVER (PARTITION BY sg.original_loop_uuid ORDER BY ST_Length((ST_Dump(sg.split_geom)).geom) DESC) || ')' as segment_name,
            (ST_Dump(sg.split_geom)).geom as segment_geometry,
            sg.length_km, sg.elevation_gain, sg.elevation_loss, sg.max_elevation, 
            sg.min_elevation, sg.avg_elevation, sg.trail_type, sg.surface, sg.difficulty,
            sg.source_tags, sg.osm_id, sg.bbox_min_lng, sg.bbox_max_lng, 
            sg.bbox_min_lat, sg.bbox_max_lat
          FROM split_geometries sg
        )
        SELECT 
          original_loop_uuid,
          segment_number,
          segment_name,
          ST_Force2D(segment_geometry) as geometry,
          ST_Force3D(segment_geometry) as geometry_3d,
          ST_Length(segment_geometry::geography) / 1000 as length_km,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          trail_type, surface, difficulty, source_tags, osm_id,
          ST_XMin(segment_geometry) as bbox_min_lng,
          ST_XMax(segment_geometry) as bbox_max_lng,
          ST_YMin(segment_geometry) as bbox_min_lat,
          ST_YMax(segment_geometry) as bbox_max_lat,
          'apex' as split_type
        FROM split_segments
        WHERE ST_GeometryType(segment_geometry) = 'ST_LineString'
          AND ST_Length(segment_geometry::geography) > 5
      `);

      const segmentResult = await pool.query(`SELECT * FROM ${stagingSchema}.loop_split_segments`);
      console.log('🎯 Apex splitting results:');
      console.log('Number of segments:', segmentResult.rows.length);
      segmentResult.rows.forEach(row => {
        console.log(`  - ${row.segment_name}: ${row.length_km.toFixed(2)}km`);
      });

      // Now test the complete flow: insert segments and delete original
      await pool.query(`BEGIN`);
      
      // Insert new segments
      await pool.query(`
        INSERT INTO ${stagingSchema}.trails (
          app_uuid, original_trail_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, trail_type, surface, difficulty,
          source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          original_loop_uuid as original_trail_uuid,
          segment_name as name,
          ST_Force3D(geometry) as geometry,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          trail_type, surface, difficulty, source_tags, osm_id,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
        FROM ${stagingSchema}.loop_split_segments
      `);

      // Delete the original loop trail
      const deleteResult = await pool.query(`
        DELETE FROM ${stagingSchema}.trails 
        WHERE app_uuid IN (
          SELECT original_loop_uuid FROM ${stagingSchema}.loop_split_segments
        )
        RETURNING app_uuid, name
      `);

      await pool.query(`COMMIT`);

      console.log('🗑️ Deleted original trails:', deleteResult.rows.map(r => r.name));

      const finalCount = await pool.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
      console.log('📊 Final trail count:', finalCount.rows[0].count);

      const remainingTrails = await pool.query(`
        SELECT name, original_trail_uuid, 
               CASE WHEN original_trail_uuid IS NULL THEN 'original' ELSE 'split_segment' END as trail_type
        FROM ${stagingSchema}.trails
        ORDER BY name
      `);
      
      console.log('🏔️ Remaining trails:');
      remainingTrails.rows.forEach(row => {
        console.log(`  - ${row.name} (${row.trail_type})`);
      });

    } else {
      console.log('❌ Trail is not detected as a loop');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await pool.query(`ROLLBACK`).catch(() => {});
  } finally {
    // Cleanup
    try {
      await pool.query(`DROP SCHEMA ${stagingSchema} CASCADE`);
      console.log('🧹 Cleaned up test schema');
    } catch (e) {}
    
    await pool.end();
  }
}

testApexSplitting();
