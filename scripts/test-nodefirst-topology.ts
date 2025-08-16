import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const STAGING_SCHEMA = `test_nodefirst_topology_${Date.now()}`;

/**
 * Process Y-intersections where one trail ends very close to another trail's line
 */
async function processYIntersections(client: Client, stagingSchema: string, tolerance: number): Promise<void> {
  console.log('   🔍 Processing Y-intersections...');
  
  // Debug: Check what trails we have and their endpoints
  const debugTrails = await client.query(`
    SELECT 
      orig_id,
      trail_name,
      ST_AsText(ST_StartPoint(geometry)) as start_point,
      ST_AsText(ST_EndPoint(geometry)) as end_point,
      ST_Length(geometry::geography) as length_m
    FROM ${stagingSchema}.trails_with_t_splits
    ORDER BY trail_name, orig_id
  `);
  
  console.log('   🔍 Debug: Available trails for Y-intersection detection:');
  debugTrails.rows.forEach(row => {
    console.log(`     ${row.trail_name} (${row.orig_id}): ${row.length_m.toFixed(1)}m, end: ${row.end_point}`);
  });
  
  await client.query(`
    CREATE TABLE ${stagingSchema}.y_intersection_results AS
         WITH y_intersections AS (
       -- Find Y-intersections where one trail ends very close to another trail's line
       SELECT 
         a.orig_id as trail_a_id,
         a.trail_name as trail_a_name,
         a.trail_source as trail_a_source,
         a.trail_surface as trail_a_surface,
         a.trail_difficulty as trail_a_difficulty,
         a.trail_trail_type as trail_a_trail_type,
         a.geometry as trail_a_geom,
         b.orig_id as trail_b_id,
         b.trail_name as trail_b_name,
         b.trail_source as trail_b_source,
         b.trail_surface as trail_b_surface,
         b.trail_difficulty as trail_b_difficulty,
         b.trail_trail_type as trail_b_trail_type,
         b.geometry as trail_b_geom,
         ST_Distance(ST_EndPoint(a.geometry), b.geometry) as distance_to_main,
         ST_ClosestPoint(b.geometry, ST_EndPoint(a.geometry)) as closest_point
       FROM ${stagingSchema}.trails_with_t_splits a
       JOIN ${stagingSchema}.trails_with_t_splits b ON a.orig_id != b.orig_id
       WHERE ST_DWithin(ST_EndPoint(a.geometry), b.geometry, ${tolerance * 5}) -- Much more generous tolerance for Y-intersections
         AND NOT ST_Intersects(ST_EndPoint(a.geometry), b.geometry) -- But not exactly intersecting
         AND ST_Length(a.geometry::geography) > 1 -- Very low minimum length for spurs
       
       UNION ALL
       
       -- Find Y-intersections where trails intersect at points along their length (not just endpoints)
       SELECT 
         a.orig_id as trail_a_id,
         a.trail_name as trail_a_name,
         a.trail_source as trail_a_source,
         a.trail_surface as trail_a_surface,
         a.trail_difficulty as trail_a_difficulty,
         a.trail_trail_type as trail_a_trail_type,
         a.geometry as trail_a_geom,
         b.orig_id as trail_b_id,
         b.trail_name as trail_b_name,
         b.trail_source as trail_b_source,
         b.trail_surface as trail_b_surface,
         b.trail_difficulty as trail_b_difficulty,
         b.trail_trail_type as trail_b_trail_type,
         b.geometry as trail_b_geom,
         0 as distance_to_main,
         intersection_point.geom as closest_point
       FROM ${stagingSchema}.trails_with_t_splits a
       JOIN ${stagingSchema}.trails_with_t_splits b ON a.orig_id != b.orig_id
       CROSS JOIN LATERAL ST_Dump(ST_Intersection(a.geometry, b.geometry)) intersection_point
       WHERE ST_GeometryType(intersection_point.geom) = 'ST_Point'
         AND NOT ST_Equals(intersection_point.geom, ST_StartPoint(a.geometry))
         AND NOT ST_Equals(intersection_point.geom, ST_EndPoint(a.geometry))
         AND NOT ST_Equals(intersection_point.geom, ST_StartPoint(b.geometry))
         AND NOT ST_Equals(intersection_point.geom, ST_EndPoint(b.geometry))
         AND ST_Length(a.geometry::geography) > 1
         AND ST_Length(b.geometry::geography) > 1
     ),
         y_split_spur_results AS (
       SELECT 
         trail_a_id as orig_id,
         trail_a_name as trail_name,
         trail_a_source as trail_source,
         trail_a_surface as trail_surface,
         trail_a_difficulty as trail_difficulty,
         trail_a_trail_type as trail_trail_type,
         CASE 
           WHEN distance_to_main > 0.1 THEN
             -- For endpoint-to-line intersections, snap the endpoint
             ST_SetPoint(trail_a_geom, ST_NPoints(trail_a_geom) - 1, closest_point)
           ELSE
             -- For line-to-line intersections, split the trail
             split_geom.geom
         END as geometry,
         'y_split_spur' as split_type,
         distance_to_main
       FROM y_intersections
       LEFT JOIN LATERAL ST_Dump(ST_Split(trail_a_geom, closest_point)) split_geom ON distance_to_main = 0
       WHERE (distance_to_main > 0.1 AND ST_GeometryType(ST_SetPoint(trail_a_geom, ST_NPoints(trail_a_geom) - 1, closest_point)) = 'ST_LineString')
          OR (distance_to_main = 0 AND ST_GeometryType(split_geom.geom) = 'ST_LineString')
       AND ST_Length(CASE 
         WHEN distance_to_main > 0.1 THEN ST_SetPoint(trail_a_geom, ST_NPoints(trail_a_geom) - 1, closest_point)
         ELSE split_geom.geom
       END::geography) > 1
     ),
         y_split_main_results AS (
       SELECT 
         trail_b_id as orig_id,
         trail_b_name as trail_name,
         trail_b_source as trail_source,
         trail_b_surface as trail_surface,
         trail_b_difficulty as trail_difficulty,
         trail_b_trail_type as trail_trail_type,
         split_geom.geom as geometry,
         'y_split_main' as split_type,
         distance_to_main
       FROM y_intersections
       CROSS JOIN LATERAL ST_Dump(ST_Split(trail_b_geom, closest_point)) split_geom
       WHERE ST_GeometryType(split_geom.geom) = 'ST_LineString'
         AND ST_Length(split_geom.geom::geography) > 1
     )
    SELECT * FROM y_split_spur_results
    UNION ALL
    SELECT * FROM y_split_main_results
  `);
  
  const ySplitCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.y_intersection_results`);
  console.log(`   ✅ Y-intersections: ${ySplitCount.rows[0].count} segments created`);
}

/**
 * Process X-intersections where trails cross each other
 */
async function processXIntersections(client: Client, stagingSchema: string, tolerance: number): Promise<void> {
  console.log('   🔍 Processing X-intersections...');
  
  // Debug: Check for crossing trails
  const debugCrossings = await client.query(`
    SELECT 
      a.trail_name as trail_a,
      b.trail_name as trail_b,
      ST_Crosses(a.geometry, b.geometry) as crosses,
      ST_Length(a.geometry::geography) as length_a,
      ST_Length(b.geometry::geography) as length_b
    FROM ${stagingSchema}.trails_with_t_splits a
    JOIN ${stagingSchema}.trails_with_t_splits b ON a.orig_id != b.orig_id
    WHERE ST_Crosses(a.geometry, b.geometry)
  `);
  
  console.log('   🔍 Debug: Crossing trails found:');
  debugCrossings.rows.forEach(row => {
    console.log(`     ${row.trail_a} (${row.length_a.toFixed(1)}m) crosses ${row.trail_b} (${row.length_b.toFixed(1)}m)`);
  });
  
  await client.query(`
    CREATE TABLE ${stagingSchema}.x_intersection_results AS
    WITH x_intersections AS (
      SELECT 
        a.orig_id as trail_a_id,
        a.trail_name as trail_a_name,
        a.trail_source as trail_a_source,
        a.trail_surface as trail_a_surface,
        a.trail_difficulty as trail_a_difficulty,
        a.trail_trail_type as trail_a_trail_type,
        a.geometry as trail_a_geom,
        b.orig_id as trail_b_id,
        b.trail_name as trail_b_name,
        b.trail_source as trail_b_source,
        b.trail_surface as trail_b_surface,
        b.trail_difficulty as trail_b_difficulty,
        b.trail_trail_type as trail_b_trail_type,
        b.geometry as trail_b_geom,
        ST_Distance(a.geometry, b.geometry) as distance_to_main,
        ST_ClosestPoint(b.geometry, a.geometry) as closest_point
      FROM ${stagingSchema}.trails_with_t_splits a
      JOIN ${stagingSchema}.trails_with_t_splits b ON a.orig_id != b.orig_id
      WHERE ST_Crosses(a.geometry, b.geometry) -- Trails that cross each other
        AND ST_Length(a.geometry::geography) > 5 -- Minimum length
    ),
    x_split_trail_a_results AS (
      SELECT 
        trail_a_id as orig_id,
        trail_a_name as trail_name,
        trail_a_source as trail_source,
        trail_a_surface as trail_surface,
        trail_a_difficulty as trail_difficulty,
        trail_a_trail_type as trail_trail_type,
        split_geom.geom as geometry,
        'x_split_trail_a' as split_type,
        distance_to_main
      FROM x_intersections
      CROSS JOIN LATERAL ST_Dump(ST_Split(trail_a_geom, closest_point)) split_geom
      WHERE ST_GeometryType(split_geom.geom) = 'ST_LineString'
        AND ST_Length(split_geom.geom::geography) > 1
    ),
    x_split_trail_b_results AS (
      SELECT 
        trail_b_id as orig_id,
        trail_b_name as trail_name,
        trail_b_source as trail_source,
        trail_b_surface as trail_surface,
        trail_b_difficulty as trail_difficulty,
        trail_b_trail_type as trail_trail_type,
        split_geom.geom as geometry,
        'x_split_trail_b' as split_type,
        distance_to_main
      FROM x_intersections
      CROSS JOIN LATERAL ST_Dump(ST_Split(trail_b_geom, closest_point)) split_geom
      WHERE ST_GeometryType(split_geom.geom) = 'ST_LineString'
        AND ST_Length(split_geom.geom::geography) > 1
    )
    SELECT * FROM x_split_trail_a_results
    UNION ALL
    SELECT * FROM x_split_trail_b_results
  `);
  
  const xSplitCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.x_intersection_results`);
  console.log(`   ✅ X-intersections: ${xSplitCount.rows[0].count} segments created`);
}

