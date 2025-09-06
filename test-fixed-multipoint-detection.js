const { Client } = require('pg');

// Test data from the user's example
const foothillsNorthTrail = {
  name: "Foothills North Trail",
  app_uuid: "873d19f1-26df-4b91-91ee-d1139ff88683",
  coordinates: [
    [-105.282727593, 40.070455567, 1687.336791992],
    [-105.283430657, 40.070318704, 1687.121826172],
    [-105.283899475, 40.070254488, 1687.099975586],
    [-105.284392235, 40.070307338, 1687.581542969],
    [-105.284767464, 40.070297406, 1688.423217773],
    [-105.285294652, 40.070169973, 1691.094604492],
    [-105.285540957, 40.070178377, 1691.958129883],
    [-105.285658152, 40.070160069, 1692.993164062],
    [-105.286173462, 40.069996623, 1693.963989258],
    [-105.286700986, 40.069950269, 1696.985595703],
    [-105.287052908, 40.069976428, 1698.661499023],
    [-105.28747508, 40.06997538, 1699.495117188],
    [-105.287827153, 40.070037574, 1699.94909668],
    [-105.288976702, 40.07010679, 1705.932006836],
    [-105.289164332, 40.070106322, 1707.591918945],
    [-105.289656484, 40.070014995, 1710.877929688],
    [-105.290125639, 40.070031841, 1715.303955078],
    [-105.290336496, 40.069977254, 1715.358520508],
    [-105.290547543, 40.069967716, 1718.499755859],
    [-105.290652971, 40.069940422, 1721.354125977],
    [-105.290988133, 40.069969306, 1723.668579102],
    [-105.291177042, 40.069954216, 1726.449462891],
    [-105.291243129, 40.069970456, 1726.449462891],
    [-105.291421057, 40.069978588, 1726.752563477]
  ]
};

const northSkyTrail = {
  name: "North Sky Trail", 
  app_uuid: "ab36dded-56f4-4a1d-bd16-6781586a3336",
  coordinates: [
    [-105.291193821, 40.070110007, 1731.133178711],
    [-105.29122595, 40.070040755, 1726.449462891],
    [-105.291243129, 40.069970456, 1726.449462891],
    [-105.291266876, 40.069873291, 1727.728393555],
    [-105.291296544, 40.069653513, 1728.930541992],
    [-105.291315845, 40.069611252, 1729.321533203],
    [-105.291333853, 40.069598859, 1729.321533203],
    [-105.291371229, 40.06960322, 1729.321533203],
    [-105.291398126, 40.069624179, 1729.321533203],
    [-105.291394233, 40.069694656, 1728.997192383],
    [-105.291419156, 40.06977441, 1727.890380859],
    [-105.291427745, 40.069832987, 1727.890380859],
    [-105.291421057, 40.069978588, 0]
  ]
};

