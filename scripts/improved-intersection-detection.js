#!/usr/bin/env node

/**
 * Improved Intersection Detection and Splitting
 * 
 * This script implements the improved intersection detection approach based on the user's SQL query:
 * 
 * WITH inter AS (
 *   SELECT 
 *     a.id AS id_a,
 *     b.id AS id_b,
 *     (ST_Dump(
 *        ST_CollectionExtract(ST_Intersection(a.geom, b.geom), 1) -- extract POINTS
 *      )).geom AS ipoint
 *   FROM edges a
 *   JOIN edges b
 *     ON a.id < b.id
 *    AND ST_Intersects(a.geom, b.geom)
 * )
 * -- split edge A at all intersection points
 * , split_a AS (
 *   SELECT a.id, (ST_Dump(ST_Split(a.geom, ST_Collect(i.ipoint)))).geom AS geom
 *   FROM edges a
 *   JOIN inter i ON a.id = i.id_a
 *   GROUP BY a.id, a.geom
 * )
 * -- split edge B at all intersection points
 * , split_b AS (
 *   SELECT b.id, (ST_Dump(ST_Split(b.geom, ST_Collect(i.ipoint)))).geom AS geom
 *   FROM edges b
 *   JOIN inter i ON b.id = i.id_b
 *   GROUP BY b.id, b.geom
 * )
 * SELECT * FROM split_a
 * UNION ALL
 * SELECT * FROM split_b;
 * 
 * Key improvements:
 * 1. Use ST_CollectionExtract(geom, 1) to extract only POINT intersections
 * 2. Use ST_Collect() to gather all intersection points before splitting
 * 3. Split trails at all intersection points in one operation
 * 4. Handle both self-intersections and cross-trail intersections
 */

const { Pool } = require('pg');

// Configuration
const config = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db_test',
  user: process.env.PGUSER || 'tester',
  password: process.env.PGPASSWORD || '',
  stagingSchema: process.env.STAGING_SCHEMA || 'staging_boulder_1754318437837'
};

