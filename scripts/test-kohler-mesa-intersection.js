const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testKohlerMesaIntersection() {
  try {
    console.log('🔍 Testing Kohler Mesa intersection splitting...');
    
    // Get the specific trails by their IDs
    const trailsResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        source,
        ST_AsText(geometry) as geom_text,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat,
        ST_IsSimple(geometry) as is_simple,
        ST_IsValid(geometry) as is_valid,
        ST_GeometryType(geometry) as geom_type,
        ST_Dimension(geometry) as dimensions,
        ST_SRID(geometry) as srid
      FROM public.trails 
      WHERE app_uuid IN ('70ce431d-fe50-4f6d-bbab-90a01952fe11', 'c794e7d5-8f66-4f91-bb8a-1d66f6ee21fa')
      ORDER BY name
    `);

    if (trailsResult.rows.length !== 2) {
      console.error('❌ Expected 2 trails, found:', trailsResult.rows.length);
      return;
    }

    const [spurTrail, mesaTrail] = trailsResult.rows;
    
    console.log('\n📊 Trail Analysis:');
    console.log('='.repeat(60));
    
    console.log('\n1️⃣ Enchanted-Kohler Spur Trail (Segment 1):');
    console.log(`   ID: ${spurTrail.app_uuid}`);
    console.log(`   Name: ${spurTrail.name}`);
    console.log(`   Source: ${spurTrail.source}`);
    console.log(`   Length: ${spurTrail.length_meters.toFixed(2)}m`);
    console.log(`   Points: ${spurTrail.num_points}`);
    console.log(`   Start: (${spurTrail.start_lng.toFixed(6)}, ${spurTrail.start_lat.toFixed(6)})`);
    console.log(`   End: (${spurTrail.end_lng.toFixed(6)}, ${spurTrail.end_lat.toFixed(6)})`);
    console.log(`   Simple: ${spurTrail.is_simple}, Valid: ${spurTrail.is_valid}`);
    console.log(`   Type: ${spurTrail.geom_type}, SRID: ${spurTrail.srid}`);

    console.log('\n2️⃣ Kohler Mesa Trail:');
    console.log(`   ID: ${mesaTrail.app_uuid}`);
    console.log(`   Name: ${mesaTrail.name}`);
    console.log(`   Source: ${mesaTrail.source}`);
    console.log(`   Length: ${mesaTrail.length_meters.toFixed(2)}m`);
    console.log(`   Points: ${mesaTrail.num_points}`);
    console.log(`   Start: (${mesaTrail.start_lng.toFixed(6)}, ${mesaTrail.start_lat.toFixed(6)})`);
    console.log(`   End: (${mesaTrail.end_lng.toFixed(6)}, ${mesaTrail.end_lat.toFixed(6)})`);
    console.log(`   Simple: ${mesaTrail.is_simple}, Valid: ${mesaTrail.is_valid}`);
    console.log(`   Type: ${mesaTrail.geom_type}, SRID: ${mesaTrail.srid}`);

    // Test endpoint distances
    console.log('\n📏 Endpoint Distance Analysis:');
    console.log('='.repeat(60));
    
    const distanceResult = await pgClient.query(`
      WITH spur AS (
        SELECT geometry as spur_geom FROM public.trails WHERE app_uuid = '70ce431d-fe50-4f6d-bbab-90a01952fe11'
      ),
      mesa AS (
        SELECT geometry as mesa_geom FROM public.trails WHERE app_uuid = 'c794e7d5-8f66-4f91-bb8a-1d66f6ee21fa'
      )
      SELECT 
        ST_Distance(ST_StartPoint(spur_geom), ST_StartPoint(mesa_geom)) as start_start_dist,
        ST_Distance(ST_StartPoint(spur_geom), ST_EndPoint(mesa_geom)) as start_end_dist,
        ST_Distance(ST_EndPoint(spur_geom), ST_StartPoint(mesa_geom)) as end_start_dist,
        ST_Distance(ST_EndPoint(spur_geom), ST_EndPoint(mesa_geom)) as end_end_dist,
        ST_Distance(ST_StartPoint(spur_geom), mesa_geom) as spur_start_to_mesa_dist,
        ST_Distance(ST_EndPoint(spur_geom), mesa_geom) as spur_end_to_mesa_dist,
        ST_Distance(ST_StartPoint(mesa_geom), spur_geom) as mesa_start_to_spur_dist,
        ST_Distance(ST_EndPoint(mesa_geom), spur_geom) as mesa_end_to_spur_dist
      FROM spur, mesa
    `);

    const distances = distanceResult.rows[0];
    console.log(`   Spur Start ↔ Mesa Start: ${(distances.start_start_dist * 111000).toFixed(2)}m`);
    console.log(`   Spur Start ↔ Mesa End: ${(distances.start_end_dist * 111000).toFixed(2)}m`);
    console.log(`   Spur End ↔ Mesa Start: ${(distances.end_start_dist * 111000).toFixed(2)}m`);
    console.log(`   Spur End ↔ Mesa End: ${(distances.end_end_dist * 111000).toFixed(2)}m`);
    console.log(`   Spur Start → Mesa Trail: ${(distances.spur_start_to_mesa_dist * 111000).toFixed(2)}m`);
    console.log(`   Spur End → Mesa Trail: ${(distances.spur_end_to_mesa_dist * 111000).toFixed(2)}m`);
    console.log(`   Mesa Start → Spur Trail: ${(distances.mesa_start_to_spur_dist * 111000).toFixed(2)}m`);
    console.log(`   Mesa End → Spur Trail: ${(distances.mesa_end_to_spur_dist * 111000).toFixed(2)}m`);

    // Test intersection with various tolerances
    console.log('\n🔍 Intersection Testing:');
    console.log('='.repeat(60));
    
    const tolerances = [1e-6, 1e-5, 1e-4, 0.0001, 0.001, 0.01, 0.1];
    
    for (const tolerance of tolerances) {
      console.log(`\n   Testing tolerance: ${tolerance}`);
      
      const intersectionResult = await pgClient.query(`
        WITH spur AS (
          SELECT ST_SnapToGrid(geometry, ${tolerance}) as geom FROM public.trails WHERE app_uuid = '70ce431d-fe50-4f6d-bbab-90a01952fe11'
        ),
        mesa AS (
          SELECT ST_SnapToGrid(geometry, ${tolerance}) as geom FROM public.trails WHERE app_uuid = 'c794e7d5-8f66-4f91-bb8a-1d66f6ee21fa'
        )
        SELECT 
          ST_Intersects(spur.geom, mesa.geom) as intersects,
          ST_NumGeometries(ST_Intersection(spur.geom, mesa.geom)) as intersection_count,
          ST_AsText(ST_Intersection(spur.geom, mesa.geom)) as intersection_geom
        FROM spur, mesa
      `);
      
      const result = intersectionResult.rows[0];
      console.log(`     Intersects: ${result.intersects}`);
      console.log(`     Intersection count: ${result.intersection_count}`);
      if (result.intersection_geom) {
        console.log(`     Intersection: ${result.intersection_geom}`);
      }
    }

    // Test the actual splitting logic
    console.log('\n🔧 Testing Splitting Logic:');
    console.log('='.repeat(60));
    
    // Create a temporary table for testing
    await pgClient.query('DROP TABLE IF EXISTS temp_test_trails');
    await pgClient.query(`
      CREATE TABLE temp_test_trails AS 
      SELECT * FROM public.trails 
      WHERE app_uuid IN ('70ce431d-fe50-4f6d-bbab-90a01952fe11', 'c794e7d5-8f66-4f91-bb8a-1d66f6ee21fa')
    `);
    
    // Apply the working prototype logic
    const tolerance = 0.0001; // Use the working tolerance
    
    console.log(`\n   Step 1: Rounding coordinates to 6 decimal places...`);
    await pgClient.query(`
      UPDATE temp_test_trails 
      SET geometry = ST_SnapToGrid(geometry, 0.000001)
    `);
    
    console.log(`   Step 2: Snapping trails with tolerance ${tolerance}...`);
    await pgClient.query(`
      UPDATE temp_test_trails 
      SET geometry = ST_Snap(geometry, (
        SELECT ST_Union(geometry) 
        FROM temp_test_trails 
        WHERE app_uuid != temp_test_trails.app_uuid
      ), ${tolerance})
    `);
    
    console.log(`   Step 3: Finding intersections...`);
    const intersectionTest = await pgClient.query(`
      WITH spur AS (
        SELECT geometry as geom FROM temp_test_trails WHERE app_uuid = '70ce431d-fe50-4f6d-bbab-90a01952fe11'
      ),
      mesa AS (
        SELECT geometry as geom FROM temp_test_trails WHERE app_uuid = 'c794e7d5-8f66-4f91-bb8a-1d66f6ee21fa'
      )
      SELECT 
        ST_Intersects(spur.geom, mesa.geom) as intersects,
        ST_NumGeometries(ST_Intersection(spur.geom, mesa.geom)) as intersection_count,
        ST_AsText(ST_Intersection(spur.geom, mesa.geom)) as intersection_geom
      FROM spur, mesa
    `);
    
    const intersection = intersectionTest.rows[0];
    console.log(`     Intersects: ${intersection.intersects}`);
    console.log(`     Intersection count: ${intersection.intersection_count}`);
    
    if (intersection.intersects && intersection.intersection_count > 0) {
      console.log(`     Intersection found: ${intersection.intersection_geom}`);
      
      console.log(`   Step 4: Attempting to split Kohler Mesa Trail...`);
      
      try {
        const splitResult = await pgClient.query(`
          WITH intersection_point AS (
            SELECT ST_Intersection(
              (SELECT geometry FROM temp_test_trails WHERE app_uuid = '70ce431d-fe50-4f6d-bbab-90a01952fe11'),
              (SELECT geometry FROM temp_test_trails WHERE app_uuid = 'c794e7d5-8f66-4f91-bb8a-1d66f6ee21fa')
            ) as point
          ),
          split_geoms AS (
            SELECT ST_Split(
              (SELECT geometry FROM temp_test_trails WHERE app_uuid = 'c794e7d5-8f66-4f91-bb8a-1d66f6ee21fa'),
              ST_Buffer(intersection_point.point, 0.000001)
            ) as split_geom
            FROM intersection_point
          )
          SELECT 
            ST_NumGeometries(split_geom) as num_segments,
            ST_AsText(split_geom) as split_geometries
          FROM split_geoms
        `);
        
        const split = splitResult.rows[0];
        console.log(`     ✅ Split successful!`);
        console.log(`     Number of segments: ${split.num_segments}`);
        console.log(`     Split geometries: ${split.split_geometries}`);
        
      } catch (error) {
        console.log(`     ❌ Split failed: ${error.message}`);
      }
    } else {
      console.log(`     ❌ No intersection found with tolerance ${tolerance}`);
    }
    
    // Cleanup
    await pgClient.query('DROP TABLE IF EXISTS temp_test_trails');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testKohlerMesaIntersection();
