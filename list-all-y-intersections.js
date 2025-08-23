const { Pool } = require('pg');
require('dotenv').config();

async function listAllYIntersections() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'tester',
    database: 'trail_master_db',
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
  });

  try {
    console.log('🔍 Analyzing all Y-intersections...\n');

    // Configuration
    const config = {
      toleranceMeters: 10,
      minTrailLengthMeters: 5,
      minSnapDistanceMeters: 1.0,
      tempSchema: 'y_intersection_analysis',
      testBbox: {
        minLng: -105.30123174925316, maxLng: -105.26050515816028,
        minLat: 39.96928418458248, maxLat: 40.06483855535663
      }
    };

    // Step 1: Create temporary schema
    console.log('🔄 Step 1: Creating temporary schema...');
    await pool.query(`DROP SCHEMA IF EXISTS ${config.tempSchema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${config.tempSchema}`);
    
    await pool.query(`
      CREATE TABLE ${config.tempSchema}.trails (
        app_uuid TEXT PRIMARY KEY,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        geometry geometry(LineString,4326)
      )
    `);

    // Step 2: Copy test data
    console.log('🔄 Step 2: Copying test data...');
    
    const carthorsePool = new Pool({
      host: process.env.PGHOST || 'localhost',
      user: 'carthorse',
      database: 'trail_master_db',
      password: process.env.PGPASSWORD,
      port: process.env.PGPORT || 5432,
    });

    const copyResult = await carthorsePool.query(`
      SELECT 
        app_uuid,
        name,
        region,
        trail_type,
        ST_Force2D(geometry) as geometry
      FROM public.trails 
      WHERE region = 'boulder'
        AND ST_Intersects(
          geometry,
          ST_MakeEnvelope($1, $2, $3, $4, 4326)
        )
    `, [config.testBbox.minLng, config.testBbox.minLat, config.testBbox.maxLng, config.testBbox.maxLat]);

    for (const trail of copyResult.rows) {
      await pool.query(`
        INSERT INTO ${config.tempSchema}.trails (app_uuid, name, region, trail_type, geometry)
        VALUES ($1, $2, $3, $4, $5)
      `, [trail.app_uuid, trail.name, trail.region, trail.trail_type, trail.geometry]);
    }

    await carthorsePool.end();
    console.log(`   ✅ Copied ${copyResult.rows.length} trails\n`);

    // Step 3: Find all Y-intersections with detailed info
    console.log('🔄 Step 3: Finding all Y-intersections...');
    const allIntersections = await findAllYIntersectionsDetailed(pool, config);
    console.log(`   ✅ Found ${allIntersections.length} Y-intersections\n`);

    // Step 4: Display detailed analysis
    console.log('📊 COMPLETE Y-INTERSECTION ANALYSIS:');
    console.log('=' .repeat(80));
    
    allIntersections.forEach((intersection, index) => {
      console.log(`\n${index + 1}. Y-INTERSECTION DETAILS:`);
      console.log(`   Visiting Trail: "${intersection.visiting_trail_name}" (${intersection.visiting_trail_id})`);
      console.log(`   Visited Trail:  "${intersection.visited_trail_name}" (${intersection.visited_trail_id})`);
      console.log(`   Distance:       ${intersection.distance_meters.toFixed(2)}m`);
      console.log(`   Split Ratio:    ${intersection.split_ratio.toFixed(3)} (${getSplitRatioDescription(intersection.split_ratio)})`);
      console.log(`   Split Point:    [${intersection.split_point.coordinates[0].toFixed(6)}, ${intersection.split_point.coordinates[1].toFixed(6)}]`);
      console.log(`   Endpoint:       [${intersection.visiting_endpoint.coordinates[0].toFixed(6)}, ${intersection.visiting_endpoint.coordinates[1].toFixed(6)}]`);
      
      // Categorize the intersection
      const category = categorizeIntersection(intersection);
      console.log(`   Category:       ${category}`);
      
      if (category === 'SELF-INTERSECTION') {
        console.log(`   ⚠️  WARNING: This is a self-intersection and should be filtered out!`);
      }
    });

    // Step 5: Summary statistics
    console.log('\n' + '=' .repeat(80));
    console.log('📈 SUMMARY STATISTICS:');
    
    const categories = allIntersections.map(i => categorizeIntersection(i));
    const selfIntersections = categories.filter(c => c === 'SELF-INTERSECTION').length;
    const validIntersections = categories.filter(c => c !== 'SELF-INTERSECTION').length;
    
    console.log(`   Total intersections found: ${allIntersections.length}`);
    console.log(`   Self-intersections: ${selfIntersections} (${(selfIntersections/allIntersections.length*100).toFixed(1)}%)`);
    console.log(`   Valid Y-intersections: ${validIntersections} (${(validIntersections/allIntersections.length*100).toFixed(1)}%)`);
    
    const distances = allIntersections.map(i => i.distance_meters);
    console.log(`   Distance range: ${Math.min(...distances).toFixed(2)}m - ${Math.max(...distances).toFixed(2)}m`);
    console.log(`   Average distance: ${(distances.reduce((a,b) => a+b, 0) / distances.length).toFixed(2)}m`);
    
    const splitRatios = allIntersections.map(i => i.split_ratio);
    const nearStart = splitRatios.filter(r => r < 0.1).length;
    const nearEnd = splitRatios.filter(r => r > 0.9).length;
    const middle = splitRatios.filter(r => r >= 0.1 && r <= 0.9).length;
    
    console.log(`   Split ratios:`);
    console.log(`     Near start (<0.1): ${nearStart} (${(nearStart/allIntersections.length*100).toFixed(1)}%)`);
    console.log(`     Middle (0.1-0.9): ${middle} (${(middle/allIntersections.length*100).toFixed(1)}%)`);
    console.log(`     Near end (>0.9): ${nearEnd} (${(nearEnd/allIntersections.length*100).toFixed(1)}%)`);

    // Step 6: List only valid Y-intersections
    console.log('\n' + '=' .repeat(80));
    console.log('✅ VALID Y-INTERSECTIONS (excluding self-intersections):');
    
    const validIntersectionList = allIntersections.filter(i => categorizeIntersection(i) !== 'SELF-INTERSECTION');
    
    if (validIntersectionList.length === 0) {
      console.log('   No valid Y-intersections found!');
    } else {
      validIntersectionList.forEach((intersection, index) => {
        console.log(`\n   ${index + 1}. ${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`);
        console.log(`      Distance: ${intersection.distance_meters.toFixed(2)}m, Split ratio: ${intersection.split_ratio.toFixed(3)}`);
        console.log(`      Location: [${intersection.split_point.coordinates[0].toFixed(6)}, ${intersection.split_point.coordinates[1].toFixed(6)}]`);
      });
    }

    // Step 7: Cleanup
    console.log('\n🧹 Cleaning up...');
    await pool.query(`DROP SCHEMA IF EXISTS ${config.tempSchema} CASCADE`);
    console.log('   ✅ Cleanup complete\n');

    console.log('✅ Y-intersection analysis completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

function getSplitRatioDescription(ratio) {
  if (ratio < 0.1) return 'Near start';
  if (ratio > 0.9) return 'Near end';
  return 'Middle';
}

function categorizeIntersection(intersection) {
  if (intersection.visiting_trail_id === intersection.visited_trail_id) {
    return 'SELF-INTERSECTION';
  }
  return 'VALID Y-INTERSECTION';
}

async function findAllYIntersectionsDetailed(pool, config) {
  const query = `
    WITH trail_endpoints AS (
      SELECT
        app_uuid as trail_id,
        name as trail_name,
        ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
        ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
        geometry as trail_geom
      FROM ${config.tempSchema}.trails
      WHERE ST_Length(geometry::geography) >= $1
        AND ST_IsValid(geometry)
    ),
    y_intersections AS (
      -- Find start points near other trails (Y-intersections)
      SELECT
        e1.trail_id as visiting_trail_id,
        e1.trail_name as visiting_trail_name,
        e1.start_point as visiting_endpoint,
        e2.trail_id as visited_trail_id,
        e2.trail_name as visited_trail_name,
        e2.trail_geom as visited_trail_geom,
        ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) as distance_meters,
        ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)))::json as split_point,
        ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)) as split_ratio
      FROM trail_endpoints e1
      CROSS JOIN trail_endpoints e2
      WHERE e1.trail_id != e2.trail_id
        AND ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) <= $2
        AND ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) > $3
      UNION ALL
      -- Find end points near other trails (Y-intersections)
      SELECT
        e1.trail_id as visiting_trail_id,
        e1.trail_name as visiting_trail_name,
        e1.end_point as visiting_endpoint,
        e2.trail_id as visited_trail_id,
        e2.trail_name as visited_trail_name,
        e2.trail_geom as visited_trail_geom,
        ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) as distance_meters,
        ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)))::json as split_point,
        ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)) as split_ratio
      FROM trail_endpoints e1
      CROSS JOIN trail_endpoints e2
      WHERE e1.trail_id != e2.trail_id
        AND ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) <= $2
        AND ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) > $3
    ),
    best_matches AS (
      SELECT DISTINCT ON (visiting_trail_id, visited_trail_id)
        visiting_trail_id,
        visiting_trail_name,
        visiting_endpoint,
        visited_trail_id,
        visited_trail_name,
        visited_trail_geom,
        distance_meters,
        split_point,
        split_ratio
      FROM y_intersections
      ORDER BY visiting_trail_id, visited_trail_id, distance_meters
    )
    SELECT * FROM best_matches
    ORDER BY distance_meters
    LIMIT 50
  `;

  const result = await pool.query(query, [
    config.minTrailLengthMeters,
    config.toleranceMeters,
    config.minSnapDistanceMeters
  ]);

  return result.rows;
}

listAllYIntersections();
