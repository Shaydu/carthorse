#!/usr/bin/env node

/**
 * Analyze Intersection Detection Issues
 * 
 * This script analyzes why true intersections (like the one shown in the image)
 * aren't being detected and split properly by the current intersection detection logic.
 * 
 * The image shows:
 * - A thick dark blue line (trail 1) that loops and intersects with itself
 * - A thinner light blue line (trail 2) that runs parallel and intersects
 * - A thick magenta line (trail 3) that crosses horizontally
 * - Two red dots marking intersection points
 * 
 * Based on the user's SQL query, we'll implement an improved approach using:
 * - ST_CollectionExtract to get only POINT intersections
 * - ST_Collect to gather all intersection points
 * - ST_Split to split trails at all intersection points
 */

const { Pool } = require('pg');
const fs = require('fs');

// Configuration
const config = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db_test',
  user: process.env.PGUSER || 'tester',
  password: process.env.PGPASSWORD || '',
  stagingSchema: process.env.STAGING_SCHEMA || 'staging_boulder_1754318437837'
};

async function analyzeIntersectionDetection() {
  const pool = new Pool(config);
  const client = await pool.connect();
  
  try {
    console.log('🔍 Analyzing Intersection Detection Issues');
    console.log('==========================================');
    console.log(`📊 Staging Schema: ${config.stagingSchema}`);
    console.log(`🗄️  Database: ${config.database}`);
    console.log('');

    // Step 1: Check current trail data
    await analyzeCurrentTrailData(client);
    
    // Step 2: Test current vs improved intersection detection
    await compareIntersectionApproaches(client);
    
    // Step 3: Implement and test the improved approach
    await testImprovedIntersectionDetection(client);
    
    // Step 4: Generate recommendations
    await generateRecommendations(client);
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

async function analyzeCurrentTrailData(client) {
  console.log('📊 Step 1: Analyzing Current Trail Data');
  console.log('----------------------------------------');
  
  // Get trail count and basic stats
  const trailStats = await client.query(`
    SELECT 
      COUNT(*) as total_trails,
      COUNT(CASE WHEN ST_IsValid(geometry) THEN 1 END) as valid_trails,
      COUNT(CASE WHEN NOT ST_IsValid(geometry) THEN 1 END) as invalid_trails,
      COUNT(CASE WHEN ST_Length(geometry::geography) <= 5 THEN 1 END) as short_trails,
      COUNT(CASE WHEN ST_Length(geometry::geography) > 5 THEN 1 END) as long_trails,
      AVG(ST_Length(geometry::geography)) as avg_length_meters,
      MIN(ST_Length(geometry::geography)) as min_length_meters,
      MAX(ST_Length(geometry::geography)) as max_length_meters
    FROM ${config.stagingSchema}.trails
    WHERE geometry IS NOT NULL
  `);
  
  const stats = trailStats.rows[0];
  console.log(`📈 Total trails: ${stats.total_trails}`);
  console.log(`✅ Valid trails: ${stats.valid_trails}`);
  console.log(`❌ Invalid trails: ${stats.invalid_trails}`);
  console.log(`📏 Short trails (≤5m): ${stats.short_trails}`);
  console.log(`📏 Long trails (>5m): ${stats.long_trails}`);
  console.log(`📊 Average length: ${parseFloat(stats.avg_length_meters).toFixed(2)}m`);
  console.log(`📊 Length range: ${parseFloat(stats.min_length_meters).toFixed(2)}m - ${parseFloat(stats.max_length_meters).toFixed(2)}m`);
  console.log('');
  
  // Check for self-intersecting trails
  const selfIntersecting = await client.query(`
    SELECT COUNT(*) as count
    FROM ${config.stagingSchema}.trails
    WHERE geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND NOT ST_IsSimple(geometry)
  `);
  
  console.log(`🔄 Self-intersecting trails: ${selfIntersecting.rows[0].count}`);
  console.log('');
}

async function compareIntersectionApproaches(client) {
  console.log('🔍 Step 2: Comparing Current vs Improved Approaches');
  console.log('---------------------------------------------------');
  
  // Test 1: Current approach (ST_Intersection with ST_Force2D)
  console.log('🧪 Test 1: Current ST_Intersection Approach');
  const currentApproach = await client.query(`
    SELECT COUNT(*) as intersection_count
    FROM (
      SELECT DISTINCT
        (ST_Dump(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry)))).geom as intersection_point
      FROM ${config.stagingSchema}.trails t1
      JOIN ${config.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(ST_Force2D(t1.geometry), ST_Force2D(t2.geometry))) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > 5
        AND ST_Length(t2.geometry::geography) > 5
    ) intersections
    WHERE ST_Length(intersection_point::geography) = 0
  `);
  
  console.log(`   Current approach intersections: ${currentApproach.rows[0].intersection_count}`);
  
  // Test 2: Improved approach (based on user's SQL query)
  console.log('🧪 Test 2: Improved ST_CollectionExtract Approach');
  const improvedApproach = await client.query(`
    SELECT COUNT(*) as intersection_count
    FROM (
      SELECT 
        t1.id AS id_a,
        t2.id AS id_b,
        (ST_Dump(
           ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1) -- extract POINTS
         )).geom AS ipoint
      FROM ${config.stagingSchema}.trails t1
      JOIN ${config.stagingSchema}.trails t2
        ON t1.id < t2.id
       AND ST_Intersects(t1.geometry, t2.geometry)
       AND ST_Length(t1.geometry::geography) > 5
       AND ST_Length(t2.geometry::geography) > 5
    ) inter
    WHERE ST_GeometryType(ipoint) = 'ST_Point'
  `);
  
  console.log(`   Improved approach intersections: ${improvedApproach.rows[0].intersection_count}`);
  
  // Test 3: Without length filtering
  console.log('🧪 Test 3: Improved Approach Without Length Filtering');
  const improvedNoFilter = await client.query(`
    SELECT COUNT(*) as intersection_count
    FROM (
      SELECT 
        t1.id AS id_a,
        t2.id AS id_b,
        (ST_Dump(
           ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1) -- extract POINTS
         )).geom AS ipoint
      FROM ${config.stagingSchema}.trails t1
      JOIN ${config.stagingSchema}.trails t2
        ON t1.id < t2.id
       AND ST_Intersects(t1.geometry, t2.geometry)
    ) inter
    WHERE ST_GeometryType(ipoint) = 'ST_Point'
  `);
  
  console.log(`   Improved approach (no length filter): ${improvedNoFilter.rows[0].intersection_count}`);
  console.log('');
}

async function testImprovedIntersectionDetection(client) {
  console.log('🔍 Step 3: Testing Improved Intersection Detection');
  console.log('--------------------------------------------------');
  
  // Create a temporary table to test the improved splitting approach
  console.log('🧪 Creating test table with improved intersection detection...');
  
  await client.query(`
    CREATE TEMP TABLE test_improved_splits AS
    WITH inter AS (
      SELECT 
        t1.id AS id_a,
        t2.id AS id_b,
        t1.name AS name_a,
        t2.name AS name_b,
        (ST_Dump(
           ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1) -- extract POINTS
         )).geom AS ipoint
      FROM ${config.stagingSchema}.trails t1
      JOIN ${config.stagingSchema}.trails t2
        ON t1.id < t2.id
       AND ST_Intersects(t1.geometry, t2.geometry)
       AND ST_Length(t1.geometry::geography) > 1  -- Reduced threshold
       AND ST_Length(t2.geometry::geography) > 1  -- Reduced threshold
    ),
    -- split trail A at all intersection points
    split_a AS (
      SELECT 
        t.id, 
        t.name,
        t.geometry as original_geom,
        (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).geom AS split_geom,
        (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).path[1] AS segment_index
      FROM ${config.stagingSchema}.trails t
      JOIN inter i ON t.id = i.id_a
      GROUP BY t.id, t.name, t.geometry
    ),
    -- split trail B at all intersection points
    split_b AS (
      SELECT 
        t.id, 
        t.name,
        t.geometry as original_geom,
        (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).geom AS split_geom,
        (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).path[1] AS segment_index
      FROM ${config.stagingSchema}.trails t
      JOIN inter i ON t.id = i.id_b
      GROUP BY t.id, t.name, t.geometry
    )
    SELECT 
      id,
      name,
      original_geom,
      split_geom,
      segment_index,
      ST_GeometryType(split_geom) as geom_type,
      ST_Length(split_geom::geography) as length_meters
    FROM split_a
    WHERE ST_GeometryType(split_geom) = 'ST_LineString'
      AND ST_Length(split_geom::geography) > 1
    
    UNION ALL
    
    SELECT 
      id,
      name,
      original_geom,
      split_geom,
      segment_index,
      ST_GeometryType(split_geom) as geom_type,
      ST_Length(split_geom::geography) as length_meters
    FROM split_b
    WHERE ST_GeometryType(split_geom) = 'ST_LineString'
      AND ST_Length(split_geom::geography) > 1
  `);
  
  // Get statistics on the improved splitting
  const splitStats = await client.query(`
    SELECT 
      COUNT(*) as total_segments,
      COUNT(DISTINCT id) as trails_split,
      AVG(length_meters) as avg_segment_length,
      MIN(length_meters) as min_segment_length,
      MAX(length_meters) as max_segment_length,
      COUNT(CASE WHEN length_meters <= 5 THEN 1 END) as short_segments,
      COUNT(CASE WHEN length_meters > 100 THEN 1 END) as long_segments
    FROM test_improved_splits
  `);
  
  const stats = splitStats.rows[0];
  console.log(`📊 Improved Splitting Results:`);
  console.log(`   Total segments created: ${stats.total_segments}`);
  console.log(`   Trails split: ${stats.trails_split}`);
  console.log(`   Average segment length: ${parseFloat(stats.avg_segment_length).toFixed(2)}m`);
  console.log(`   Segment length range: ${parseFloat(stats.min_segment_length).toFixed(2)}m - ${parseFloat(stats.max_segment_length).toFixed(2)}m`);
  console.log(`   Short segments (≤5m): ${stats.short_segments}`);
  console.log(`   Long segments (>100m): ${stats.long_segments}`);
  console.log('');
  
  // Show examples of split trails
  const splitExamples = await client.query(`
    SELECT 
      name,
      COUNT(*) as segment_count,
      AVG(length_meters) as avg_length,
      MIN(length_meters) as min_length,
      MAX(length_meters) as max_length
    FROM test_improved_splits
    GROUP BY id, name
    ORDER BY segment_count DESC, avg_length DESC
    LIMIT 10
  `);
  
  console.log('📋 Examples of Split Trails:');
  for (const example of splitExamples.rows) {
    console.log(`   ${example.name}: ${example.segment_count} segments, avg: ${parseFloat(example.avg_length).toFixed(1)}m (${parseFloat(example.min_length).toFixed(1)}m-${parseFloat(example.max_length).toFixed(1)}m)`);
  }
  console.log('');
  
  // Test intersection detection after splitting
  console.log('🧪 Testing intersection detection after splitting...');
  const intersectionsAfterSplit = await client.query(`
    SELECT COUNT(*) as intersection_count
    FROM (
      SELECT 
        t1.id AS id_a,
        t2.id AS id_b,
        (ST_Dump(
           ST_CollectionExtract(ST_Intersection(t1.split_geom, t2.split_geom), 1)
         )).geom AS ipoint
      FROM test_improved_splits t1
      JOIN test_improved_splits t2
        ON t1.id < t2.id
       AND ST_Intersects(t1.split_geom, t2.split_geom)
    ) inter
    WHERE ST_GeometryType(ipoint) = 'ST_Point'
  `);
  
  console.log(`   Intersections after splitting: ${intersectionsAfterSplit.rows[0].intersection_count}`);
  console.log('');
}

async function generateRecommendations(client) {
  console.log('💡 Step 4: Recommendations');
  console.log('---------------------------');
  
  console.log('🔧 Based on the analysis, here are the key improvements needed:');
  console.log('');
  
  console.log('✅ IMPROVEMENT 1: Use ST_CollectionExtract');
  console.log('   The user\'s SQL query shows a better approach using ST_CollectionExtract(geom, 1)');
  console.log('   to extract only POINT intersections, which is more precise than the current approach.');
  console.log('');
  
  console.log('✅ IMPROVEMENT 2: Use ST_Collect for Multiple Intersections');
  console.log('   ST_Collect() gathers all intersection points before splitting,');
  console.log('   ensuring trails are split at all intersection points in one operation.');
  console.log('');
  
  console.log('✅ IMPROVEMENT 3: Reduce Length Thresholds');
  console.log('   The current 5m minimum length may exclude important connector trails.');
  console.log('   Reducing to 1m captures more valid intersections.');
  console.log('');
  
  console.log('✅ IMPROVEMENT 4: Preserve 3D Geometry');
  console.log('   Remove ST_Force2D() to preserve elevation data during intersection detection.');
  console.log('');
  
  console.log('🔧 IMPLEMENTATION PLAN:');
  console.log('   1. Replace current intersection detection with the improved approach');
  console.log('   2. Update the split_trails_v1 function to use ST_CollectionExtract');
  console.log('   3. Reduce minimum length thresholds');
  console.log('   4. Add comprehensive testing for complex intersection patterns');
  console.log('   5. Validate results with real Boulder trail data');
  console.log('');
  
  console.log('📝 PROPOSED SQL FUNCTION:');
  console.log(`
CREATE OR REPLACE FUNCTION improved_split_trails(staging_schema text, tolerance_meters real DEFAULT 1.0)
RETURNS TABLE(original_count integer, split_count integer, intersection_count integer, success boolean, message text)
LANGUAGE plpgsql AS $$
DECLARE
    original_count_var integer := 0;
    split_count_var integer := 0;
    intersection_count_var integer := 0;
BEGIN
    -- Get original count
    EXECUTE format('SELECT COUNT(*) FROM %I.trails', staging_schema) INTO original_count_var;
    
    -- Clear intersection points
    EXECUTE format('DELETE FROM %I.intersection_points', staging_schema);
    
    -- Step 1: Find all intersections using improved approach
    EXECUTE format($f$
        WITH inter AS (
            SELECT 
                t1.id AS id_a,
                t2.id AS id_b,
                (ST_Dump(
                   ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1)
                 )).geom AS ipoint
            FROM %I.trails t1
            JOIN %I.trails t2
                ON t1.id < t2.id
               AND ST_Intersects(t1.geometry, t2.geometry)
               AND ST_Length(t1.geometry::geography) > $1
               AND ST_Length(t2.geometry::geography) > $1
        )
        INSERT INTO %I.intersection_points (point, point_3d, connected_trail_ids, connected_trail_names, node_type, distance_meters)
        SELECT DISTINCT
            ST_Force2D(ipoint) as point,
            ST_Force3D(ipoint) as point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'intersection' as node_type,
            $2 as distance_meters
        FROM inter
        JOIN %I.trails t1 ON t1.id = inter.id_a
        JOIN %I.trails t2 ON t2.id = inter.id_b
        WHERE ST_GeometryType(ipoint) = 'ST_Point'
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) 
    USING tolerance_meters, tolerance_meters;
    
    GET DIAGNOSTICS intersection_count_var = ROW_COUNT;
    
    -- Step 2: Split trails at intersection points
    EXECUTE format($f$
        WITH inter AS (
            SELECT 
                t1.id AS id_a,
                t2.id AS id_b,
                (ST_Dump(
                   ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1)
                 )).geom AS ipoint
            FROM %I.trails t1
            JOIN %I.trails t2
                ON t1.id < t2.id
               AND ST_Intersects(t1.geometry, t2.geometry)
               AND ST_Length(t1.geometry::geography) > $1
               AND ST_Length(t2.geometry::geography) > $1
        ),
        split_a AS (
            SELECT 
                t.id, t.app_uuid, t.name, t.geometry,
                (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).geom AS split_geom,
                (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).path[1] AS segment_index
            FROM %I.trails t
            JOIN inter i ON t.id = i.id_a
            GROUP BY t.id, t.app_uuid, t.name, t.geometry
        ),
        split_b AS (
            SELECT 
                t.id, t.app_uuid, t.name, t.geometry,
                (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).geom AS split_geom,
                (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).path[1] AS segment_index
            FROM %I.trails t
            JOIN inter i ON t.id = i.id_b
            GROUP BY t.id, t.app_uuid, t.name, t.geometry
        )
        -- Replace existing trails with split versions
        DELETE FROM %I.trails;
        
        INSERT INTO %I.trails (
            app_uuid, name, geometry, length_km, elevation_gain, elevation_loss,
            trail_type, surface, difficulty, source
        )
        SELECT 
            gen_random_uuid()::uuid as app_uuid,
            name || ' Segment' as name,
            split_geom as geometry,
            ST_Length(split_geom::geography) / 1000.0 as length_km,
            elevation_gain,
            elevation_loss,
            trail_type,
            surface,
            difficulty,
            source
        FROM (
            SELECT * FROM split_a
            UNION ALL
            SELECT * FROM split_b
        ) all_splits
        WHERE ST_GeometryType(split_geom) = 'ST_LineString'
          AND ST_Length(split_geom::geography) > $1
    $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) 
    USING tolerance_meters;
    
    GET DIAGNOSTICS split_count_var = ROW_COUNT;
    
    RETURN QUERY SELECT
        original_count_var,
        split_count_var,
        intersection_count_var,
        true as success,
        format('Successfully split %s trails into %s segments with %s intersections',
               original_count_var, split_count_var, intersection_count_var) as message;
END;
$$;
  `);
  console.log('');
}

// Run the analysis
if (require.main === module) {
  analyzeIntersectionDetection().catch(console.error);
}

module.exports = { analyzeIntersectionDetection };
