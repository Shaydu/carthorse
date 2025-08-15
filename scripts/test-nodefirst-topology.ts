import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const STAGING_SCHEMA = `test_nodefirst_topology_${Date.now()}`;

async function main() {
  console.log('\n🧪 Testing node-first topology creation...\n');

  const client = new Client({
    host: 'localhost',
    user: 'carthorse',
    password: 'carthorse',
    database: 'trail_master_db'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Step 1: Create fresh staging schema
    console.log(`📋 Creating fresh staging schema: ${STAGING_SCHEMA}`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${STAGING_SCHEMA}`);

    // Step 2: Copy COTREX trails from the same bbox as before
    console.log('\n📋 Copying COTREX trails from bbox...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails AS
      SELECT * FROM public.trails 
      WHERE source = 'cotrex' 
        AND ST_Intersects(geometry, ST_MakeEnvelope(-105.29123174925316, 39.96928418458248, -105.28050515816028, 39.981172777276015, 4326))
        AND geometry IS NOT NULL 
        AND ST_IsValid(geometry)
    `);

    const trailCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} COTREX trails`);

    // Step 3: Show original trails
    console.log('\n📋 Original trails:');
    const originalTrails = await client.query(`
      SELECT name, ST_Length(geometry::geography) as length_m
      FROM ${STAGING_SCHEMA}.trails 
      ORDER BY name, length_m DESC
    `);
    originalTrails.rows.forEach(trail => {
      console.log(`   ${trail.name}: ${(trail.length_m / 1000).toFixed(1)}km`);
    });

    // Step 4: Iterative T-intersection detection with different tolerances
    console.log('\n🔧 Step 4: Iterative T-intersection detection...');
    
    const tolerances = [0.0001, 0.0002, 0.0003, 0.0004, 0.0005, 0.0006]; // 10m, 20m, 30m, 40m, 50m, 60m
    
    for (let i = 0; i < tolerances.length; i++) {
      const tolerance = tolerances[i];
      console.log(`\n🔍 Iteration ${i + 1}: Testing tolerance ${tolerance} (~${Math.round(tolerance * 111000)}m)`);
      
      // Clear previous intersection points
      await client.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.t_intersections`);
      
      // Create intersection points table with current tolerance
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.t_intersections AS
        WITH exact_intersections AS (
          SELECT (ST_Dump(ST_Intersection(a.geometry, b.geometry))).geom AS geometry
          FROM ${STAGING_SCHEMA}.trails a
          JOIN ${STAGING_SCHEMA}.trails b ON a.id < b.id
          WHERE ST_Crosses(a.geometry, b.geometry) -- Trails that cross each other
        ),
        tolerance_intersections AS (
          SELECT ST_ClosestPoint(a.geometry, b.geometry) AS geometry
          FROM ${STAGING_SCHEMA}.trails a
          JOIN ${STAGING_SCHEMA}.trails b ON a.id < b.id
          WHERE ST_DWithin(a.geometry, b.geometry, ${tolerance}) -- Current tolerance
            AND NOT ST_Crosses(a.geometry, b.geometry)      -- But not exactly crossing
        ),
        endpoint_intersections AS (
          -- Detect when one trail's endpoint is very close to another trail's line
          SELECT ST_ClosestPoint(a.geometry, ST_EndPoint(b.geometry)) AS geometry
          FROM ${STAGING_SCHEMA}.trails a
          JOIN ${STAGING_SCHEMA}.trails b ON a.id != b.id
          WHERE ST_DWithin(a.geometry, ST_EndPoint(b.geometry), ${tolerance}) -- Endpoint within tolerance
            AND NOT ST_Intersects(a.geometry, ST_EndPoint(b.geometry))  -- But not exactly intersecting
          UNION
          SELECT ST_ClosestPoint(a.geometry, ST_StartPoint(b.geometry)) AS geometry
          FROM ${STAGING_SCHEMA}.trails a
          JOIN ${STAGING_SCHEMA}.trails b ON a.id != b.id
          WHERE ST_DWithin(a.geometry, ST_StartPoint(b.geometry), ${tolerance}) -- Startpoint within tolerance
            AND NOT ST_Intersects(a.geometry, ST_StartPoint(b.geometry))  -- But not exactly intersecting
        ),
        all_intersection_points AS (
          SELECT geometry FROM exact_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
          UNION ALL
          SELECT geometry FROM tolerance_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
          UNION ALL
          SELECT geometry FROM endpoint_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
        ),
        deduplicated_points AS (
          SELECT DISTINCT ON (ST_SnapToGrid(geometry, ${tolerance * 0.1})) geometry
          FROM all_intersection_points
          ORDER BY ST_SnapToGrid(geometry, ${tolerance * 0.1}), geometry
        )
        SELECT DISTINCT ST_ClosestPoint(t.geometry, ip.geometry) AS geometry
        FROM deduplicated_points ip
        JOIN ${STAGING_SCHEMA}.trails t ON ST_DWithin(t.geometry, ip.geometry, ${tolerance})
      `);

      // Add ST_Node intersection points
      await client.query(`
        INSERT INTO ${STAGING_SCHEMA}.t_intersections (geometry)
        WITH trail_pairs AS (
          SELECT 
            a.id as trail_a_id,
            a.name as trail_a_name,
            a.geometry as trail_a_geom,
            b.id as trail_b_id,
            b.name as trail_b_name,
            b.geometry as trail_b_geom
          FROM ${STAGING_SCHEMA}.trails a
          JOIN ${STAGING_SCHEMA}.trails b ON a.id < b.id
          WHERE ST_DWithin(a.geometry, b.geometry, ${tolerance}) -- Only process trails within tolerance
        ),
        noded_intersections AS (
          SELECT 
            tp.trail_a_id,
            tp.trail_a_name,
            tp.trail_b_id,
            tp.trail_b_name,
            (ST_Dump(ST_Node(ST_UnaryUnion(ST_Collect(ARRAY[tp.trail_a_geom, tp.trail_b_geom]))))).geom AS intersection_point
          FROM trail_pairs tp
        ),
        valid_intersections AS (
          SELECT 
            trail_a_id,
            trail_a_name,
            trail_b_id,
            trail_b_name,
            intersection_point
          FROM noded_intersections
          WHERE ST_GeometryType(intersection_point) = 'ST_Point'
            AND ST_Intersects(intersection_point, (SELECT geometry FROM ${STAGING_SCHEMA}.trails WHERE id = trail_a_id))
            AND ST_Intersects(intersection_point, (SELECT geometry FROM ${STAGING_SCHEMA}.trails WHERE id = trail_b_id))
        )
        SELECT DISTINCT intersection_point AS geometry
        FROM valid_intersections
        WHERE NOT EXISTS (
          SELECT 1 FROM ${STAGING_SCHEMA}.t_intersections existing
          WHERE ST_DWithin(existing.geometry, intersection_point, ${tolerance * 0.1}) -- Avoid duplicates
        )
      `);

      // Deduplicate intersection points that are very close together
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.t_intersections_dedup AS
        SELECT DISTINCT ON (ST_SnapToGrid(geometry, ${tolerance * 0.01})) geometry
        FROM ${STAGING_SCHEMA}.t_intersections
        ORDER BY ST_SnapToGrid(geometry, ${tolerance * 0.01}), geometry
      `);
      
      await client.query(`DROP TABLE ${STAGING_SCHEMA}.t_intersections`);
      await client.query(`ALTER TABLE ${STAGING_SCHEMA}.t_intersections_dedup RENAME TO t_intersections`);
      
      // Count intersection points
      const intersectionCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.t_intersections`);
      console.log(`📊 Created ${intersectionCount.rows[0].count} T-intersection points (after deduplication)`);

      // Check specific NCAR trails
      const ncarCheck = await client.query(`
        SELECT 
          t.name,
          COUNT(ti.geometry) as intersection_count
        FROM ${STAGING_SCHEMA}.trails t
        LEFT JOIN ${STAGING_SCHEMA}.t_intersections ti ON ST_DWithin(t.geometry, ti.geometry, ${tolerance})
        WHERE t.name LIKE '%NCAR%' OR t.name LIKE '%Water Tank%'
        GROUP BY t.name
        ORDER BY t.name
      `);
      
      console.log(`🔍 NCAR trails with tolerance ${tolerance}:`);
      ncarCheck.rows.forEach(row => {
        console.log(`   ${row.name}: ${row.intersection_count} intersection points`);
      });

      // Test splitting with current tolerance
      const splitTest = await client.query(`
        WITH trail_intersections AS (
          SELECT 
            t.id as trail_id,
            t.name as trail_name,
            COUNT(ti.geometry) as intersection_count
          FROM ${STAGING_SCHEMA}.trails t
          LEFT JOIN ${STAGING_SCHEMA}.t_intersections ti ON ST_DWithin(t.geometry, ti.geometry, ${tolerance})
          GROUP BY t.id, t.name
        )
        SELECT 
          trail_name,
          intersection_count,
          CASE WHEN intersection_count > 0 THEN 'WILL SPLIT' ELSE 'NO SPLIT' END as split_status
        FROM trail_intersections
        WHERE trail_name LIKE '%NCAR%' OR trail_name LIKE '%Water Tank%'
        ORDER BY trail_name
      `);
      
      console.log(`🔍 Splitting status with tolerance ${tolerance}:`);
      splitTest.rows.forEach(row => {
        console.log(`   ${row.trail_name}: ${row.intersection_count} points -> ${row.split_status}`);
      });

      // Test actual splitting with current tolerance
      console.log(`🔧 Testing actual splitting with tolerance ${tolerance}...`);
      
      // Create temporary split table
      await client.query(`
        CREATE TABLE ${STAGING_SCHEMA}.temp_trails_with_t_splits AS
        WITH trail_intersections AS (
          SELECT 
            t.id as trail_id,
            t.name as trail_name,
            t.geometry as trail_geom,
            ARRAY_AGG(ti.geometry ORDER BY ST_LineLocatePoint(t.geometry, ti.geometry)) as intersection_points
          FROM ${STAGING_SCHEMA}.trails t
          LEFT JOIN ${STAGING_SCHEMA}.t_intersections ti ON ST_DWithin(t.geometry, ti.geometry, ${tolerance})
          GROUP BY t.id, t.name, t.geometry
          HAVING COUNT(ti.geometry) > 0
        ),
        temp_split_segments AS (
          SELECT 
            ti.trail_id as orig_id,
            ti.trail_name,
            CASE 
              WHEN array_length(ti.intersection_points, 1) = 1 THEN
                -- Single intersection point - split into 2 segments
                ARRAY[
                  ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), 1)
                ]
              WHEN array_length(ti.intersection_points, 1) = 2 THEN
                -- Two intersection points - split into 3 segments
                ARRAY[
                  ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2]), 1)
                ]
              WHEN array_length(ti.intersection_points, 1) = 3 THEN
                -- Three intersection points - split into 4 segments
                ARRAY[
                  ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[3])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[3]), 1)
                ]
              ELSE
                -- More than 3 points - keep original for now
                ARRAY[ti.trail_geom]
            END as segments,
            array_length(ti.intersection_points, 1) as point_count
          FROM trail_intersections ti
        ),
        unnest_segments AS (
          SELECT 
            orig_id,
            trail_name,
            unnest(segments) as geometry,
            point_count
          FROM temp_split_segments
        )
        SELECT 
          orig_id,
          trail_name,
          geometry,
          point_count
        FROM unnest_segments
        WHERE ST_GeometryType(geometry) = 'ST_LineString'
          AND ST_Length(geometry::geography) > 1
      `);

      // Add non-intersecting trails back
      await client.query(`
        INSERT INTO ${STAGING_SCHEMA}.temp_trails_with_t_splits (orig_id, trail_name, geometry, point_count)
        SELECT a.id AS orig_id, a.name as trail_name, a.geometry, 0 as point_count
        FROM ${STAGING_SCHEMA}.trails a
        WHERE NOT EXISTS (
          SELECT 1 FROM ${STAGING_SCHEMA}.t_intersections ti
          WHERE ST_DWithin(a.geometry, ti.geometry, ${tolerance})
        )
      `);

      // Count final segments
      const segmentCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.temp_trails_with_t_splits`);
      
      // Count segments for NCAR trails specifically
      const ncarSegmentCount = await client.query(`
        SELECT 
          trail_name,
          COUNT(*) as segment_count,
          point_count
        FROM ${STAGING_SCHEMA}.temp_trails_with_t_splits
        WHERE trail_name LIKE '%NCAR%' OR trail_name LIKE '%Water Tank%'
        GROUP BY trail_name, point_count
        ORDER BY trail_name
      `);
      
      console.log(`📊 Final results with tolerance ${tolerance}:`);
      console.log(`   Total segments: ${segmentCount.rows[0].count}`);
      console.log(`   NCAR trail segments:`);
      ncarSegmentCount.rows.forEach(row => {
        console.log(`     ${row.trail_name}: ${row.segment_count} segments (from ${row.point_count} intersection points)`);
      });
      
      // Debug NCAR Water Tank Road specifically
      if (tolerance === 0.0001) {
        const waterTankDebug = await client.query(`
          SELECT 
            trail_name,
            point_count,
            COUNT(*) as actual_segments,
            array_agg(ST_Length(geometry::geography)) as segment_lengths
          FROM ${STAGING_SCHEMA}.temp_trails_with_t_splits
          WHERE trail_name LIKE '%Water Tank%'
          GROUP BY trail_name, point_count
        `);
        
        console.log(`🔍 NCAR Water Tank Road debug:`);
        waterTankDebug.rows.forEach(row => {
          console.log(`     ${row.trail_name}: ${row.actual_segments} actual segments, ${row.point_count} points, lengths: ${row.segment_lengths}`);
        });
        
        // Debug the actual intersection points and their locations
        const intersectionDebug = await client.query(`
          WITH water_tank AS (
            SELECT geometry FROM ${STAGING_SCHEMA}.trails WHERE name LIKE '%Water Tank%' LIMIT 1
          ),
          intersection_points AS (
            SELECT ti.geometry, 
                   ST_LineLocatePoint(wt.geometry, ti.geometry) as location_ratio
            FROM ${STAGING_SCHEMA}.t_intersections ti
            CROSS JOIN water_tank wt
            WHERE ST_DWithin(ti.geometry, wt.geometry, 0.0001)
          )
          SELECT 
            ST_AsText(geometry) as point_text,
            location_ratio,
            (location_ratio * 100)::numeric(5,2) as percent_along_trail
          FROM intersection_points
          ORDER BY location_ratio
        `);
        
        console.log(`🔍 NCAR Water Tank Road intersection points:`);
        intersectionDebug.rows.forEach(row => {
          console.log(`     Point: ${row.point_text}, Location: ${row.location_ratio} (${row.percent_along_trail}% along trail)`);
        });
      }
      
      // Clean up temp table
      await client.query(`DROP TABLE ${STAGING_SCHEMA}.temp_trails_with_t_splits`);
      
      console.log('---');
    }

    // Count intersection points
    const intersectionCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.t_intersections`);
    console.log(`📊 Created ${intersectionCount.rows[0].count} T-intersection points`);

    // Debug: Show which trails are being split
    const splitDebug = await client.query(`
      SELECT 
        t.id,
        t.name,
        COUNT(ti.geometry) as intersection_count,
        CASE WHEN COUNT(ti.geometry) > 0 THEN 'WILL SPLIT' ELSE 'NO SPLIT' END as split_status
      FROM ${STAGING_SCHEMA}.trails t
      LEFT JOIN ${STAGING_SCHEMA}.t_intersections ti ON ST_Intersects(t.geometry, ti.geometry)
      GROUP BY t.id, t.name
      ORDER BY t.name
    `);
    
    console.log('\n🔍 Trail splitting status:');
    splitDebug.rows.forEach(row => {
      console.log(`   ${row.name} (ID ${row.id}): ${row.intersection_count} points -> ${row.split_status}`);
    });

    // Debug: Show which trails are intersecting
    const intersectionDebug = await client.query(`
      SELECT 
        a.name as trail_a,
        b.name as trail_b,
        ST_Distance(a.geometry, b.geometry) as distance_m,
        ST_Crosses(a.geometry, b.geometry) as crosses,
        ST_DWithin(a.geometry, b.geometry, 0.01) as within_tolerance
      FROM ${STAGING_SCHEMA}.trails a
      JOIN ${STAGING_SCHEMA}.trails b ON a.id < b.id
      WHERE ST_DWithin(a.geometry, b.geometry, 0.002) -- Show trails within 200m
      ORDER BY distance_m ASC
    `);
    
    console.log('\n📋 Trail intersection debugging:');
    intersectionDebug.rows.forEach(row => {
      console.log(`   ${row.trail_a} <-> ${row.trail_b}: distance=${row.distance_m.toFixed(1)}m, crosses=${row.crosses}, within_tolerance=${row.within_tolerance}`);
    });

    // Specific debugging for NCAR Water Tank Road and NCAR Trail
    console.log('\n🔍 Specific NCAR Water Tank Road / NCAR Trail debugging:');
    const ncarDebug = await client.query(`
      SELECT 
        t.id,
        t.name,
        COUNT(ti.geometry) as intersection_count,
        ARRAY_AGG(ST_AsText(ti.geometry)) as intersection_points
      FROM ${STAGING_SCHEMA}.trails t
      LEFT JOIN ${STAGING_SCHEMA}.t_intersections ti ON ST_Intersects(t.geometry, ti.geometry)
      WHERE t.name LIKE '%NCAR%' OR t.name LIKE '%Water Tank%'
      GROUP BY t.id, t.name
      ORDER BY t.name
    `);
    
    ncarDebug.rows.forEach(row => {
      console.log(`   ${row.name} (ID ${row.id}): ${row.intersection_count} intersection points`);
      if (row.intersection_count > 0) {
        console.log(`     Points: ${row.intersection_points.join(', ')}`);
      }
    });

    // Find the actual intersection point between NCAR Water Tank Road and NCAR Trail
    console.log('\n🔍 Finding actual intersection between NCAR Water Tank Road and NCAR Trail:');
    const actualIntersection = await client.query(`
      SELECT 
        a.name as trail_a,
        b.name as trail_b,
        ST_Distance(a.geometry, b.geometry) as distance_m,
        ST_AsText(ST_ClosestPoint(a.geometry, b.geometry)) as closest_point,
        ST_AsText(ST_ClosestPoint(b.geometry, a.geometry)) as closest_point_reverse
      FROM ${STAGING_SCHEMA}.trails a
      JOIN ${STAGING_SCHEMA}.trails b ON a.id < b.id
      WHERE (a.name LIKE '%NCAR%' AND b.name LIKE '%Water Tank%')
         OR (a.name LIKE '%Water Tank%' AND b.name LIKE '%NCAR%')
      ORDER BY distance_m ASC
    `);
    
    actualIntersection.rows.forEach(row => {
      console.log(`   ${row.trail_a} <-> ${row.trail_b}: distance=${row.distance_m.toFixed(1)}m`);
      console.log(`     Closest point from A to B: ${row.closest_point}`);
      console.log(`     Closest point from B to A: ${row.closest_point_reverse}`);
    });

    // Split trails at T-intersection points
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_with_t_splits AS
      WITH trail_intersections AS (
        SELECT 
          t.id as trail_id,
          t.name as trail_name,
          t.geometry as trail_geom,
          ARRAY_AGG(ti.geometry ORDER BY ST_LineLocatePoint(t.geometry, ti.geometry)) as intersection_points
        FROM ${STAGING_SCHEMA}.trails t
        LEFT JOIN ${STAGING_SCHEMA}.t_intersections ti ON ST_DWithin(t.geometry, ti.geometry, 0.0001)
        GROUP BY t.id, t.name, t.geometry
        HAVING COUNT(ti.geometry) > 0
      ),
              split_segments AS (
          SELECT 
            ti.trail_id as orig_id,
            ti.trail_name,
            CASE 
              WHEN array_length(ti.intersection_points, 1) = 1 THEN
                -- Single intersection point - split into 2 segments
                ARRAY[
                  ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), 1)
                ]
              WHEN array_length(ti.intersection_points, 1) = 2 THEN
                -- Two intersection points - split into 3 segments
                ARRAY[
                  ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2]), 1)
                ]
              WHEN array_length(ti.intersection_points, 1) = 3 THEN
                -- Three intersection points - split into 4 segments
                ARRAY[
                  ST_LineSubstring(ti.trail_geom, 0, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[1]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[2]), ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[3])),
                  ST_LineSubstring(ti.trail_geom, ST_LineLocatePoint(ti.trail_geom, ti.intersection_points[3]), 1)
                ]
              ELSE
                -- More than 3 points - keep original for now
                ARRAY[ti.trail_geom]
            END as segments,
            array_length(ti.intersection_points, 1) as point_count
          FROM trail_intersections ti
        ),
      unnest_segments AS (
        SELECT 
          orig_id,
          unnest(segments) as geometry
        FROM split_segments
      )
      SELECT 
        orig_id,
        geometry
      FROM unnest_segments
      WHERE ST_GeometryType(geometry) = 'ST_LineString'
        AND ST_Length(geometry::geography) > 1
    `);

    // Add non-intersecting trails back
    await client.query(`
      INSERT INTO ${STAGING_SCHEMA}.trails_with_t_splits (orig_id, geometry)
      SELECT a.id AS orig_id, a.geometry
      FROM ${STAGING_SCHEMA}.trails a
      WHERE NOT EXISTS (
        SELECT 1 FROM ${STAGING_SCHEMA}.t_intersections ti
        WHERE ST_Intersects(a.geometry, ti.geometry)
      )
    `);

          // Debug: Show splitting results (skip if table doesn't exist)
      try {
        const splitResults = await client.query(`
          SELECT 
            trail_name,
            point_count,
            array_length(segments, 1) as segment_count
          FROM temp_split_segments
          ORDER BY trail_name
        `);
        
        console.log('\n🔍 Splitting results:');
        splitResults.rows.forEach(row => {
          console.log(`   ${row.trail_name}: ${row.point_count} intersection points -> ${row.segment_count} segments`);
        });
      } catch (error) {
        console.log('\n🔍 Splitting results: Table not available');
      }

    // Replace the original trails table with T-split version
    await client.query(`DROP TABLE ${STAGING_SCHEMA}.trails`);
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails AS
      SELECT 
        row_number() OVER () AS id,
        'Trail ' || row_number() OVER () as name,
        geometry
      FROM ${STAGING_SCHEMA}.trails_with_t_splits
    `);

    // Step 5: Normalize to clean 2D LineStrings
    console.log('\n🔧 Step 4: Normalizing to clean 2D LineStrings...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.lines AS
      SELECT 
        id,
        name,
        ST_Force2D(
          ST_LineMerge(
            ST_CollectionExtract(ST_MakeValid(geometry), 2)
          )
        ) AS geom
      FROM ${STAGING_SCHEMA}.trails
    `);

    // Step 5: Snap tiny noise away
    console.log('\n🔧 Step 5: Snapping to grid to remove noise...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.grid AS
      SELECT 
        id,
        name,
        ST_SnapToGrid(geom, 0.00001) AS geom  -- ~1cm if SRID is degrees
      FROM ${STAGING_SCHEMA}.lines
    `);

    // Step 6: Node all intersections across the whole dataset
    console.log('\n🔧 Step 6: Noding all intersections...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.noded_union AS
      SELECT ST_Node(ST_UnaryUnion(ST_Collect(geom))) AS geom
      FROM ${STAGING_SCHEMA}.grid
    `);

    // Step 7: Split trails using ST_Difference to avoid self-splitting
    console.log('\n🔧 Step 7: Splitting trails at intersections...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.split AS
      SELECT 
        b.id AS orig_id,
        b.name,
        (ST_Dump(ST_Split(
          b.geom,
          ST_Difference(nu.geom, b.geom)   -- avoid "splitting by itself"
        ))).geom AS geom
      FROM ${STAGING_SCHEMA}.grid b
      CROSS JOIN ${STAGING_SCHEMA}.noded_union nu
    `);

    // Step 8: Materialize clean segments with metadata
    console.log('\n🔧 Step 8: Materializing clean segments...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_segments AS
      SELECT 
        row_number() OVER () AS id,
        orig_id,
        name,
        ST_Multi(geom) AS geom,
        ST_Length(geom::geography) as length_m
      FROM ${STAGING_SCHEMA}.split
      WHERE GeometryType(geom) IN ('LINESTRING','MULTILINESTRING')
    `);

    // Step 9: Toss micro-slivers
    console.log('\n🔧 Step 9: Removing micro-slivers...');
    await client.query(`
      DELETE FROM ${STAGING_SCHEMA}.trails_segments
      WHERE length_m < 1.0  -- Remove segments shorter than 1 meter
    `);



    // Step 10: Add source/target columns for pgRouting
    console.log('\n🔧 Step 10: Adding pgRouting columns...');
    await client.query(`
      ALTER TABLE ${STAGING_SCHEMA}.trails_segments 
      ADD COLUMN source BIGINT,
      ADD COLUMN target BIGINT
    `);

    // Step 11: Make it routable with pgRouting
    console.log('\n🔧 Step 11: Creating pgRouting topology...');
    const topologyResult = await client.query(`
      SELECT pgr_createTopology('${STAGING_SCHEMA}.trails_segments', 0.0001, 'geom', 'id', 'source', 'target')
    `);
    console.log(`📊 Topology creation result: ${JSON.stringify(topologyResult.rows[0])}`);

    // Step 12: Check results
    console.log('\n📊 Step 12: Checking results...');
    
    const segmentCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_segments`);
    console.log(`📊 Total segments: ${segmentCount.rows[0].count}`);

    const vertexCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_segments_vertices_pgr`);
    console.log(`📊 Total vertices: ${vertexCount.rows[0].count}`);

    const isolatedEdges = await client.query(`
      SELECT COUNT(*) as count 
      FROM ${STAGING_SCHEMA}.trails_segments 
      WHERE source IS NULL OR target IS NULL
    `);
    console.log(`📊 Isolated edges: ${isolatedEdges.rows[0].count}`);

    // Step 13: Show segment details
    console.log('\n📋 Step 13: Showing segment details...');
    const segmentDetails = await client.query(`
      SELECT 
        id,
        ROUND(length_m::numeric, 1) as length_m,
        ST_NumPoints(geom) as points,
        source,
        target,
        ST_IsValid(geom) as valid
      FROM ${STAGING_SCHEMA}.trails_segments 
      ORDER BY length_m DESC
      LIMIT 10
    `);

    segmentDetails.rows.forEach(segment => {
      console.log(`   ID ${segment.id}: ${segment.length_m}m (${segment.points} points, valid: ${segment.valid}, source: ${segment.source}, target: ${segment.target})`);
    });

    // Step 14: Test routing connectivity
    console.log('\n🔍 Step 14: Testing routing connectivity...');
    try {
      const routingTest = await client.query(`
        SELECT COUNT(*) as path_count
        FROM pgr_dijkstra(
          'SELECT id, source, target, length_m as cost FROM ${STAGING_SCHEMA}.trails_segments',
          1, 2, false
        )
      `);
      console.log(`📊 Routing test: ${routingTest.rows[0].path_count} path segments found`);
    } catch (error) {
      console.log(`⚠️ Routing test failed: ${(error as Error).message}`);
    }

    // Step 15: Export results for visualization
    console.log('\n📤 Step 15: Exporting results for visualization...');
    const exportResults = await client.query(`
      SELECT 
        id,
        COALESCE(name, 'Segment ' || id) as name,
        'segment' as trail_type,
        'unknown' as surface,
        'unknown' as difficulty,
        ROUND(length_m::numeric / 1000, 3) as length_km,
        source,
        target,
        orig_id,
        ST_AsGeoJSON(ST_Force2D(geom)) as geometry
      FROM ${STAGING_SCHEMA}.trails_segments
      ORDER BY id
    `);

    const geojson = {
      type: 'FeatureCollection',
      features: exportResults.rows.map(row => ({
        type: 'Feature',
        properties: {
          id: row.id,
          name: row.name,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          source: row.source,
          target: row.target,
          orig_id: row.orig_id
        },
        geometry: JSON.parse(row.geometry)
      }))
    };

    const outputDir = 'test-output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'nodefirst-topology-results.geojson');
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`📊 Found ${exportResults.rows.length} segments in results`);
    console.log(`✅ Exported ${exportResults.rows.length} segments to ${outputPath}`);

    // Step 16: Summary
    console.log('\n📋 Summary:');
    console.log(`   - Original trails: ${originalTrails.rows.length}`);
    console.log(`   - Final segments: ${segmentCount.rows[0].count}`);
    console.log(`   - Vertices: ${vertexCount.rows[0].count}`);
    console.log(`   - Isolated edges: ${isolatedEdges.rows[0].count}`);

    console.log(`🔍 Keeping schema ${STAGING_SCHEMA} for debugging`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