/**
 * Process P/D double joins (self-intersections or loops)
 */
async function processPDoubleJoins(client: Client, stagingSchema: string, tolerance: number): Promise<void> {
  console.log('   🔍 Processing P/D double joins...');
  
  // Debug: Check for potential self-intersections and loops
  const debugSelfIntersections = await client.query(`
    SELECT 
      trail_name,
      orig_id,
      ST_NumPoints(geometry) as num_points,
      ST_DWithin(ST_StartPoint(geometry), ST_EndPoint(geometry), ${tolerance * 10}) as is_loop,
      ST_Length(geometry::geography) as length_m
    FROM ${stagingSchema}.trails_with_t_splits
    WHERE ST_NumPoints(geometry) > 5
  `);
  
  console.log('   🔍 Debug: Potential P/D double joins:');
  debugSelfIntersections.rows.forEach(row => {
    console.log(`     ${row.trail_name} (${row.orig_id}): ${row.num_points} points, ${row.length_m.toFixed(1)}m, loop: ${row.is_loop}`);
  });
  
  await client.query(`
    CREATE TABLE ${stagingSchema}.p_d_intersection_results AS
    WITH p_d_intersections AS (
      SELECT 
        a.orig_id as trail_a_id,
        a.trail_name as trail_a_name,
        a.trail_source as trail_a_source,
        a.trail_surface as trail_a_surface,
        a.trail_difficulty as trail_a_difficulty,
        a.trail_trail_type as trail_a_trail_type,
        a.geometry as trail_a_geom,
        0 as distance_to_main,
        ST_StartPoint(a.geometry) as closest_point -- Use start point as reference
      FROM ${stagingSchema}.trails_with_t_splits a
             WHERE ST_NumPoints(a.geometry) > 5 -- Lower threshold for checking trails
         AND (
           -- Check if trail has self-intersections
           EXISTS (
             SELECT 1 FROM (
               SELECT (ST_Dump(ST_Intersection(a.geometry, a.geometry))).geom as intersection_point
             ) self_intersections
             WHERE ST_GeometryType(intersection_point) = 'ST_Point'
               AND NOT ST_Equals(intersection_point, ST_StartPoint(a.geometry))
               AND NOT ST_Equals(intersection_point, ST_EndPoint(a.geometry))
           )
           OR
           -- Check if trail has loops (start and end points are close)
           ST_DWithin(ST_StartPoint(a.geometry), ST_EndPoint(a.geometry), ${tolerance * 10})
         )
    ),
    p_d_split_results AS (
      SELECT 
        trail_a_id as orig_id,
        trail_a_name as trail_name,
        trail_a_source as trail_source,
        trail_a_surface as trail_surface,
        trail_a_difficulty as trail_difficulty,
        trail_a_trail_type as trail_trail_type,
        split_geom.geom as geometry,
        'p_d_split_trail_a' as split_type,
        distance_to_main
      FROM p_d_intersections
      CROSS JOIN LATERAL ST_Dump(ST_Split(trail_a_geom, closest_point)) split_geom
      WHERE ST_GeometryType(split_geom.geom) = 'ST_LineString'
        AND ST_Length(split_geom.geom::geography) > 1
    )
    SELECT * FROM p_d_split_results
  `);
  
  const pDSplitCount = await client.query(`SELECT COUNT(*) as count FROM ${stagingSchema}.p_d_intersection_results`);
  console.log(`   ✅ P/D double joins: ${pDSplitCount.rows[0].count} segments created`);
}