async function testFixedMultipointDetection() {
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

    // Create test trails in staging schema
    const createTrailsQuery = `
      DROP TABLE IF EXISTS staging.test_trails;
      CREATE TABLE staging.test_trails (
        app_uuid UUID PRIMARY KEY,
        name TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        is_valid BOOLEAN DEFAULT true,
        length_m DOUBLE PRECISION,
        is_simple BOOLEAN DEFAULT true,
        original_trail_uuid UUID
      );
    `;
    
    await client.query(createTrailsQuery);
    console.log('Created test_trails table');

    // Insert the test trails
    const foothillsGeom = `LINESTRINGZ(${foothillsNorthTrail.coordinates.map(c => `${c[0]} ${c[1]} ${c[2]}`).join(', ')})`;
    const northSkyGeom = `LINESTRINGZ(${northSkyTrail.coordinates.map(c => `${c[0]} ${c[1]} ${c[2]}`).join(', ')})`;

    await client.query(`
      INSERT INTO staging.test_trails (app_uuid, name, geometry, length_m) VALUES
      ($1, $2, ST_GeomFromText($3, 4326), ST_Length(ST_GeomFromText($3, 4326)::geography)),
      ($4, $5, ST_GeomFromText($6, 4326), ST_Length(ST_GeomFromText($6, 4326)::geography))
    `, [
      foothillsNorthTrail.app_uuid, foothillsNorthTrail.name, foothillsGeom,
      northSkyTrail.app_uuid, northSkyTrail.name, northSkyGeom
    ]);

    console.log('Inserted test trails');

    // Test the FIXED MultipointIntersectionSplittingService detection logic
    const fixedDetectionQuery = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t1.geometry as trail1_geom,
          t2.geometry as trail2_geom,
          ST_StartPoint(t1.geometry) as trail1_start,
          ST_EndPoint(t1.geometry) as trail1_end,
          ST_StartPoint(t2.geometry) as trail2_start,
          ST_EndPoint(t2.geometry) as trail2_end
        FROM staging.test_trails t1
        JOIN staging.test_trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE 
          ST_Length(t1.geometry::geography) >= 50.0
          AND ST_Length(t2.geometry::geography) >= 50.0
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND t1.app_uuid != t2.app_uuid
      ),
      intersections AS (
        SELECT 
          trail1_uuid,
          trail1_name,
          trail2_uuid,
          trail2_name,
          trail1_geom,
          trail2_geom,
          trail1_start,
          trail1_end,
          trail2_start,
          trail2_end,
          ST_Force3D(ST_Intersection(trail1_geom, trail2_geom)) as intersection_geom,
          ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) as intersection_type
        FROM trail_pairs
        WHERE ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) = 'ST_MultiPoint'
      ),
      point_counts AS (
        SELECT 
          *,
          ST_NumGeometries(intersection_geom) as point_count
        FROM intersections
      ),
      intersection_analysis AS (
        SELECT 
          *,
          -- FIXED: Check if any intersection points are near trail endpoints (within 1.0 meter - reasonable tolerance)
          EXISTS(
            SELECT 1 FROM (
              SELECT (ST_Dump(intersection_geom)).geom as point_geom
            ) points
            WHERE ST_DWithin(points.point_geom, trail1_start, 1.0) 
               OR ST_DWithin(points.point_geom, trail1_end, 1.0)
               OR ST_DWithin(points.point_geom, trail2_start, 1.0)
               OR ST_DWithin(points.point_geom, trail2_end, 1.0)
          ) as has_endpoint_intersection,
          -- FIXED: Check if any intersection points are in the middle of trails (not very close to endpoints)
          EXISTS(
            SELECT 1 FROM (
              SELECT (ST_Dump(intersection_geom)).geom as point_geom
            ) points
            WHERE NOT ST_DWithin(points.point_geom, trail1_start, 1.0) 
              AND NOT ST_DWithin(points.point_geom, trail1_end, 1.0)
              AND NOT ST_DWithin(points.point_geom, trail2_start, 1.0)
              AND NOT ST_DWithin(points.point_geom, trail2_end, 1.0)
          ) as has_middle_intersection
        FROM point_counts
      )
      SELECT 
        trail1_uuid,
        trail1_name,
        trail2_uuid,
        trail2_name,
        intersection_geom,
        point_count,
        has_endpoint_intersection,
        has_middle_intersection,
        CASE 
          WHEN point_count = 2 AND has_endpoint_intersection AND has_middle_intersection THEN 'dual_intersection'
          WHEN point_count = 2 AND has_endpoint_intersection THEN 'endpoint_intersection'
          WHEN point_count = 2 AND has_middle_intersection THEN 'x_intersection'
          WHEN point_count > 2 THEN 'p_intersection'
          ELSE 'unknown'
        END as intersection_type
      FROM intersection_analysis
      WHERE point_count >= 2 AND point_count <= 10
        -- FIXED: Include all multipoint intersections: X-intersections, P-intersections, endpoint intersections, and dual intersections
        AND (
          (point_count = 2 AND has_middle_intersection) OR  -- X-intersections (middle crossings)
          (point_count > 2 AND has_middle_intersection) OR  -- P-intersections (complex crossings)
          (point_count = 2 AND has_endpoint_intersection AND has_middle_intersection) OR  -- dual intersections (endpoint + middle)
          (point_count = 2 AND has_endpoint_intersection AND NOT has_middle_intersection)  -- pure endpoint intersections
        )
      ORDER BY point_count DESC, trail1_name, trail2_name;
    `;

    const result = await client.query(fixedDetectionQuery);
    
    console.log('\n=== FIXED MULTIPOINT INTERSECTION DETECTION RESULTS ===');
    if (result.rows.length === 0) {
      console.log('❌ No multipoint intersections detected with fixed logic');
    } else {
      console.log(`✅ Found ${result.rows.length} multipoint intersection(s) with fixed logic:`);
      for (const row of result.rows) {
        console.log(`📍 ${row.intersection_type}: ${row.trail1_name} ↔ ${row.trail2_name}`);
        console.log(`   Point Count: ${row.point_count}`);
        console.log(`   Has Endpoint Intersection: ${row.has_endpoint_intersection}`);
        console.log(`   Has Middle Intersection: ${row.has_middle_intersection}`);
        
        // Show individual intersection points
        const pointsResult = await client.query(`
          SELECT 
            (ST_Dump($1::geometry)).geom as point_geom,
            (ST_Dump($1::geometry)).path as point_path
        `, [row.intersection_geom]);

        console.log(`   Intersection Points:`);
        for (const pointRow of pointsResult.rows) {
          const pointWkt = (await client.query('SELECT ST_AsText($1)', [pointRow.point_geom])).rows[0].st_astext;
          console.log(`      ${pointRow.point_path}: ${pointWkt}`);
        }
        console.log('---');
      }
    }

    // Also test the original (broken) logic for comparison
    console.log('\n=== ORIGINAL (BROKEN) LOGIC FOR COMPARISON ===');
    const originalLogicQuery = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t1.geometry as trail1_geom,
          t2.geometry as trail2_geom,
          ST_StartPoint(t1.geometry) as trail1_start,
          ST_EndPoint(t1.geometry) as trail1_end,
          ST_StartPoint(t2.geometry) as trail2_start,
          ST_EndPoint(t2.geometry) as trail2_end
        FROM staging.test_trails t1
        JOIN staging.test_trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE 
          ST_Length(t1.geometry::geography) >= 50.0
          AND ST_Length(t2.geometry::geography) >= 50.0
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND t1.app_uuid != t2.app_uuid
      ),
      intersections AS (
        SELECT 
          trail1_uuid,
          trail1_name,
          trail2_uuid,
          trail2_name,
          trail1_geom,
          trail2_geom,
          trail1_start,
          trail1_end,
          trail2_start,
          trail2_end,
          ST_Force3D(ST_Intersection(trail1_geom, trail2_geom)) as intersection_geom,
          ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) as intersection_type
        FROM trail_pairs
        WHERE ST_GeometryType(ST_Intersection(trail1_geom, trail2_geom)) = 'ST_MultiPoint'
      ),
      point_counts AS (
        SELECT 
          *,
          ST_NumGeometries(intersection_geom) as point_count
        FROM intersections
      ),
      intersection_analysis AS (
        SELECT 
          *,
          -- ORIGINAL: Check if any intersection points are near trail endpoints (within 0.1 meter - too strict)
          EXISTS(
            SELECT 1 FROM (
              SELECT (ST_Dump(intersection_geom)).geom as point_geom
            ) points
            WHERE ST_DWithin(points.point_geom, trail1_start, 0.1) 
               OR ST_DWithin(points.point_geom, trail1_end, 0.1)
               OR ST_DWithin(points.point_geom, trail2_start, 0.1)
               OR ST_DWithin(points.point_geom, trail2_end, 0.1)
          ) as has_endpoint_intersection,
          -- ORIGINAL: Check if any intersection points are in the middle of trails (not very close to endpoints)
          EXISTS(
            SELECT 1 FROM (
              SELECT (ST_Dump(intersection_geom)).geom as point_geom
            ) points
            WHERE NOT ST_DWithin(points.point_geom, trail1_start, 0.1) 
              AND NOT ST_DWithin(points.point_geom, trail1_end, 0.1)
              AND NOT ST_DWithin(points.point_geom, trail2_start, 0.1)
              AND NOT ST_DWithin(points.point_geom, trail2_end, 0.1)
          ) as has_middle_intersection
        FROM point_counts
      )
      SELECT 
        trail1_uuid,
        trail1_name,
        trail2_uuid,
        trail2_name,
        intersection_geom,
        point_count,
        has_endpoint_intersection,
        has_middle_intersection,
        CASE 
          WHEN point_count = 2 AND has_endpoint_intersection AND has_middle_intersection THEN 'dual_intersection'
          WHEN point_count = 2 AND has_endpoint_intersection THEN 'endpoint_intersection'
          WHEN point_count = 2 AND has_middle_intersection THEN 'x_intersection'
          WHEN point_count > 2 THEN 'p_intersection'
          ELSE 'unknown'
        END as intersection_type
      FROM intersection_analysis
      WHERE point_count >= 2 AND point_count <= 10
        -- ORIGINAL: Only X-intersections, P-intersections, and dual intersections (filters out pure endpoint intersections)
        AND (
          (point_count = 2 AND has_middle_intersection) OR 
          (point_count > 2 AND has_middle_intersection) OR
          (point_count = 2 AND has_endpoint_intersection AND has_middle_intersection)
        )
      ORDER BY point_count DESC, trail1_name, trail2_name;
    `;

    const originalResult = await client.query(originalLogicQuery);
    
    if (originalResult.rows.length === 0) {
      console.log('❌ No multipoint intersections detected with original (broken) logic');
    } else {
      console.log(`✅ Found ${originalResult.rows.length} multipoint intersection(s) with original logic:`);
      for (const row of originalResult.rows) {
        console.log(`📍 ${row.intersection_type}: ${row.trail1_name} ↔ ${row.trail2_name}`);
        console.log(`   Point Count: ${row.point_count}`);
        console.log(`   Has Endpoint Intersection: ${row.has_endpoint_intersection}`);
        console.log(`   Has Middle Intersection: ${row.has_middle_intersection}`);
        console.log('---');
      }
    }

    // Clean up
    await client.query('DROP TABLE IF EXISTS staging.test_trails');
    console.log('\nCleaned up test data');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

testFixedMultipointDetection();