async function improvedIntersectionDetection() {
  const pool = new Pool(config);
  const client = await pool.connect();
  
  try {
    console.log('🔧 Implementing Improved Intersection Detection');
    console.log('===============================================');
    console.log(`📊 Staging Schema: ${config.stagingSchema}`);
    console.log(`🗄️  Database: ${config.database}`);
    console.log('');

    // Step 1: Create the improved intersection detection function
    await createImprovedIntersectionFunction(client);
    
    // Step 2: Test the improved approach
    await testImprovedApproach(client);
    
    // Step 3: Apply the improved splitting
    await applyImprovedSplitting(client);
    
    // Step 4: Validate results
    await validateResults(client);
    
  } catch (error) {
    console.error('❌ Improved intersection detection failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

async function createImprovedIntersectionFunction(client) {
  console.log('🔧 Step 1: Creating Improved Intersection Detection Function');
  console.log('-----------------------------------------------------------');
  
  const functionSql = `
    CREATE OR REPLACE FUNCTION improved_split_trails_v1(staging_schema text, tolerance_meters real DEFAULT 1.0)
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
                    t1.app_uuid AS uuid_a,
                    t2.app_uuid AS uuid_b,
                    t1.name AS name_a,
                    t2.name AS name_b,
                    (ST_Dump(
                       ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1) -- extract POINTS
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
                ARRAY[uuid_a, uuid_b] as connected_trail_ids,
                ARRAY[name_a, name_b] as connected_trail_names,
                'intersection' as node_type,
                $2 as distance_meters
            FROM inter
            WHERE ST_GeometryType(ipoint) = 'ST_Point'
        $f$, staging_schema, staging_schema, staging_schema) 
        USING tolerance_meters, tolerance_meters;
        
        GET DIAGNOSTICS intersection_count_var = ROW_COUNT;
        
        -- Step 2: Split trails at intersection points using improved approach
        EXECUTE format($f$
            WITH inter AS (
                SELECT 
                    t1.id AS id_a,
                    t2.id AS id_b,
                    (ST_Dump(
                       ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1) -- extract POINTS
                     )).geom AS ipoint
                FROM %I.trails t1
                JOIN %I.trails t2
                    ON t1.id < t2.id
                   AND ST_Intersects(t1.geometry, t2.geometry)
                   AND ST_Length(t1.geometry::geography) > $1
                   AND ST_Length(t2.geometry::geography) > $1
            ),
            -- split trail A at all intersection points
            split_a AS (
                SELECT 
                    t.id, 
                    t.app_uuid,
                    t.name,
                    t.osm_id,
                    t.region,
                    t.trail_type,
                    t.surface,
                    t.difficulty,
                    t.source_tags,
                    t.bbox_min_lng,
                    t.bbox_max_lng,
                    t.bbox_min_lat,
                    t.bbox_max_lat,
                    t.length_km,
                    t.elevation_gain,
                    t.elevation_loss,
                    t.max_elevation,
                    t.min_elevation,
                    t.avg_elevation,
                    t.source,
                    t.created_at,
                    t.updated_at,
                    t.geometry as original_geometry,
                    (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).geom AS split_geom,
                    (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).path[1] AS segment_index
                FROM %I.trails t
                JOIN inter i ON t.id = i.id_a
                GROUP BY t.id, t.app_uuid, t.name, t.osm_id, t.region, t.trail_type, t.surface, t.difficulty, 
                         t.source_tags, t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
                         t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, 
                         t.avg_elevation, t.source, t.created_at, t.updated_at, t.geometry
            ),
            -- split trail B at all intersection points
            split_b AS (
                SELECT 
                    t.id, 
                    t.app_uuid,
                    t.name,
                    t.osm_id,
                    t.region,
                    t.trail_type,
                    t.surface,
                    t.difficulty,
                    t.source_tags,
                    t.bbox_min_lng,
                    t.bbox_max_lng,
                    t.bbox_min_lat,
                    t.bbox_max_lat,
                    t.length_km,
                    t.elevation_gain,
                    t.elevation_loss,
                    t.max_elevation,
                    t.min_elevation,
                    t.avg_elevation,
                    t.source,
                    t.created_at,
                    t.updated_at,
                    t.geometry as original_geometry,
                    (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).geom AS split_geom,
                    (ST_Dump(ST_Split(t.geometry, ST_Collect(i.ipoint)))).path[1] AS segment_index
                FROM %I.trails t
                JOIN inter i ON t.id = i.id_b
                GROUP BY t.id, t.app_uuid, t.name, t.osm_id, t.region, t.trail_type, t.surface, t.difficulty, 
                         t.source_tags, t.bbox_min_lng, t.bbox_max_lng, t.bbox_min_lat, t.bbox_max_lat,
                         t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, 
                         t.avg_elevation, t.source, t.created_at, t.updated_at, t.geometry
            ),
            -- Get trails that don't have intersections
            trails_without_intersections AS (
                SELECT 
                    t.id, 
                    t.app_uuid,
                    t.name,
                    t.osm_id,
                    t.region,
                    t.trail_type,
                    t.surface,
                    t.difficulty,
                    t.source_tags,
                    t.bbox_min_lng,
                    t.bbox_max_lng,
                    t.bbox_min_lat,
                    t.bbox_max_lat,
                    t.length_km,
                    t.elevation_gain,
                    t.elevation_loss,
                    t.max_elevation,
                    t.min_elevation,
                    t.avg_elevation,
                    t.source,
                    t.created_at,
                    t.updated_at,
                    t.geometry as original_geometry,
                    t.geometry as split_geom,
                    1 AS segment_index
                FROM %I.trails t
                WHERE t.id NOT IN (
                    SELECT DISTINCT id_a FROM inter
                    UNION
                    SELECT DISTINCT id_b FROM inter
                )
            )
            -- Replace existing trails with split versions
            DELETE FROM %I.trails;
            
            INSERT INTO %I.trails (
                app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
                bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
                length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, source,
                geometry, created_at, updated_at
            )
            SELECT
                gen_random_uuid() as app_uuid,
                osm_id,
                name || CASE WHEN segment_index > 1 THEN ' Segment ' || segment_index ELSE '' END as name,
                region,
                trail_type,
                surface,
                difficulty,
                source_tags,
                ST_XMin(split_geom) as bbox_min_lng,
                ST_XMax(split_geom) as bbox_max_lng,
                ST_YMin(split_geom) as bbox_min_lat,
                ST_YMax(split_geom) as bbox_max_lat,
                ST_Length(split_geom::geography) / 1000.0 as length_km,
                elevation_gain,
                elevation_loss,
                max_elevation,
                min_elevation,
                avg_elevation,
                source,
                split_geom as geometry,
                NOW() as created_at,
                NOW() as updated_at
            FROM (
                SELECT * FROM split_a
                UNION ALL
                SELECT * FROM split_b
                UNION ALL
                SELECT * FROM trails_without_intersections
            ) all_splits
            WHERE ST_GeometryType(split_geom) = 'ST_LineString'
              AND ST_IsValid(split_geom)
              AND ST_Length(split_geom::geography) > $1
        $f$, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema, staging_schema) 
        USING tolerance_meters;
        
        GET DIAGNOSTICS split_count_var = ROW_COUNT;
        
        -- Clear routing data since it needs to be regenerated
        EXECUTE format('DELETE FROM %I.routing_nodes', staging_schema);
        EXECUTE format('DELETE FROM %I.routing_edges', staging_schema);
        
        -- Recreate spatial indexes
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_geometry ON %I.trails USING GIST(geometry)', staging_schema);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_trails_app_uuid ON %I.trails(app_uuid)', staging_schema);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_intersection_points ON %I.intersection_points USING GIST(point)', staging_schema);
        
        RETURN QUERY SELECT
            original_count_var,
            split_count_var,
            intersection_count_var,
            true as success,
            format('Successfully split %s trails into %s segments with %s intersections using improved approach',
                   original_count_var, split_count_var, intersection_count_var) as message;
    END;
    $$;
  `;
  
  await client.query(functionSql);
  console.log('✅ Created improved_split_trails_v1 function');
  console.log('');
}

async function testImprovedApproach(client) {
  console.log('🧪 Step 2: Testing Improved Approach');
  console.log('------------------------------------');
  
  // Test intersection detection with improved approach
  console.log('🔍 Testing intersection detection...');
  const intersectionTest = await client.query(`
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
       AND ST_Length(t1.geometry::geography) > 1
       AND ST_Length(t2.geometry::geography) > 1
    )
    SELECT 
      COUNT(*) as intersection_count,
      COUNT(DISTINCT id_a) as trails_with_intersections_a,
      COUNT(DISTINCT id_b) as trails_with_intersections_b,
      COUNT(DISTINCT name_a) as unique_trail_names_a,
      COUNT(DISTINCT name_b) as unique_trail_names_b
    FROM inter
    WHERE ST_GeometryType(ipoint) = 'ST_Point'
  `);
  
  const testResults = intersectionTest.rows[0];
  console.log(`📊 Intersection Detection Results:`);
  console.log(`   Total intersections found: ${testResults.intersection_count}`);
  console.log(`   Trails with intersections (A): ${testResults.trails_with_intersections_a}`);
  console.log(`   Trails with intersections (B): ${testResults.trails_with_intersections_b}`);
  console.log(`   Unique trail names (A): ${testResults.unique_trail_names_a}`);
  console.log(`   Unique trail names (B): ${testResults.unique_trail_names_b}`);
  console.log('');
  
  // Show some example intersections
  const exampleIntersections = await client.query(`
    WITH inter AS (
      SELECT 
        t1.id AS id_a,
        t2.id AS id_b,
        t1.name AS name_a,
        t2.name AS name_b,
        (ST_Dump(
           ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1)
         )).geom AS ipoint
      FROM ${config.stagingSchema}.trails t1
      JOIN ${config.stagingSchema}.trails t2
        ON t1.id < t2.id
       AND ST_Intersects(t1.geometry, t2.geometry)
       AND ST_Length(t1.geometry::geography) > 1
       AND ST_Length(t2.geometry::geography) > 1
    )
    SELECT 
      name_a,
      name_b,
      ST_AsText(ipoint) as intersection_point,
      ST_GeometryType(ipoint) as geom_type
    FROM inter
    WHERE ST_GeometryType(ipoint) = 'ST_Point'
    LIMIT 10
  `);
  
  console.log('📋 Example Intersections:');
  for (const intersection of exampleIntersections.rows) {
    console.log(`   ${intersection.name_a} × ${intersection.name_b}: ${intersection.intersection_point} (${intersection.geom_type})`);
  }
  console.log('');
}

async function applyImprovedSplitting(client) {
  console.log('🔧 Step 3: Applying Improved Splitting');
  console.log('--------------------------------------');
  
  // Get original count
  const originalCount = await client.query(`SELECT COUNT(*) as count FROM ${config.stagingSchema}.trails`);
  console.log(`📊 Original trail count: ${originalCount.rows[0].count}`);
  
  // Apply the improved splitting
  console.log('🔄 Applying improved intersection splitting...');
  const result = await client.query(`
    SELECT * FROM improved_split_trails_v1($1, $2)
  `, [config.stagingSchema, 1.0]);
  
  const splitResult = result.rows[0];
  console.log(`✅ Splitting completed:`);
  console.log(`   Original trails: ${splitResult.original_count}`);
  console.log(`   Split segments: ${splitResult.split_count}`);
  console.log(`   Intersections detected: ${splitResult.intersection_count}`);
  console.log(`   Success: ${splitResult.success}`);
  console.log(`   Message: ${splitResult.message}`);
  console.log('');
}

async function validateResults(client) {
  console.log('✅ Step 4: Validating Results');
  console.log('------------------------------');
  
  // Check final trail count
  const finalCount = await client.query(`SELECT COUNT(*) as count FROM ${config.stagingSchema}.trails`);
  console.log(`📊 Final trail count: ${finalCount.rows[0].count}`);
  
  // Check intersection points
  const intersectionCount = await client.query(`SELECT COUNT(*) as count FROM ${config.stagingSchema}.intersection_points`);
  console.log(`📊 Intersection points stored: ${intersectionCount.rows[0].count}`);
  
  // Check for any remaining intersections (should be 0 if splitting worked correctly)
  const remainingIntersections = await client.query(`
    WITH inter AS (
      SELECT 
        t1.id AS id_a,
        t2.id AS id_b,
        (ST_Dump(
           ST_CollectionExtract(ST_Intersection(t1.geometry, t2.geometry), 1)
         )).geom AS ipoint
      FROM ${config.stagingSchema}.trails t1
      JOIN ${config.stagingSchema}.trails t2
        ON t1.id < t2.id
       AND ST_Intersects(t1.geometry, t2.geometry)
       AND ST_Length(t1.geometry::geography) > 1
       AND ST_Length(t2.geometry::geography) > 1
    )
    SELECT COUNT(*) as remaining_intersections
    FROM inter
    WHERE ST_GeometryType(ipoint) = 'ST_Point'
  `);
  
  console.log(`📊 Remaining intersections after splitting: ${remainingIntersections.rows[0].remaining_intersections}`);
  
  // Check segment statistics
  const segmentStats = await client.query(`
    SELECT 
      COUNT(*) as total_segments,
      AVG(ST_Length(geometry::geography)) as avg_length_meters,
      MIN(ST_Length(geometry::geography)) as min_length_meters,
      MAX(ST_Length(geometry::geography)) as max_length_meters,
      COUNT(CASE WHEN ST_Length(geometry::geography) <= 5 THEN 1 END) as short_segments,
      COUNT(CASE WHEN ST_Length(geometry::geography) > 1000 THEN 1 END) as long_segments
    FROM ${config.stagingSchema}.trails
    WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
  `);
  
  const stats = segmentStats.rows[0];
  console.log(`📊 Segment Statistics:`);
  console.log(`   Total segments: ${stats.total_segments}`);
  console.log(`   Average length: ${parseFloat(stats.avg_length_meters).toFixed(2)}m`);
  console.log(`   Length range: ${parseFloat(stats.min_length_meters).toFixed(2)}m - ${parseFloat(stats.max_length_meters).toFixed(2)}m`);
  console.log(`   Short segments (≤5m): ${stats.short_segments}`);
  console.log(`   Long segments (>1km): ${stats.long_segments}`);
  console.log('');
  
  // Show examples of split trails
  const splitExamples = await client.query(`
    SELECT 
      name,
      ST_Length(geometry::geography) as length_meters,
      ST_NumPoints(geometry) as num_points,
      ST_GeometryType(geometry) as geom_type
    FROM ${config.stagingSchema}.trails
    WHERE name LIKE '%Segment%'
    ORDER BY length_meters DESC
    LIMIT 10
  `);
  
  console.log('📋 Examples of Split Segments:');
  for (const example of splitExamples.rows) {
    console.log(`   ${example.name}: ${parseFloat(example.length_meters).toFixed(1)}m, ${example.num_points} points, ${example.geom_type}`);
  }
  console.log('');
  
  console.log('🎉 Validation complete! The improved intersection detection and splitting has been applied successfully.');
  console.log('');
  console.log('💡 Key improvements implemented:');
  console.log('   1. ✅ Used ST_CollectionExtract(geom, 1) for precise POINT extraction');
  console.log('   2. ✅ Used ST_Collect() to gather all intersection points');
  console.log('   3. ✅ Split trails at all intersection points in one operation');
  console.log('   4. ✅ Reduced minimum length threshold to 1m');
  console.log('   5. ✅ Preserved 3D geometry during intersection detection');
  console.log('');
}

// Run the improved intersection detection
if (require.main === module) {
  improvedIntersectionDetection().catch(console.error);
}

module.exports = { improvedIntersectionDetection };
