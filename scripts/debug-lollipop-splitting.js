const { Client } = require('pg');

async function debugLollipopSplitting() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('🔍 Debugging lollipop splitting...');

    // Check if the lollipop trail exists in public.trails
    const lollipopCheck = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_IsSimple(geometry) as is_simple,
        ST_GeometryType(geometry) as geom_type,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance
      FROM public.trails 
      WHERE app_uuid = 'b43a9490-6651-428e-b5e4-fb2ffce3b220'
    `);

    if (lollipopCheck.rows.length === 0) {
      console.log('❌ Lollipop trail not found in public.trails');
      return;
    }

    const lollipop = lollipopCheck.rows[0];
    console.log('🔍 Lollipop trail found:');
    console.log(`   - Name: ${lollipop.name}`);
    console.log(`   - Length: ${lollipop.length_meters}m`);
    console.log(`   - Is Simple: ${lollipop.is_simple}`);
    console.log(`   - Geometry Type: ${lollipop.geom_type}`);
    console.log(`   - Start-End Distance: ${lollipop.start_end_distance}m`);

    // Test the current splitting logic
    console.log('\n🔧 Testing current splitting logic...');
    
    const splitTest = await pgClient.query(`
      WITH split_segments AS (
        SELECT 
          ST_LineSubstring(geometry, 
            (generate_series(0, 1)::float / 2), 
            LEAST((generate_series(0, 1)::float + 1) / 2, 1.0)
          ) as geometry,
          generate_series(0, 1) + 1 as segment_order
        FROM public.trails 
        WHERE app_uuid = 'b43a9490-6651-428e-b5e4-fb2ffce3b220'
      )
      SELECT 
        segment_order,
        ST_Length(geometry::geography) as length_meters,
        ST_GeometryType(geometry) as geom_type,
        ST_IsValid(geometry) as is_valid,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM split_segments
      WHERE ST_Length(geometry::geography) > 0.1
        AND ST_GeometryType(geometry) = 'ST_LineString'
    `);

    console.log(`📊 Split test results: ${splitTest.rows.length} valid segments`);
    splitTest.rows.forEach((row, i) => {
      console.log(`   Segment ${i + 1}:`);
      console.log(`     - Order: ${row.segment_order}`);
      console.log(`     - Length: ${row.length_meters}m`);
      console.log(`     - Type: ${row.geom_type}`);
      console.log(`     - Valid: ${row.is_valid}`);
    });

    // Test alternative splitting using ST_Node
    console.log('\n🔧 Testing ST_Node splitting...');
    
    const nodeSplitTest = await pgClient.query(`
      WITH node_split AS (
        SELECT 
          dumped.geom as geometry,
          dumped.path[1] as segment_order
        FROM public.trails t,
        LATERAL ST_Dump(ST_Node(t.geometry)) as dumped
        WHERE t.app_uuid = 'b43a9490-6651-428e-b5e4-fb2ffce3b220'
          AND ST_GeometryType(dumped.geom) = 'ST_LineString'
      )
      SELECT 
        segment_order,
        ST_Length(geometry::geography) as length_meters,
        ST_GeometryType(geometry) as geom_type,
        ST_IsValid(geometry) as is_valid,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM node_split
      WHERE ST_Length(geometry::geography) > 0.1
    `);

    console.log(`📊 ST_Node split results: ${nodeSplitTest.rows.length} valid segments`);
    nodeSplitTest.rows.forEach((row, i) => {
      console.log(`   Segment ${i + 1}:`);
      console.log(`     - Order: ${row.segment_order}`);
      console.log(`     - Length: ${row.length_meters}m`);
      console.log(`     - Type: ${row.geom_type}`);
      console.log(`     - Valid: ${row.is_valid}`);
    });

    // Check what's in the current staging schema
    const stagingSchema = 'carthorse_1755775899742';
    console.log(`\n🔍 Checking staging schema: ${stagingSchema}`);
    
    const stagingCheck = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        original_trail_uuid
      FROM ${stagingSchema}.trails 
      WHERE name LIKE '%Foothills North Trail%'
      ORDER BY length_meters DESC
    `);

    console.log(`📊 Foothills North Trail segments in staging: ${stagingCheck.rows.length}`);
    stagingCheck.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.name} (${row.length_meters.toFixed(2)}m) - ${row.app_uuid}`);
      if (row.original_trail_uuid) {
        console.log(`      Original: ${row.original_trail_uuid}`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugLollipopSplitting();
