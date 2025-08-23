const { Pool } = require('pg');
require('dotenv').config();

async function debugXIntersection() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'tester',
    database: 'trail_master_db',
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
  });

  try {
    console.log('🔍 Debugging X intersection detection...\n');

    // Create test trails with the exact coordinates from the user's data
    const trail1Coords = [
      [-105.282727593, 40.070455567],
      [-105.283430657, 40.070318704],
      [-105.283899475, 40.070254488],
      [-105.284392235, 40.070307338],
      [-105.284767464, 40.070297406],
      [-105.285294652, 40.070169973],
      [-105.285540957, 40.070178377],
      [-105.285658152, 40.070160069],
      [-105.286173462, 40.069996623],
      [-105.286700986, 40.069950269],
      [-105.287052908, 40.069976428],
      [-105.28747508, 40.06997538],
      [-105.287827153, 40.070037574],
      [-105.288976702, 40.07010679],
      [-105.289164332, 40.070106322],
      [-105.289656484, 40.070014995],
      [-105.290125639, 40.070031841],
      [-105.290336496, 40.069977254],
      [-105.290547543, 40.069967716],
      [-105.290652971, 40.069940422],
      [-105.290988133, 40.069969306],
      [-105.291177042, 40.069954216],
      [-105.291243129, 40.069970456],
      [-105.291421057, 40.069978588]
    ];

    const trail2Coords = [
      [-105.291193821, 40.070110007],
      [-105.29122595, 40.070040755],
      [-105.291243129, 40.069970456],
      [-105.291266876, 40.069873291],
      [-105.291296544, 40.069653513],
      [-105.291315845, 40.069611252],
      [-105.291333853, 40.069598859],
      [-105.291371229, 40.06960322],
      [-105.291398126, 40.069624179],
      [-105.291394233, 40.069694656],
      [-105.291419156, 40.06977441],
      [-105.291427745, 40.069832987],
      [-105.291421057, 40.069978588]
    ];

    // Create temporary schema for testing
    const tempSchema = 'x_intersection_debug';
    await pool.query(`DROP SCHEMA IF EXISTS ${tempSchema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${tempSchema}`);
    
    await pool.query(`
      CREATE TABLE ${tempSchema}.trails (
        app_uuid TEXT PRIMARY KEY,
        name TEXT,
        geometry geometry(LineString,4326)
      )
    `);

    // Insert test trails
    await pool.query(`
      INSERT INTO ${tempSchema}.trails (app_uuid, name, geometry)
      VALUES 
        ('trail1', 'Trail 1', ST_GeomFromGeoJSON('{"type":"LineString","coordinates":${JSON.stringify(trail1Coords)}}')),
        ('trail2', 'Trail 2', ST_GeomFromGeoJSON('{"type":"LineString","coordinates":${JSON.stringify(trail2Coords)}}'))
    `);

    console.log('✅ Test trails created\n');

    // Test 1: Basic intersection detection
    console.log('🔍 Test 1: Basic intersection detection');
    const basicIntersection = await pool.query(`
      SELECT 
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_AsGeoJSON(ST_Intersection(t1.geometry, t2.geometry)) as intersection_geojson
      FROM ${tempSchema}.trails t1
      CROSS JOIN ${tempSchema}.trails t2
      WHERE t1.app_uuid = 'trail1' AND t2.app_uuid = 'trail2'
    `);
    
    console.log(`   Intersects: ${basicIntersection.rows[0].intersects}`);
    console.log(`   Intersection type: ${basicIntersection.rows[0].intersection_type}`);
    console.log(`   Intersection: ${basicIntersection.rows[0].intersection_geojson}\n`);

    // Test 2: Dump intersection points
    console.log('🔍 Test 2: Dump intersection points');
    const intersectionPoints = await pool.query(`
      SELECT 
        dump.path,
        ST_GeometryType(dump.geom) as geom_type,
        ST_AsGeoJSON(dump.geom) as geom_geojson,
        ST_Length(dump.geom::geography) as length_meters
      FROM ${tempSchema}.trails t1
      CROSS JOIN ${tempSchema}.trails t2,
      LATERAL ST_Dump(ST_Intersection(t1.geometry, t2.geometry)) dump
      WHERE t1.app_uuid = 'trail1' AND t2.app_uuid = 'trail2'
      ORDER BY dump.path
    `);
    
    console.log(`   Found ${intersectionPoints.rows.length} intersection components:`);
    intersectionPoints.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Path: ${row.path}, Type: ${row.geom_type}, Length: ${row.length_meters}m`);
      console.log(`      Geometry: ${row.geom_geojson}`);
    });
    console.log();

    // Test 3: Check for X intersection using ST_Node
    console.log('🔍 Test 3: Check for X intersection using ST_Node');
    const nodedIntersection = await pool.query(`
      WITH noded_trails AS (
        SELECT 
          app_uuid,
          name,
          (ST_Dump(ST_Node(geometry))).geom as noded_geom
        FROM ${tempSchema}.trails
      )
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        ST_Intersects(t1.noded_geom, t2.noded_geom) as intersects,
        ST_GeometryType(ST_Intersection(t1.noded_geom, t2.noded_geom)) as intersection_type,
        ST_AsGeoJSON(ST_Intersection(t1.noded_geom, t2.noded_geom)) as intersection_geojson
      FROM noded_trails t1
      CROSS JOIN noded_trails t2
      WHERE t1.app_uuid = 'trail1' AND t2.app_uuid = 'trail2'
    `);
    
    console.log(`   Noded intersection: ${nodedIntersection.rows[0].intersects}`);
    console.log(`   Noded intersection type: ${nodedIntersection.rows[0].intersection_type}`);
    console.log(`   Noded intersection: ${nodedIntersection.rows[0].intersection_geojson}\n`);

    // Test 4: Check line locate points for each intersection
    console.log('🔍 Test 4: Check line locate points for each intersection');
    if (intersectionPoints.rows.length > 0) {
      for (const intersection of intersectionPoints.rows) {
        if (intersection.geom_type === 'ST_Point') {
          const locateResult = await pool.query(`
            SELECT 
              t1.app_uuid as trail1_id,
              t1.name as trail1_name,
              ST_LineLocatePoint(t1.geometry, ST_GeomFromGeoJSON('${intersection.geom_geojson}')) as trail1_ratio,
              ST_Length(ST_LineSubstring(t1.geometry, 0.0, ST_LineLocatePoint(t1.geometry, ST_GeomFromGeoJSON('${intersection.geom_geojson}')))) as trail1_distance_from_start,
              ST_Length(ST_LineSubstring(t1.geometry, ST_LineLocatePoint(t1.geometry, ST_GeomFromGeoJSON('${intersection.geom_geojson}')), 1.0)) as trail1_distance_from_end,
              t2.app_uuid as trail2_id,
              t2.name as trail2_name,
              ST_LineLocatePoint(t2.geometry, ST_GeomFromGeoJSON('${intersection.geom_geojson}')) as trail2_ratio,
              ST_Length(ST_LineSubstring(t2.geometry, 0.0, ST_LineLocatePoint(t2.geometry, ST_GeomFromGeoJSON('${intersection.geom_geojson}')))) as trail2_distance_from_start,
              ST_Length(ST_LineSubstring(t2.geometry, ST_LineLocatePoint(t2.geometry, ST_GeomFromGeoJSON('${intersection.geom_geojson}')), 1.0)) as trail2_distance_from_end
            FROM ${tempSchema}.trails t1
            CROSS JOIN ${tempSchema}.trails t2
            WHERE t1.app_uuid = 'trail1' AND t2.app_uuid = 'trail2'
          `);
          
          const result = locateResult.rows[0];
          console.log(`   Intersection point: ${intersection.geom_geojson}`);
          console.log(`   Trail 1 ratio: ${result.trail1_ratio.toFixed(6)}, distance from start: ${result.trail1_distance_from_start.toFixed(2)}m, distance from end: ${result.trail1_distance_from_end.toFixed(2)}m`);
          console.log(`   Trail 2 ratio: ${result.trail2_ratio.toFixed(6)}, distance from start: ${result.trail2_distance_from_start.toFixed(2)}m, distance from end: ${result.trail2_distance_from_end.toFixed(2)}m`);
          console.log(`   Would pass validation: ${result.trail1_distance_from_start > 1.0 && result.trail1_distance_from_end > 1.0 && result.trail2_distance_from_start > 1.0 && result.trail2_distance_from_end > 1.0}`);
          console.log();
        }
      }
    }

    // Test 5: Check if there are any other intersection points along the trails
    console.log('🔍 Test 5: Check for any other intersection points along the trails');
    const otherIntersections = await pool.query(`
      WITH trail_segments AS (
        SELECT 
          app_uuid,
          name,
          (ST_Dump(geometry)).geom as segment_geom
        FROM ${tempSchema}.trails
      )
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        ST_Intersects(t1.segment_geom, t2.segment_geom) as intersects,
        ST_AsGeoJSON(ST_Intersection(t1.segment_geom, t2.segment_geom)) as intersection_geojson
      FROM trail_segments t1
      CROSS JOIN trail_segments t2
      WHERE t1.app_uuid != t2.app_uuid
        AND ST_Intersects(t1.segment_geom, t2.segment_geom)
    `);
    
    console.log(`   Found ${otherIntersections.rows.length} segment intersections:`);
    otherIntersections.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.trail1_name} × ${row.trail2_name}: ${row.intersection_geojson}`);
    });

    // Test 6: Detailed analysis around the expected intersection point
    console.log('🔍 Test 6: Detailed analysis around expected intersection point');
    const expectedIntersectionPoint = [-105.291266876, 40.069873291];
    
    const detailedAnalysis = await pool.query(`
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        ST_Distance(t1.geometry::geography, ST_GeomFromGeoJSON('{"type":"Point","coordinates":${JSON.stringify(expectedIntersectionPoint)}}')::geography) as trail1_distance_to_expected,
        ST_LineLocatePoint(t1.geometry, ST_GeomFromGeoJSON('{"type":"Point","coordinates":${JSON.stringify(expectedIntersectionPoint)}}')) as trail1_ratio_at_expected,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        ST_Distance(t2.geometry::geography, ST_GeomFromGeoJSON('{"type":"Point","coordinates":${JSON.stringify(expectedIntersectionPoint)}}')::geography) as trail2_distance_to_expected,
        ST_LineLocatePoint(t2.geometry, ST_GeomFromGeoJSON('{"type":"Point","coordinates":${JSON.stringify(expectedIntersectionPoint)}}')) as trail2_ratio_at_expected
      FROM ${tempSchema}.trails t1
      CROSS JOIN ${tempSchema}.trails t2
      WHERE t1.app_uuid = 'trail1' AND t2.app_uuid = 'trail2'
    `);
    
    const analysis = detailedAnalysis.rows[0];
    console.log(`   Expected intersection point: ${JSON.stringify(expectedIntersectionPoint)}`);
    console.log(`   Trail 1 distance to expected point: ${analysis.trail1_distance_to_expected.toFixed(6)}m, ratio: ${analysis.trail1_ratio_at_expected.toFixed(6)}`);
    console.log(`   Trail 2 distance to expected point: ${analysis.trail2_distance_to_expected.toFixed(6)}m, ratio: ${analysis.trail2_ratio_at_expected.toFixed(6)}`);
    console.log();

    // Test 7: Check if trails actually cross near the expected point
    console.log('🔍 Test 7: Check if trails actually cross near the expected point');
    const crossCheck = await pool.query(`
      WITH trail1_segments AS (
        SELECT 
          (ST_Dump(geometry)).geom as segment_geom,
          (ST_Dump(geometry)).path as segment_path
        FROM ${tempSchema}.trails
        WHERE app_uuid = 'trail1'
      ),
      trail2_segments AS (
        SELECT 
          (ST_Dump(geometry)).geom as segment_geom,
          (ST_Dump(geometry)).path as segment_path
        FROM ${tempSchema}.trails
        WHERE app_uuid = 'trail2'
      )
      SELECT 
        t1.segment_path as trail1_segment,
        t2.segment_path as trail2_segment,
        ST_Intersects(t1.segment_geom, t2.segment_geom) as intersects,
        ST_AsGeoJSON(ST_Intersection(t1.segment_geom, t2.segment_geom)) as intersection_geojson,
        ST_Distance(t1.segment_geom::geography, ST_GeomFromGeoJSON('{"type":"Point","coordinates":${JSON.stringify(expectedIntersectionPoint)}}')::geography) as distance_to_expected
      FROM trail1_segments t1
      CROSS JOIN trail2_segments t2
      WHERE ST_Intersects(t1.segment_geom, t2.segment_geom)
      ORDER BY distance_to_expected
    `);
    
    console.log(`   Found ${crossCheck.rows.length} segment intersections near expected point:`);
    crossCheck.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Trail 1 segment ${row.trail1_segment} × Trail 2 segment ${row.trail2_segment}`);
      console.log(`      Intersection: ${row.intersection_geojson}`);
      console.log(`      Distance to expected: ${row.distance_to_expected.toFixed(6)}m`);
    });
    console.log();

    // Test 8: Check coordinate precision and simplification
    console.log('🔍 Test 8: Check coordinate precision and simplification');
    const precisionCheck = await pool.query(`
      SELECT 
        app_uuid,
        name,
        ST_NPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_AsGeoJSON(ST_Simplify(geometry, 0.000001)) as simplified_geojson
      FROM ${tempSchema}.trails
      ORDER BY app_uuid
    `);
    
    precisionCheck.rows.forEach(row => {
      console.log(`   ${row.name}: ${row.num_points} points, ${row.length_meters.toFixed(2)}m`);
      console.log(`      Simplified: ${row.simplified_geojson.substring(0, 100)}...`);
    });
    console.log();

    // Test 9: Detect shared endpoints as valid intersections
    console.log('🔍 Test 9: Detect shared endpoints as valid intersections');
    const sharedEndpoints = await pool.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          name,
          ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
          ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
          geometry as trail_geom
        FROM ${tempSchema}.trails
      ),
      shared_endpoints AS (
        SELECT 
          e1.app_uuid as trail1_id,
          e1.name as trail1_name,
          e2.app_uuid as trail2_id,
          e2.name as trail2_name,
          CASE 
            WHEN ST_DWithin(ST_GeomFromGeoJSON(e1.start_point), ST_GeomFromGeoJSON(e2.start_point), 0.1) THEN 'start-start'
            WHEN ST_DWithin(ST_GeomFromGeoJSON(e1.start_point), ST_GeomFromGeoJSON(e2.end_point), 0.1) THEN 'start-end'
            WHEN ST_DWithin(ST_GeomFromGeoJSON(e1.end_point), ST_GeomFromGeoJSON(e2.start_point), 0.1) THEN 'end-start'
            WHEN ST_DWithin(ST_GeomFromGeoJSON(e1.end_point), ST_GeomFromGeoJSON(e2.end_point), 0.1) THEN 'end-end'
          END as endpoint_type,
          CASE 
            WHEN ST_DWithin(ST_GeomFromGeoJSON(e1.start_point), ST_GeomFromGeoJSON(e2.start_point), 0.1) THEN ST_GeomFromGeoJSON(e1.start_point)
            WHEN ST_DWithin(ST_GeomFromGeoJSON(e1.start_point), ST_GeomFromGeoJSON(e2.end_point), 0.1) THEN ST_GeomFromGeoJSON(e1.start_point)
            WHEN ST_DWithin(ST_GeomFromGeoJSON(e1.end_point), ST_GeomFromGeoJSON(e2.start_point), 0.1) THEN ST_GeomFromGeoJSON(e1.end_point)
            WHEN ST_DWithin(ST_GeomFromGeoJSON(e1.end_point), ST_GeomFromGeoJSON(e2.end_point), 0.1) THEN ST_GeomFromGeoJSON(e1.end_point)
          END as shared_point
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.app_uuid < e2.app_uuid
          AND (
            ST_DWithin(ST_GeomFromGeoJSON(e1.start_point), ST_GeomFromGeoJSON(e2.start_point), 0.1) OR
            ST_DWithin(ST_GeomFromGeoJSON(e1.start_point), ST_GeomFromGeoJSON(e2.end_point), 0.1) OR
            ST_DWithin(ST_GeomFromGeoJSON(e1.end_point), ST_GeomFromGeoJSON(e2.start_point), 0.1) OR
            ST_DWithin(ST_GeomFromGeoJSON(e1.end_point), ST_GeomFromGeoJSON(e2.end_point), 0.1)
          )
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail2_id,
        trail2_name,
        endpoint_type,
        ST_AsGeoJSON(shared_point) as shared_point_geojson,
        -- Check if this creates a valid X intersection (both trails have significant length)
        ST_Length(e1.trail_geom::geography) as trail1_length,
        ST_Length(e2.trail_geom::geography) as trail2_length
      FROM shared_endpoints se
      JOIN trail_endpoints e1 ON e1.app_uuid = se.trail1_id
      JOIN trail_endpoints e2 ON e2.app_uuid = se.trail2_id
      WHERE ST_Length(e1.trail_geom::geography) > 5.0 AND ST_Length(e2.trail_geom::geography) > 5.0
    `);
    
    console.log(`   Found ${sharedEndpoints.rows.length} shared endpoints:`);
    sharedEndpoints.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.trail1_name} (${row.trail1_length.toFixed(1)}m) ${row.endpoint_type} ${row.trail2_name} (${row.trail2_length.toFixed(1)}m)`);
      console.log(`      Shared point: ${row.shared_point_geojson}`);
    });
    console.log();

    // Test 10: Detect X intersections with relaxed endpoint distance
    console.log('🔍 Test 10: Detect X intersections with relaxed endpoint distance');
    const relaxedIntersections = await pool.query(`
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${tempSchema}.trails t1
        CROSS JOIN ${tempSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid
          AND ST_Intersects(t1.geometry, t2.geometry)
      ),
      intersection_points AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail1_geom,
          trail2_id,
          trail2_name,
          trail2_geom,
          dump.geom as intersection_point
        FROM trail_pairs,
        LATERAL ST_Dump(ST_Intersection(trail1_geom, trail2_geom)) dump
        WHERE ST_GeometryType(dump.geom) = 'ST_Point'
      ),
      validated_intersections AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail1_geom,
          trail2_id,
          trail2_name,
          trail2_geom,
          ST_AsGeoJSON(intersection_point)::json as intersection_point_json,
          ST_LineLocatePoint(trail1_geom, intersection_point) as trail1_split_ratio,
          ST_LineLocatePoint(trail2_geom, intersection_point) as trail2_split_ratio,
          ST_Length(ST_LineSubstring(trail1_geom, 0.0, ST_LineLocatePoint(trail1_geom, intersection_point))) as trail1_distance_from_start,
          ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point))) as trail2_distance_from_start,
          -- Use relaxed threshold: 0.1m instead of 1.0m
          (ST_Length(ST_LineSubstring(trail1_geom, 0.0, ST_LineLocatePoint(trail1_geom, intersection_point))) > 0.1) as trail1_start_ok,
          (ST_Length(ST_LineSubstring(trail1_geom, ST_LineLocatePoint(trail1_geom, intersection_point), 1.0)) > 0.1) as trail1_end_ok,
          (ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point))) > 0.1) as trail2_start_ok,
          (ST_Length(ST_LineSubstring(trail2_geom, ST_LineLocatePoint(trail2_geom, intersection_point), 1.0)) > 0.1) as trail2_end_ok
        FROM intersection_points
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail2_id,
        trail2_name,
        intersection_point_json,
        trail1_split_ratio,
        trail2_split_ratio,
        trail1_distance_from_start,
        trail2_distance_from_start,
        trail1_start_ok,
        trail1_end_ok,
        trail2_start_ok,
        trail2_end_ok,
        -- Pass validation if at least one trail has sufficient distance from both endpoints
        (trail1_start_ok AND trail1_end_ok) OR (trail2_start_ok AND trail2_end_ok) as would_pass_relaxed_validation
      FROM validated_intersections
      ORDER BY trail1_name, trail2_name
    `);
    
    console.log(`   Found ${relaxedIntersections.rows.length} intersections with relaxed validation:`);
    relaxedIntersections.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.trail1_name} × ${row.trail2_name}`);
      console.log(`      Intersection: ${row.intersection_point_json}`);
      console.log(`      Trail 1 ratio: ${row.trail1_split_ratio.toFixed(6)}, distance from start: ${row.trail1_distance_from_start.toFixed(2)}m`);
      console.log(`      Trail 2 ratio: ${row.trail2_split_ratio.toFixed(6)}, distance from start: ${row.trail2_distance_from_start.toFixed(2)}m`);
      console.log(`      Trail 1 start/end ok: ${row.trail1_start_ok}/${row.trail1_end_ok}`);
      console.log(`      Trail 2 start/end ok: ${row.trail2_start_ok}/${row.trail2_end_ok}`);
      console.log(`      Would pass relaxed validation: ${row.would_pass_relaxed_validation}`);
      console.log();
    });

    // Cleanup
    await pool.query(`DROP SCHEMA IF EXISTS ${tempSchema} CASCADE`);
    console.log('\n✅ Debug completed');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

debugXIntersection();