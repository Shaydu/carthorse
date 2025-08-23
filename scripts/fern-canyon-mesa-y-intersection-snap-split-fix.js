const { Pool } = require('pg');
require('dotenv').config();

async function showYIntersectionResults() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'tester',
    database: 'trail_master_db',
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT || 5432,
  });

  try {
    console.log('🔄 Creating Y-intersection snapping results and exporting GeoJSON...\n');

    // Configuration
    const config = {
      toleranceMeters: 10,
      minTrailLengthMeters: 5,
      minSnapDistanceMeters: 0, // No minimum distance - we'll snap close intersections together
      tempSchema: 'y_intersection_demo',
      testBbox: {
        minLng: -105.31000000000000, maxLng: -105.26050515816028, // Expanded west to include Bear Canyon/Bear Peak
        minLat: 39.95578418458248, maxLat: 40.09183855535663 // Extended 3km north, 1.5km south for Fern Canyon
      }
    };

    // Step 1: Create temporary schema
    console.log('🔄 Step 1: Creating temporary schema...');
    await pool.query(`DROP SCHEMA IF EXISTS ${config.tempSchema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${config.tempSchema}`);
    
    // Create trails table
    await pool.query(`
      CREATE TABLE ${config.tempSchema}.trails (
        app_uuid TEXT PRIMARY KEY,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        geometry geometry(LineString,4326)
      )
    `);
    console.log('   ✅ Temporary schema created\n');

    // Step 2: Copy test data from public.trails
    console.log('🔄 Step 2: Copying test data from public.trails...');
    
    // Use carthorse user to read from public.trails
    const carthorsePool = new Pool({
      host: process.env.PGHOST || 'localhost',
      user: 'carthorse',
      database: 'trail_master_db',
      password: process.env.PGPASSWORD,
      port: process.env.PGPORT || 5432,
    });

    // Copy trails within test bbox
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

    // Insert into temporary schema
    for (const trail of copyResult.rows) {
      await pool.query(`
        INSERT INTO ${config.tempSchema}.trails (app_uuid, name, region, trail_type, geometry)
        VALUES ($1, $2, $3, $4, $5)
      `, [trail.app_uuid, trail.name, trail.region, trail.trail_type, trail.geometry]);
    }

    await carthorsePool.end();
    console.log(`   ✅ Copied ${copyResult.rows.length} trails to temporary schema\n`);

    // Step 3: Export "BEFORE" GeoJSON
    console.log('🔄 Step 3: Exporting BEFORE GeoJSON...');
    const beforeGeoJSON = await exportTrailsAsGeoJSON(pool, config.tempSchema, 'BEFORE Y-intersection fixes');
    console.log(`   ✅ BEFORE: ${beforeGeoJSON.features.length} trail features\n`);

    // Step 4: Iteratively find and fix all Y-intersections (max 5 iterations)
    console.log('🔄 Step 4: Iteratively fixing all Y-intersections (max 5 iterations)...');

    let iteration = 1;
    let totalProcessed = 0;
    let hasMoreIntersections = true;
    const maxIterations = 5;

    while (hasMoreIntersections && iteration <= maxIterations) {
      console.log(`   🔄 Iteration ${iteration}/${maxIterations}:`);

      // Find all potential Y-intersections
      const allIntersections = await findAllYIntersections(pool, config);

      if (allIntersections.length === 0) {
        console.log(`      ✅ No more Y-intersections found`);
        hasMoreIntersections = false;
        break;
      }

      console.log(`      Found ${allIntersections.length} potential Y-intersections`);
      
      // Show first few intersections for debugging
      console.log(`      First 5 intersections:`);
      allIntersections.slice(0, 5).forEach((intersection, index) => {
        console.log(`        ${index + 1}. ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (${intersection.distance_meters.toFixed(6)}m)`);
      });

      let iterationProcessed = 0;
      const processedTrails = new Set(); // Track trails processed in this iteration

      for (const intersection of allIntersections) {
        // Skip if either trail has already been processed in this iteration
        if (processedTrails.has(intersection.visited_trail_id) || processedTrails.has(intersection.visiting_trail_id)) {
          console.log(`      ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (trail already processed)`);
          continue;
        }

        console.log(`      🔧 Processing: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`);

        const result = await performYIntersectionFix(pool, config, intersection);

        if (result.success) {
          console.log(`         ✅ Fixed: ${result.message}`);
          iterationProcessed++;
          totalProcessed++;
          // Mark both trails as processed to avoid conflicts
          processedTrails.add(intersection.visited_trail_id);
          processedTrails.add(intersection.visiting_trail_id);
        } else {
          console.log(`         ❌ Failed: ${result.error}`);
        }
      }

      console.log(`      📊 Iteration ${iteration}: processed ${iterationProcessed} Y-intersections`);

      if (iterationProcessed === 0) {
        console.log(`      ⚠️  No Y-intersections were successfully processed in this iteration`);
        hasMoreIntersections = false;
      }

      iteration++;
    }

    console.log(`   📊 Total successfully processed: ${totalProcessed} Y-intersections\n`);

    // Step 4.5: Find and fix true geometric intersections
    console.log('🔄 Step 4.5: Finding and fixing true geometric intersections...');
    
    const trueIntersections = await findTrueIntersections(pool, config);
    
    if (trueIntersections.length === 0) {
      console.log('   ✅ No true intersections found');
    } else {
      console.log(`   Found ${trueIntersections.length} true intersections`);
      
      // Show first few intersections for debugging
      console.log(`   First 5 true intersections:`);
      trueIntersections.slice(0, 5).forEach((intersection, index) => {
        console.log(`     ${index + 1}. ${intersection.trail1_name} × ${intersection.trail2_name}`);
      });

      let intersectionProcessed = 0;
      const processedIntersectionTrails = new Set(); // Track trails processed in intersection phase

      for (const intersection of trueIntersections) {
        // Skip if either trail has already been processed
        if (processedIntersectionTrails.has(intersection.trail1_id) || processedIntersectionTrails.has(intersection.trail2_id)) {
          console.log(`   ⏭️  Skipping intersection: ${intersection.trail1_name} × ${intersection.trail2_name} (trail already processed)`);
          continue;
        }

        const result = await performTrueIntersectionFix(pool, config, intersection);

        if (result.success) {
          console.log(`   ✅ Fixed intersection: ${result.message}`);
          intersectionProcessed++;
          // Mark both trails as processed to avoid conflicts
          processedIntersectionTrails.add(intersection.trail1_id);
          processedIntersectionTrails.add(intersection.trail2_id);
        } else {
          console.log(`   ❌ Failed intersection: ${result.error}`);
        }
      }

      console.log(`   📊 Total true intersections processed: ${intersectionProcessed}\n`);
    }

    // Step 5: Export "AFTER" GeoJSON
    console.log('🔄 Step 5: Exporting AFTER GeoJSON...');
    const afterGeoJSON = await exportTrailsAsGeoJSON(pool, config.tempSchema, 'AFTER Y-intersection fixes');
    console.log(`   ✅ AFTER: ${afterGeoJSON.features.length} trail features\n`);

    // Step 6: Show the differences
    console.log('📊 RESULTS COMPARISON:');
    console.log(`   BEFORE: ${beforeGeoJSON.features.length} trails`);
    console.log(`   AFTER:  ${afterGeoJSON.features.length} trails`);
    console.log(`   ADDED:  ${afterGeoJSON.features.length - beforeGeoJSON.features.length} new trails (connectors + split segments)\n`);

    // Step 7: Export specific test area GeoJSON
    console.log('🔄 Step 6: Exporting focused test area GeoJSON...');
    const testAreaGeoJSON = await exportTestAreaGeoJSON(pool, config.tempSchema);
    
    // Step 8: Write GeoJSON to files
    const fs = require('fs');
    
    // Write BEFORE GeoJSON
    fs.writeFileSync('test-output/before-y-intersection-sample.geojson', JSON.stringify(beforeGeoJSON, null, 2));
    console.log('📄 BEFORE GeoJSON written to: test-output/before-y-intersection-sample.geojson');
    
    // Write AFTER GeoJSON (test area)
    fs.writeFileSync('test-output/after-y-intersection-test-area.geojson', JSON.stringify(testAreaGeoJSON, null, 2));
    console.log('📄 AFTER GeoJSON (test area) written to: test-output/after-y-intersection-test-area.geojson');
    
    // Write AFTER GeoJSON (complete)
    fs.writeFileSync('test-output/after-y-intersection-complete.geojson', JSON.stringify(afterGeoJSON, null, 2));
    console.log('📄 AFTER GeoJSON (complete) written to: test-output/after-y-intersection-complete.geojson');

    // Step 9: Cleanup
    console.log('\n🧹 Cleaning up demo schema...');
    await pool.query(`DROP SCHEMA IF EXISTS ${config.tempSchema} CASCADE`);
    console.log('   ✅ Demo schema cleaned up\n');

    console.log('✅ Y-intersection GeoJSON export completed!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

/**
 * Find all potential Y-intersections with dynamic split point calculation
 */
async function findAllYIntersections(pool, config) {
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
        ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)) as split_ratio,
        ST_Length(ST_LineSubstring(e2.trail_geom, 0, ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)))::geography) as distance_from_start,
        ST_Length(ST_LineSubstring(e2.trail_geom, ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)), 1)::geography) as distance_from_end
      FROM trail_endpoints e1
      CROSS JOIN trail_endpoints e2
      WHERE e1.trail_id != e2.trail_id
        AND (ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) <= $2
             OR ST_DWithin(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography, 0.1))  -- Include shared endpoints
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
        ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)) as split_ratio,
        ST_Length(ST_LineSubstring(e2.trail_geom, 0, ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)))::geography) as distance_from_start,
        ST_Length(ST_LineSubstring(e2.trail_geom, ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)), 1)::geography) as distance_from_end
      FROM trail_endpoints e1
      CROSS JOIN trail_endpoints e2
      WHERE e1.trail_id != e2.trail_id
        AND (ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) <= $2
             OR ST_DWithin(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography, 0.1))  -- Include shared endpoints
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
        split_ratio,
        distance_from_start,
        distance_from_end
      FROM y_intersections
      WHERE distance_from_start >= 1.0 AND distance_from_end >= 1.0  -- Only consider splits that are at least 1m from each endpoint
      ORDER BY visiting_trail_id, visited_trail_id, distance_meters
    )
    SELECT * FROM best_matches
    ORDER BY distance_meters
    -- No limit - process all intersections
  `;

  const result = await pool.query(query, [
    config.minTrailLengthMeters,
    config.toleranceMeters
  ]);

  return result.rows;
}

/**
 * Find true geometric intersections where trails actually cross each other
 */
async function findTrueIntersections(pool, config) {
  const query = `
    WITH trail_pairs AS (
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t1.geometry as trail1_geom,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        t2.geometry as trail2_geom
      FROM ${config.tempSchema}.trails t1
      CROSS JOIN ${config.tempSchema}.trails t2
      WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
        AND ST_Length(t1.geometry::geography) >= $1
        AND ST_Length(t2.geometry::geography) >= $1
        AND ST_IsValid(t1.geometry)
        AND ST_IsValid(t2.geometry)
        AND ST_Intersects(t1.geometry, t2.geometry)  -- Only trails that actually intersect
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
        -- Calculate split ratios for both trails
        ST_LineLocatePoint(trail1_geom, intersection_point) as trail1_split_ratio,
        ST_LineLocatePoint(trail2_geom, intersection_point) as trail2_split_ratio,
        -- Calculate distances from endpoints to ensure we're not too close
        ST_Length(ST_LineSubstring(trail1_geom, 0.0, ST_LineLocatePoint(trail1_geom, intersection_point))) as trail1_distance_from_start,
        ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point))) as trail2_distance_from_start,
        -- Check if this is a T-intersection (one trail ends at the intersection point)
        (ST_LineLocatePoint(trail1_geom, intersection_point) = 0.0 OR ST_LineLocatePoint(trail1_geom, intersection_point) = 1.0 OR
         ST_LineLocatePoint(trail2_geom, intersection_point) = 0.0 OR ST_LineLocatePoint(trail2_geom, intersection_point) = 1.0) as is_t_intersection
      FROM intersection_points
      WHERE 
        -- Only question: Do trails intersect at X and is intersection point > 1m from either end?
        ST_Length(ST_LineSubstring(trail1_geom, 0.0, ST_LineLocatePoint(trail1_geom, intersection_point))) > 1.0
        AND ST_Length(ST_LineSubstring(trail1_geom, ST_LineLocatePoint(trail1_geom, intersection_point), 1.0)) > 1.0
        AND ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point))) > 1.0
        AND ST_Length(ST_LineSubstring(trail2_geom, ST_LineLocatePoint(trail2_geom, intersection_point), 1.0)) > 1.0
    )
    SELECT 
      trail1_id,
      trail1_name,
      trail1_geom,
      trail2_id,
      trail2_name,
      trail2_geom,
      intersection_point_json,
      trail1_split_ratio,
      trail2_split_ratio,
      trail1_distance_from_start,
      trail2_distance_from_start
    FROM validated_intersections
    ORDER BY trail1_name, trail2_name
  `;

  const result = await pool.query(query, [config.minTrailLengthMeters]);
  return result.rows;
}

/**
 * Perform Y-intersection fix for a specific intersection
 */
async function performYIntersectionFix(pool, config, intersection) {
  try {
    // Step 1: Snap the visiting trail endpoint to the visited trail
    const snapResult = await snapTrailEndpoint(pool, config.tempSchema, intersection.visiting_trail_id, intersection.visiting_endpoint, intersection.split_point);
    
    if (!snapResult.success) {
      return { success: false, error: `Snap failed: ${snapResult.error}` };
    }
    
    // Step 2: Split the visited trail at the snapped point
    const splitResult = await splitTrail(pool, config.tempSchema, intersection.visited_trail_id, intersection.split_point);
    
    if (!splitResult.success) {
      return { success: false, error: `Split failed: ${splitResult.error}` };
    }

    // Create connector
    const connectorResult = await createConnector(
      pool, 
      config.tempSchema, 
      intersection.visiting_trail_id,
      intersection.visiting_endpoint, 
      intersection.split_point,
      `${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`
    );

    if (!connectorResult.success) {
      return { success: false, error: `Connector failed: ${connectorResult.error}` };
    }

    return { 
      success: true, 
      message: `Split ${intersection.visited_trail_name} and created connector (${intersection.distance_meters.toFixed(2)}m)`
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Perform true intersection fix for a specific intersection
 */
async function performTrueIntersectionFix(pool, config, intersection) {
  try {
    console.log(`         🔧 Processing true intersection: ${intersection.trail1_name} × ${intersection.trail2_name}`);

    // Step 1: Split trail1 at the intersection point
    const splitResult1 = await splitTrail(pool, config.tempSchema, intersection.trail1_id, intersection.intersection_point_json);
    
    if (!splitResult1.success) {
      return { success: false, error: `Trail1 split failed: ${splitResult1.error}` };
    }

    // Step 2: Split trail2 at the intersection point
    const splitResult2 = await splitTrail(pool, config.tempSchema, intersection.trail2_id, intersection.intersection_point_json);
    
    if (!splitResult2.success) {
      return { success: false, error: `Trail2 split failed: ${splitResult2.error}` };
    }

    // Step 3: Create a connector at the intersection point
    const connectorResult = await createConnector(
      pool, 
      config.tempSchema, 
      intersection.trail1_id,
      intersection.intersection_point_json, 
      intersection.intersection_point_json,
      `${intersection.trail1_name} × ${intersection.trail2_name}`
    );

    if (!connectorResult.success) {
      return { success: false, error: `Connector failed: ${connectorResult.error}` };
    }

    return { 
      success: true, 
      message: `Split both trails at intersection point (${intersection.trail1_distance_from_start.toFixed(2)}m, ${intersection.trail2_distance_from_start.toFixed(2)}m)`
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Snap a trail endpoint to a specific point on another trail
 */
async function snapTrailEndpoint(pool, schema, trailId, endpoint, snapPoint) {
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');

    // Get original trail
    const originalTrail = await client.query(`
      SELECT * FROM ${schema}.trails WHERE app_uuid = $1
    `, [trailId]);

    if (originalTrail.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Trail not found' };
    }

    const trail = originalTrail.rows[0];
    
    // Determine if the endpoint is the start or end point
    const startPoint = `ST_GeomFromGeoJSON('${JSON.stringify(endpoint)}')`;
    const endPoint = `ST_GeomFromGeoJSON('${JSON.stringify(endpoint)}')`;
    const snapPointGeom = `ST_GeomFromGeoJSON('${JSON.stringify(snapPoint)}')`;
    
    // Check which endpoint matches (with small tolerance for floating point precision)
    const endpointCheck = await client.query(`
      SELECT 
        ST_Distance(ST_StartPoint(geometry), ${startPoint}) as start_dist,
        ST_Distance(ST_EndPoint(geometry), ${endPoint}) as end_dist
      FROM ${schema}.trails 
      WHERE app_uuid = $1
    `, [trailId]);
    
    if (endpointCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Trail not found for endpoint check' };
    }
    
    const distances = endpointCheck.rows[0];
    const isStartPoint = distances.start_dist < distances.end_dist;
    
    // Create new geometry with snapped endpoint
    let newGeometry;
    if (isStartPoint) {
      // Snap start point
      newGeometry = `ST_SetPoint(geometry, 0, ${snapPointGeom})`;
    } else {
      // Snap end point
      newGeometry = `ST_SetPoint(geometry, ST_NPoints(geometry) - 1, ${snapPointGeom})`;
    }
    
    // Update the trail geometry
    await client.query(`
      UPDATE ${schema}.trails 
      SET geometry = ${newGeometry}
      WHERE app_uuid = $1
    `, [trailId]);
    
    await client.query('COMMIT');
    return { 
      success: true, 
      message: `Snapped ${isStartPoint ? 'start' : 'end'} point of trail ${trailId}`
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Split a trail at a specific point
 */
async function splitTrail(pool, schema, trailId, splitPoint) {
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');

    // Get original trail
    const originalTrail = await client.query(`
      SELECT * FROM ${schema}.trails WHERE app_uuid = $1
    `, [trailId]);

    if (originalTrail.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Trail not found' };
    }

    const trail = originalTrail.rows[0];
    
    // Debug: Log trail info
    console.log(`         🔍 DEBUG: Splitting trail ${trailId} (${trail.name})`);
    console.log(`         🔍 DEBUG: Trail length: ${trail.geometry ? 'valid' : 'invalid'}`);
    console.log(`         🔍 DEBUG: Split point: ${JSON.stringify(splitPoint)}`);

    // Single robust splitting method using ST_LineSubstring
    let splitSegments = null;

    try {
      // Calculate the split ratio using ST_LineLocatePoint
      const ratioQuery = `
        SELECT 
          ST_LineLocatePoint(geometry, ST_GeomFromGeoJSON('${JSON.stringify(splitPoint)}')) as split_ratio,
          ST_Length(geometry::geography) as trail_length
        FROM ${schema}.trails 
        WHERE app_uuid = $1
      `;
      
      const ratioResult = await client.query(ratioQuery, [trailId]);
      
      if (ratioResult.rows.length === 0) {
        throw new Error('Trail not found for ratio calculation');
      }
      
      const splitRatio = ratioResult.rows[0].split_ratio;
      const trailLength = ratioResult.rows[0].trail_length;
      
      console.log(`         🔍 DEBUG: Split ratio: ${splitRatio.toFixed(6)}, Trail length: ${trailLength.toFixed(2)}m`);
      
      // Validate split point is at least 1 meter from either endpoint (fixed distance, not percentage)
      const distanceFromStart = splitRatio * trailLength;
      const distanceFromEnd = (1.0 - splitRatio) * trailLength;
      const minDistanceFromEnd = 1.0; // 1 meter from each endpoint
      
      if (distanceFromStart < minDistanceFromEnd || distanceFromEnd < minDistanceFromEnd) {
        throw new Error(`Split point too close to endpoint: ${distanceFromStart.toFixed(2)}m from start, ${distanceFromEnd.toFixed(2)}m from end (must be at least ${minDistanceFromEnd}m from each endpoint)`);
      }
      
      // Split the trail into two segments using ST_LineSubstring
      const splitQuery = `
        SELECT 
          ST_LineSubstring(geometry, 0.0, $2) as segment1,
          ST_LineSubstring(geometry, $2, 1.0) as segment2
        FROM ${schema}.trails 
        WHERE app_uuid = $1
      `;
      
      const splitResult = await client.query(splitQuery, [trailId, splitRatio]);
      
      if (splitResult.rows.length === 0) {
        throw new Error('Failed to split trail geometry');
      }
      
      const row = splitResult.rows[0];
      
      // Validate segments have sufficient length
      const segment1Length = await client.query(`SELECT ST_Length($1::geography) as length`, [row.segment1]);
      const segment2Length = await client.query(`SELECT ST_Length($1::geography) as length`, [row.segment2]);
      
      console.log(`         🔍 DEBUG: Segment 1 length: ${segment1Length.rows[0].length.toFixed(2)}m`);
      console.log(`         🔍 DEBUG: Segment 2 length: ${segment2Length.rows[0].length.toFixed(2)}m`);
      
      if (segment1Length.rows[0].length < 1.0 || segment2Length.rows[0].length < 1.0) {
        throw new Error('Split segments too short (minimum 1m each)');
      }
      
      // Create split segments array
      splitSegments = [
        { segment_geom: row.segment1, segment_path: [1] },
        { segment_geom: row.segment2, segment_path: [2] }
      ];
      
      console.log(`         🔍 DEBUG: Successfully split trail into ${splitSegments.length} segments`);
      
    } catch (error) {
      console.log(`         🔍 DEBUG: Split failed: ${error.message}`);
      await client.query('ROLLBACK');
      return { success: false, error: `Split failed: ${error.message}` };
    }

    if (!splitSegments || splitSegments.length < 2) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Could not split trail into multiple segments' };
    }

    // Delete original trail
    await client.query(`DELETE FROM ${schema}.trails WHERE app_uuid = $1`, [trailId]);

    // Insert split segments
    for (let i = 0; i < splitSegments.length; i++) {
      const segment = splitSegments[i];
      const newId = `${trailId}_split_${i + 1}`;
      const newName = `${trail.name} (Split ${i + 1})`;

      await client.query(`
        INSERT INTO ${schema}.trails (app_uuid, name, region, trail_type, geometry)
        VALUES ($1, $2, $3, $4, $5)
      `, [newId, newName, trail.region, trail.trail_type, segment.segment_geom]);
    }

    // Commit transaction
    await client.query('COMMIT');

    return { 
      success: true, 
      message: `Split into ${splitSegments.length} segments`,
      segments: splitSegments
    };

  } catch (error) {
    // Rollback on any error
    await client.query('ROLLBACK');
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Manual trail splitting using ST_LineSubstring
 */
async function manualSplitTrail(client, schema, trailId, splitPoint) {
  // Convert GeoJSON split point to PostGIS geometry with proper SRID
  const splitPointGeom = `ST_SetSRID(ST_GeomFromGeoJSON('${JSON.stringify(splitPoint)}'), 4326)`;
  
  const query = `
    WITH trail_info AS (
      SELECT 
        geometry,
        ST_LineLocatePoint(geometry, ${splitPointGeom}) as ratio
      FROM ${schema}.trails 
      WHERE app_uuid = $1
    ),
    split_segments AS (
      SELECT 
        CASE 
          WHEN ratio <= 0.001 THEN 
            ST_LineSubstring(geometry, 0.001, 1.0)
          WHEN ratio >= 0.999 THEN 
            ST_LineSubstring(geometry, 0.0, 0.999)
          ELSE
            ST_LineSubstring(geometry, 0.0, ratio)
        END as segment1,
        CASE 
          WHEN ratio <= 0.001 THEN 
            NULL
          WHEN ratio >= 0.999 THEN 
            NULL
          ELSE
            ST_LineSubstring(geometry, ratio, 1.0)
        END as segment2
      FROM trail_info
    )
    SELECT 
      segment1 as segment_geom,
      1 as segment_path
    FROM split_segments
    WHERE ST_Length(segment1::geography) > 0.1
    UNION ALL
    SELECT 
      segment2 as segment_geom,
      2 as segment_path
    FROM split_segments
    WHERE segment2 IS NOT NULL 
      AND ST_Length(segment2::geography) > 0.1
  `;

  const result = await client.query(query, [trailId]);
  
  if (result.rows.length >= 2) {
    return { success: true, segments: result.rows };
  } else {
    return { success: false, error: 'Manual splitting failed' };
  }
}

/**
 * Create a connector trail
 */
async function createConnector(pool, schema, visitingTrailId, startPoint, endPoint, caseName) {
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');

    const connectorId = `connector_${visitingTrailId}_${Date.now()}`;
    const connectorName = `Y-Connector: ${caseName}`;
    
    await client.query(`
      INSERT INTO ${schema}.trails (app_uuid, name, region, trail_type, geometry)
      VALUES ($1, $2, $3, $4, ST_MakeLine($5, $6))
    `, [
      connectorId,
      connectorName,
      'boulder',
      'connector',
      startPoint,
      endPoint
    ]);

    // Commit transaction
    await client.query('COMMIT');

    return { success: true, connectorId };

  } catch (error) {
    // Rollback on any error
    await client.query('ROLLBACK');
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Export trails as GeoJSON
 */
async function exportTrailsAsGeoJSON(pool, schema, description) {
  const result = await pool.query(`
    SELECT 
      app_uuid,
      name,
      region,
      trail_type,
      ST_AsGeoJSON(ST_Transform(geometry, 4326))::json as geometry,
      ST_Length(geometry::geography) as length_meters
    FROM ${schema}.trails
    ORDER BY name
  `);

  const features = result.rows.map(row => ({
    type: "Feature",
    properties: {
      id: row.app_uuid,
      name: row.name || 'Unnamed Trail',
      region: row.region,
      trail_type: row.trail_type,
      length_meters: Math.round(row.length_meters * 100) / 100
    },
    geometry: row.geometry
  }));

  return {
    type: "FeatureCollection",
    description: description,
    features: features
  };
}

/**
 * Export test area GeoJSON (focused on our test cases)
 */
async function exportTestAreaGeoJSON(pool, schema) {
  // Define bounding box around our test areas
  const bbox = {
    minLng: -105.29, maxLng: -105.25,
    minLat: 39.955, maxLat: 40.005 // Extended 3km north
  };

  const result = await pool.query(`
    SELECT 
      app_uuid,
      name,
      region,
      trail_type,
      ST_AsGeoJSON(ST_Transform(geometry, 4326))::json as geometry,
      ST_Length(geometry::geography) as length_meters
    FROM ${schema}.trails
    WHERE ST_Intersects(
      geometry,
      ST_MakeEnvelope($1, $2, $3, $4, 4326)
    )
    ORDER BY 
      CASE 
        WHEN trail_type = 'connector' THEN 1 
        WHEN name LIKE '%Split%' THEN 2 
        ELSE 3 
      END,
      name
  `, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);

  const features = result.rows.map(row => ({
    type: "Feature",
    properties: {
      id: row.app_uuid,
      name: row.name || 'Unnamed Trail',
      region: row.region,
      trail_type: row.trail_type,
      length_meters: Math.round(row.length_meters * 100) / 100,
      color: row.trail_type === 'connector' ? '#FF0000' : 
             (row.name && row.name.includes('Split')) ? '#00FF00' : '#0000FF'
    },
    geometry: row.geometry
  }));

  return {
    type: "FeatureCollection",
    description: "Y-intersection test area (Mesa Trail & Fern Canyon)",
    features: features
  };
}

showYIntersectionResults();