async function main() {
  console.log('\n🧪 Testing node-first topology creation with improved deduplication and 3D preservation...\n');

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

    // Step 2: Copy COTREX trails from the same bbox as before, preserving all metadata
    console.log('\n📋 Copying COTREX trails from bbox with full metadata...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails AS
      SELECT 
        id,
        name,
        source,
        surface,
        difficulty,
        trail_type,
        geometry,
        ST_Length(geometry::geography) as length_m
      FROM public.trails 
      WHERE source = 'cotrex' 
        AND ST_Intersects(geometry, ST_MakeEnvelope(-105.29123174925316, 39.96928418458248, -105.270, 39.995, 4326))
        AND geometry IS NOT NULL 
        AND ST_IsValid(geometry)
    `);

    const trailCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails`);
    console.log(`✅ Copied ${trailCount.rows[0].count} COTREX trails`);

    // Step 3: Show original trails
    console.log('\n📋 Original trails:');
    const originalTrails = await client.query(`
      SELECT name, length_m
      FROM ${STAGING_SCHEMA}.trails 
      ORDER BY name, length_m DESC
    `);
    originalTrails.rows.forEach(trail => {
      console.log(`   ${trail.name}: ${(trail.length_m / 1000).toFixed(1)}km`);
    });

    // Step 4: Create intersection points with improved deduplication
    console.log('\n🔧 Step 4: Creating intersection points with improved deduplication...');
    
    const tolerance = 0.0001; // ~10m
    const dedupTolerance = tolerance * 0.01; // 1% of tolerance for deduplication
    
    console.log(`🔍 Using tolerance: ${tolerance} (~${Math.round(tolerance * 111000)}m)`);
    console.log(`🔍 Deduplication tolerance: ${dedupTolerance} (~${Math.round(dedupTolerance * 111000)}m)`);
    
    // Create intersection points table
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
      )
      SELECT DISTINCT ST_ClosestPoint(t.geometry, ip.geometry) AS geometry
      FROM all_intersection_points ip
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
        WHERE ST_DWithin(existing.geometry, intersection_point, ${dedupTolerance}) -- Avoid duplicates
      )
    `);

    // Count raw intersection points
    const rawIntersectionCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.t_intersections`);
    console.log(`📊 Created ${rawIntersectionCount.rows[0].count} raw intersection points`);

    // IMPROVED DEDUPLICATION: Use a more aggressive approach
    console.log('\n🔧 Step 4.5: Applying improved deduplication...');
    
    // Create a table with intersection points and their grid-snapped versions
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.intersection_analysis AS
      SELECT 
        geometry,
        ST_SnapToGrid(geometry, ${dedupTolerance}) as grid_geometry,
        ST_AsText(geometry) as point_text,
        ST_X(geometry) as x,
        ST_Y(geometry) as y
      FROM ${STAGING_SCHEMA}.t_intersections
    `);
    
    // Show duplicate analysis
    const duplicateAnalysis = await client.query(`
      SELECT 
        grid_geometry,
        COUNT(*) as duplicate_count,
        array_agg(point_text ORDER BY point_text) as points
      FROM ${STAGING_SCHEMA}.intersection_analysis
      GROUP BY grid_geometry
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
    `);
    
    console.log(`🔍 Found ${duplicateAnalysis.rows.length} groups of duplicate points:`);
    duplicateAnalysis.rows.forEach((row, index) => {
      console.log(`   Group ${index + 1}: ${row.duplicate_count} duplicates`);
      row.points.forEach((point: string, pointIndex: number) => {
        console.log(`     ${pointIndex + 1}. ${point}`);
      });
    });

    // Create deduplicated intersection points by selecting one point per grid cell
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.t_intersections_dedup AS
      SELECT DISTINCT ON (ST_SnapToGrid(geometry, ${dedupTolerance})) 
        geometry
      FROM ${STAGING_SCHEMA}.t_intersections
      ORDER BY ST_SnapToGrid(geometry, ${dedupTolerance}), geometry
    `);
    
    await client.query(`DROP TABLE ${STAGING_SCHEMA}.t_intersections`);
    await client.query(`ALTER TABLE ${STAGING_SCHEMA}.t_intersections_dedup RENAME TO t_intersections`);
    
    // Count deduplicated intersection points
    const dedupIntersectionCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.t_intersections`);
    console.log(`📊 After deduplication: ${dedupIntersectionCount.rows[0].count} intersection points`);
    console.log(`📊 Removed ${rawIntersectionCount.rows[0].count - dedupIntersectionCount.rows[0].count} duplicate points`);

    // Check specific NCAR trails
    const ncarCheck = await client.query(`
      SELECT 
        t.name,
        COUNT(ti.geometry) as intersection_count,
        array_agg(ST_AsText(ti.geometry)) as intersection_points
      FROM ${STAGING_SCHEMA}.trails t
      LEFT JOIN ${STAGING_SCHEMA}.t_intersections ti ON ST_DWithin(t.geometry, ti.geometry, ${tolerance})
      WHERE t.name LIKE '%NCAR%' OR t.name LIKE '%Water Tank%'
      GROUP BY t.name
      ORDER BY t.name
    `);
    
    console.log(`🔍 NCAR trails after deduplication:`);
    ncarCheck.rows.forEach(row => {
      console.log(`   ${row.name}: ${row.intersection_count} intersection points`);
      if (row.intersection_count > 0) {
        row.intersection_points.forEach((point: string, index: number) => {
          console.log(`     ${index + 1}. ${point}`);
        });
      }
    });

    // Step 5: Split trails at T-intersection points with improved logic
    console.log('\n🔧 Step 5: Splitting trails at intersection points...');
    
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_with_t_splits AS
      WITH trail_intersections AS (
        SELECT 
          t.id as trail_id,
          t.name as trail_name,
          t.source as trail_source,
          t.surface as trail_surface,
          t.difficulty as trail_difficulty,
          t.trail_type as trail_trail_type,
          t.geometry as trail_geom,
          ARRAY_AGG(ti.geometry ORDER BY ST_LineLocatePoint(t.geometry, ti.geometry)) as intersection_points
        FROM ${STAGING_SCHEMA}.trails t
        LEFT JOIN ${STAGING_SCHEMA}.t_intersections ti ON ST_DWithin(t.geometry, ti.geometry, ${tolerance})
        GROUP BY t.id, t.name, t.source, t.surface, t.difficulty, t.trail_type, t.geometry
        HAVING COUNT(ti.geometry) > 0
      ),
      split_segments AS (
        SELECT 
          ti.trail_id as orig_id,
          ti.trail_name,
          ti.trail_source,
          ti.trail_surface,
          ti.trail_difficulty,
          ti.trail_trail_type,
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
          trail_source,
          trail_surface,
          trail_difficulty,
          trail_trail_type,
          unnest(segments) as geometry,
          point_count
        FROM split_segments
      )
      SELECT 
        orig_id,
        trail_name,
        trail_source,
        trail_surface,
        trail_difficulty,
        trail_trail_type,
        geometry,
        point_count
      FROM unnest_segments
      WHERE ST_GeometryType(geometry) = 'ST_LineString'
        AND ST_Length(geometry::geography) > 1
    `);

    // Add non-intersecting trails back
    await client.query(`
      INSERT INTO ${STAGING_SCHEMA}.trails_with_t_splits (orig_id, trail_name, trail_source, trail_surface, trail_difficulty, trail_trail_type, geometry, point_count)
      SELECT 
        a.id AS orig_id, 
        a.name as trail_name,
        a.source as trail_source,
        a.surface as trail_surface,
        a.difficulty as trail_difficulty,
        a.trail_type as trail_trail_type,
        a.geometry, 
        0 as point_count
      FROM ${STAGING_SCHEMA}.trails a
      WHERE NOT EXISTS (
        SELECT 1 FROM ${STAGING_SCHEMA}.t_intersections ti
        WHERE ST_DWithin(a.geometry, ti.geometry, ${tolerance})
      )
    `);

    // Count final segments
    const segmentCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_with_t_splits`);
    
    // Count segments for NCAR trails specifically
    const ncarSegmentCount = await client.query(`
      SELECT 
        trail_name,
        COUNT(*) as segment_count,
        point_count
      FROM ${STAGING_SCHEMA}.trails_with_t_splits
      WHERE trail_name LIKE '%NCAR%' OR trail_name LIKE '%Water Tank%'
      GROUP BY trail_name, point_count
      ORDER BY trail_name
    `);
    
         console.log(`📊 Final splitting results:`);
     console.log(`   Total segments: ${segmentCount.rows[0].count}`);
     console.log(`   NCAR trail segments:`);
     ncarSegmentCount.rows.forEach(row => {
       console.log(`     ${row.trail_name}: ${row.segment_count} segments (from ${row.point_count} intersection points)`);
     });

     // Step 5.5: ENHANCED INTERSECTION DETECTION AND HANDLING
     console.log('\n🔧 Step 5.5: Enhanced intersection detection and handling...');
     
     // Process Y-intersections
     await processYIntersections(client, STAGING_SCHEMA, tolerance);
     
     // Process X-intersections
     await processXIntersections(client, STAGING_SCHEMA, tolerance);
     
     // Process P/D double joins
     await processPDoubleJoins(client, STAGING_SCHEMA, tolerance);
     
     // Combine all intersection results
     await client.query(`
       CREATE TABLE ${STAGING_SCHEMA}.trails_with_y_splits AS
       SELECT * FROM ${STAGING_SCHEMA}.y_intersection_results
       UNION ALL
       SELECT * FROM ${STAGING_SCHEMA}.x_intersection_results
       UNION ALL
       SELECT * FROM ${STAGING_SCHEMA}.p_d_intersection_results
     `);

     // Add trails that weren't involved in Y-splitting
     await client.query(`
       INSERT INTO ${STAGING_SCHEMA}.trails_with_y_splits (orig_id, trail_name, trail_source, trail_surface, trail_difficulty, trail_trail_type, geometry, split_type, distance_to_main)
       SELECT 
         t.orig_id,
         t.trail_name,
         t.trail_source,
         t.trail_surface,
         t.trail_difficulty,
         t.trail_trail_type,
         t.geometry,
         'no_y_split' as split_type,
         0 as distance_to_main
       FROM ${STAGING_SCHEMA}.trails_with_t_splits t
       WHERE NOT EXISTS (
         SELECT 1 FROM ${STAGING_SCHEMA}.trails_with_y_splits s
         WHERE s.orig_id = t.orig_id
       )
     `);

     // Count enhanced intersection results
     const ySplitCount = await client.query(`
       SELECT 
         split_type,
         COUNT(*) as count,
         AVG(distance_to_main * 111000) as avg_distance_m
       FROM ${STAGING_SCHEMA}.trails_with_y_splits
       GROUP BY split_type
       ORDER BY split_type
     `);
     
     console.log(`📊 Enhanced intersection results:`);
     ySplitCount.rows.forEach(row => {
       console.log(`   ${row.split_type}: ${row.count} segments (avg distance: ${row.avg_distance_m?.toFixed(1)}m)`);
     });

     // Replace the trails table with Y-split version
     await client.query(`DROP TABLE ${STAGING_SCHEMA}.trails_with_t_splits`);
     await client.query(`
       CREATE TABLE ${STAGING_SCHEMA}.trails_with_t_splits AS
       SELECT * FROM ${STAGING_SCHEMA}.trails_with_y_splits
     `);

     // Step 6: THIRD PASS - Snap spur endpoints to main trails within 3 meters
    console.log('\n🔧 Step 6: Third pass - Snapping spur endpoints to main trails...');
    
    const snapTolerance = 3.0; // 3 meters in UTM
    const snapToleranceDegrees = snapTolerance / 111000; // Convert to degrees
    
         await client.query(`
       CREATE TABLE ${STAGING_SCHEMA}.trails_with_spur_snapping AS
       WITH spur_candidates AS (
         -- Find trails that might be spurs (shorter trails that end near longer trails)
         SELECT 
           short.orig_id as spur_id,
           short.trail_name as spur_name,
           short.geometry as spur_geom,
           short.orig_id as spur_orig_id,
           short.trail_source as spur_source,
           short.trail_surface as spur_surface,
           short.trail_difficulty as spur_difficulty,
           short.trail_trail_type as spur_trail_type,
           long.orig_id as main_id,
           long.trail_name as main_name,
           long.geometry as main_geom,
           long.orig_id as main_orig_id,
           long.trail_source as main_source,
           long.trail_surface as main_surface,
           long.trail_difficulty as main_difficulty,
           long.trail_trail_type as main_trail_type,
           ST_Distance(ST_EndPoint(short.geometry), long.geometry) as distance_to_main
         FROM ${STAGING_SCHEMA}.trails_with_t_splits short
         JOIN ${STAGING_SCHEMA}.trails_with_t_splits long ON short.orig_id != long.orig_id
         WHERE ST_Length(short.geometry::geography) < ST_Length(long.geometry::geography) * 0.5 -- Spur is less than half the length of main trail
           AND ST_DWithin(ST_EndPoint(short.geometry), long.geometry, ${snapToleranceDegrees}) -- Endpoint within 3m of main trail
           AND NOT ST_Intersects(ST_EndPoint(short.geometry), long.geometry) -- But not exactly intersecting
       ),
      snapped_spurs AS (
        SELECT 
          spur_id,
          spur_name,
          spur_orig_id,
          spur_source,
          spur_surface,
          spur_difficulty,
          spur_trail_type,
          main_id,
          main_name,
          main_orig_id,
          main_source,
          main_surface,
          main_difficulty,
          main_trail_type,
          -- Snap spur endpoint to main trail
          ST_SetPoint(
            spur_geom, 
            ST_NPoints(spur_geom) - 1, 
            ST_ClosestPoint(main_geom, ST_EndPoint(spur_geom))
          ) as snapped_spur_geom,
          -- Split main trail at the snapped point
          (ST_Dump(ST_Split(main_geom, ST_ClosestPoint(main_geom, ST_EndPoint(spur_geom))))).geom as split_main_geom,
          distance_to_main
        FROM spur_candidates
        WHERE distance_to_main > 0.1 -- Only snap if there's a meaningful distance
      )
      SELECT 
        spur_id as id,
        spur_name as trail_name,
        spur_orig_id as orig_id,
        spur_source as trail_source,
        spur_surface as trail_surface,
        spur_difficulty as trail_difficulty,
        spur_trail_type as trail_trail_type,
        snapped_spur_geom as geometry,
        'spur_snapped' as split_type,
        distance_to_main
      FROM snapped_spurs
      WHERE ST_GeometryType(snapped_spur_geom) = 'ST_LineString'
        AND ST_Length(snapped_spur_geom::geography) > 1
      
      UNION ALL
      
      SELECT 
        main_id as id,
        main_name as trail_name,
        main_orig_id as orig_id,
        main_source as trail_source,
        main_surface as trail_surface,
        main_difficulty as trail_difficulty,
        main_trail_type as trail_trail_type,
        split_main_geom as geometry,
        'main_split' as split_type,
        distance_to_main
      FROM snapped_spurs
      WHERE ST_GeometryType(split_main_geom) = 'ST_LineString'
        AND ST_Length(split_main_geom::geography) > 1
    `);

         // Add trails that weren't involved in spur snapping
     await client.query(`
       INSERT INTO ${STAGING_SCHEMA}.trails_with_spur_snapping (id, trail_name, orig_id, trail_source, trail_surface, trail_difficulty, trail_trail_type, geometry, split_type, distance_to_main)
       SELECT 
         t.orig_id,
         t.trail_name,
         t.orig_id,
         t.trail_source,
         t.trail_surface,
         t.trail_difficulty,
         t.trail_trail_type,
         t.geometry,
         'no_spur' as split_type,
         0 as distance_to_main
       FROM ${STAGING_SCHEMA}.trails_with_t_splits t
       WHERE NOT EXISTS (
         SELECT 1 FROM ${STAGING_SCHEMA}.trails_with_spur_snapping s
         WHERE s.orig_id = t.orig_id
       )
     `);

    // Count spur snapping results
    const spurSnapCount = await client.query(`
      SELECT 
        split_type,
        COUNT(*) as count,
        AVG(distance_to_main * 111000) as avg_distance_m
      FROM ${STAGING_SCHEMA}.trails_with_spur_snapping
      GROUP BY split_type
      ORDER BY split_type
    `);
    
    console.log(`📊 Spur snapping results:`);
    spurSnapCount.rows.forEach(row => {
      console.log(`   ${row.split_type}: ${row.count} segments (avg distance: ${row.avg_distance_m?.toFixed(1)}m)`);
    });

         // Replace the trails table with spur-snapped version
     await client.query(`DROP TABLE ${STAGING_SCHEMA}.trails_with_t_splits`);
     await client.query(`DROP TABLE IF EXISTS ${STAGING_SCHEMA}.trails`);
     await client.query(`
       CREATE TABLE ${STAGING_SCHEMA}.trails AS
       SELECT 
         row_number() OVER () AS id,
         trail_name as name,
         orig_id,
         trail_source as source,
         trail_surface as surface,
         trail_difficulty as difficulty,
         trail_trail_type as trail_type,
         geometry,
         split_type,
         distance_to_main
       FROM ${STAGING_SCHEMA}.trails_with_spur_snapping
     `);

    // Step 7: Normalize to clean LineStrings (force 2D for pgRouting)
    console.log('\n🔧 Step 7: Normalizing to clean LineStrings (force 2D for pgRouting)...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.lines AS
      SELECT 
        id,
        name,
        orig_id,
        source,
        surface,
        difficulty,
        trail_type,
        split_type,
        distance_to_main,
        ST_Force2D(
          ST_LineMerge(
            ST_CollectionExtract(ST_MakeValid(geometry), 2)
          )
        ) AS geom
      FROM ${STAGING_SCHEMA}.trails
    `);

    // Step 8: Snap tiny noise away (2D for pgRouting)
    console.log('\n🔧 Step 8: Snapping to grid to remove noise (2D for pgRouting)...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.grid AS
      SELECT 
        id,
        name,
        orig_id,
        source,
        surface,
        difficulty,
        trail_type,
        split_type,
        distance_to_main,
        ST_SnapToGrid(geom, 0.00001) AS geom  -- ~1cm if SRID is degrees, 2D
      FROM ${STAGING_SCHEMA}.lines
    `);

    // Step 9: Node all intersections across the whole dataset (2D for pgRouting)
    console.log('\n🔧 Step 9: Noding all intersections (2D for pgRouting)...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.noded_union AS
      SELECT ST_Node(ST_UnaryUnion(ST_Collect(geom))) AS geom
      FROM ${STAGING_SCHEMA}.grid
    `);

    // Step 10: Split trails using ST_Difference to avoid self-splitting (2D for pgRouting)
    console.log('\n🔧 Step 10: Splitting trails at intersections (2D for pgRouting)...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.split AS
      SELECT 
        b.id AS orig_id,
        b.name,
        b.orig_id as original_trail_id,
        b.source,
        b.surface,
        b.difficulty,
        b.trail_type,
        b.split_type,
        b.distance_to_main,
        dump.geom AS geom
      FROM ${STAGING_SCHEMA}.grid b
      CROSS JOIN ${STAGING_SCHEMA}.noded_union nu,
      LATERAL ST_Dump(ST_Split(
        b.geom,
        ST_Difference(nu.geom, b.geom)   -- avoid "splitting by itself"
      )) AS dump
      WHERE ST_GeometryType(dump.geom) = 'ST_LineString'
    `);

    // Step 11: Materialize clean segments with metadata (2D for pgRouting)
    console.log('\n🔧 Step 11: Materializing clean segments (2D for pgRouting)...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_segments AS
      SELECT 
        row_number() OVER () AS id,
        orig_id,
        name,
        original_trail_id,
        source as datasource,
        surface,
        difficulty,
        trail_type,
        split_type,
        distance_to_main,
        geom,
        ST_Length(geom::geography) as length_m
      FROM ${STAGING_SCHEMA}.split
      WHERE GeometryType(geom) IN ('LINESTRING','MULTILINESTRING')
    `);

    // Step 11.5: Create 3D geometry table for trail/route level data
    console.log('\n🔧 Step 11.5: Creating 3D geometry table for trail/route data...');
    await client.query(`
      CREATE TABLE ${STAGING_SCHEMA}.trails_3d AS
      SELECT 
        ts.id,
        ts.orig_id,
        ts.name,
        ts.original_trail_id,
        ts.datasource,
        ts.surface,
        ts.difficulty,
        ts.trail_type,
        ts.split_type,
        ts.distance_to_main,
        ts.length_m,
        -- Get the original 3D geometry from the trails table
        t.geometry as geom_3d
      FROM ${STAGING_SCHEMA}.trails_segments ts
      JOIN ${STAGING_SCHEMA}.trails t ON ts.original_trail_id = t.orig_id
    `);

    // Step 12: Toss micro-slivers
    console.log('\n🔧 Step 12: Removing micro-slivers...');
    await client.query(`
      DELETE FROM ${STAGING_SCHEMA}.trails_segments
      WHERE length_m < 1.0  -- Remove segments shorter than 1 meter
    `);

    // Step 13: Add source/target columns for pgRouting
    console.log('\n🔧 Step 13: Adding pgRouting columns...');
    await client.query(`
      ALTER TABLE ${STAGING_SCHEMA}.trails_segments 
      ADD COLUMN source BIGINT,
      ADD COLUMN target BIGINT
    `);

    // Step 14: Make it routable with pgRouting
    console.log('\n🔧 Step 14: Creating pgRouting topology...');
    
    // Debug geometry issues first
    const geometryIssues = await client.query(`
      SELECT 
        id,
        name,
        ST_IsValid(geom) as is_valid,
        ST_GeometryType(geom) as geom_type,
        ST_NDims(geom) as dimensions,
        ST_NumPoints(geom) as num_points,
        ST_AsText(ST_StartPoint(geom)) as start_point,
        ST_AsText(ST_EndPoint(geom)) as end_point
      FROM ${STAGING_SCHEMA}.trails_segments
      WHERE NOT ST_IsValid(geom) OR ST_GeometryType(geom) NOT IN ('LINESTRING', 'MULTILINESTRING')
      ORDER BY id
    `);
    
    if (geometryIssues.rows.length > 0) {
      console.log(`⚠️ Found ${geometryIssues.rows.length} geometry issues:`);
      geometryIssues.rows.forEach(row => {
        console.log(`   ID ${row.id} (${row.name}): valid=${row.is_valid}, type=${row.geom_type}, dims=${row.dimensions}, points=${row.num_points}`);
      });
    } else {
      console.log(`✅ All geometries are valid`);
    }
    
    // Try to create topology
    try {
      const topologyResult = await client.query(`
        SELECT pgr_createTopology('${STAGING_SCHEMA}.trails_segments', 0.0001, 'geom', 'id', 'source', 'target')
      `);
      console.log(`📊 Topology creation result: ${JSON.stringify(topologyResult.rows[0])}`);
    } catch (error) {
      console.log(`❌ Topology creation failed: ${(error as Error).message}`);
      
      // Try with a larger tolerance
      try {
        const topologyResult2 = await client.query(`
          SELECT pgr_createTopology('${STAGING_SCHEMA}.trails_segments', 0.001, 'geom', 'id', 'source', 'target')
        `);
        console.log(`📊 Topology creation with larger tolerance: ${JSON.stringify(topologyResult2.rows[0])}`);
      } catch (error2) {
        console.log(`❌ Topology creation with larger tolerance also failed: ${(error2 as Error).message}`);
      }
    }

    // Step 15: Check results
    console.log('\n📊 Step 15: Checking results...');
    
    const finalSegmentCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_segments`);
    console.log(`📊 Total segments: ${finalSegmentCount.rows[0].count}`);

    // Check if topology was created successfully
    try {
      const vertexCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_segments_vertices_pgr`);
      console.log(`📊 Total vertices: ${vertexCount.rows[0].count}`);

      const isolatedEdges = await client.query(`
        SELECT COUNT(*) as count 
        FROM ${STAGING_SCHEMA}.trails_segments 
        WHERE source IS NULL OR target IS NULL
      `);
      console.log(`📊 Isolated edges: ${isolatedEdges.rows[0].count}`);
    } catch (error) {
      console.log(`⚠️ Topology not available: ${(error as Error).message}`);
      console.log(`📊 Total segments: ${finalSegmentCount.rows[0].count}`);
      console.log(`📊 Isolated edges: ${finalSegmentCount.rows[0].count} (no topology)`);
    }

    // Step 16: Show segment details
    console.log('\n📋 Step 16: Showing segment details...');
    const segmentDetails = await client.query(`
      SELECT 
        id,
        name,
        original_trail_id,
        split_type,
        ROUND(length_m::numeric, 1) as length_m,
        ST_NumPoints(geom) as points,
        source,
        target,
        ST_IsValid(geom) as valid,
        ST_NDims(geom) as dimensions
      FROM ${STAGING_SCHEMA}.trails_segments 
      ORDER BY length_m DESC
      LIMIT 10
    `);

    segmentDetails.rows.forEach(segment => {
      console.log(`   ID ${segment.id} (${segment.name}, orig: ${segment.original_trail_id}, ${segment.split_type}): ${segment.length_m}m (${segment.points} points, ${segment.dimensions}D, valid: ${segment.valid}, source: ${segment.source}, target: ${segment.target})`);
    });

    // Step 17: Test routing connectivity
    console.log('\n🔍 Step 17: Testing routing connectivity...');
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

    // Step 18: Export results for visualization
    console.log('\n📤 Step 18: Exporting results for visualization...');
    const exportResults = await client.query(`
      SELECT 
        id,
        COALESCE(name, 'Segment ' || id) as name,
        original_trail_id,
        split_type,
        COALESCE(trail_type, 'segment') as trail_type,
        COALESCE(surface, 'unknown') as surface,
        COALESCE(difficulty, 'unknown') as difficulty,
        ROUND(length_m::numeric / 1000, 3) as length_km,
        source,
        target,
        orig_id,
        datasource,
        (distance_to_main * 111000)::numeric(10,1) as snap_distance_m,
        ST_AsGeoJSON(geom) as geometry
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
          original_trail_id: row.original_trail_id,
          split_type: row.split_type,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty,
          length_km: row.length_km,
          source: row.source,
          target: row.target,
          orig_id: row.orig_id,
          datasource: row.datasource,
          snap_distance_m: row.snap_distance_m
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

    // Step 19: Summary
    console.log('\n📋 Summary:');
    console.log(`   - Original trails: ${originalTrails.rows.length}`);
    console.log(`   - Final segments: ${finalSegmentCount.rows[0].count}`);
    
    // Check if topology was created successfully for summary
    try {
      const vertexCount = await client.query(`SELECT COUNT(*) as count FROM ${STAGING_SCHEMA}.trails_segments_vertices_pgr`);
      const isolatedEdges = await client.query(`
        SELECT COUNT(*) as count 
        FROM ${STAGING_SCHEMA}.trails_segments 
        WHERE source IS NULL OR target IS NULL
      `);
      console.log(`   - Vertices: ${vertexCount.rows[0].count}`);
      console.log(`   - Isolated edges: ${isolatedEdges.rows[0].count}`);
    } catch (error) {
      console.log(`   - Vertices: N/A (topology failed)`);
      console.log(`   - Isolated edges: N/A (topology failed)`);
    }

    console.log(`🔍 Keeping schema ${STAGING_SCHEMA} for debugging`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
