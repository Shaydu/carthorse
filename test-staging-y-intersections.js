const { Pool } = require('pg');

async function testStagingYIntersections() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    console.log('🔍 Testing Y-intersections in latest staging schema (carthorse_1756318501665)...');
    
    // Check for Y-intersections in staging data (READ-ONLY)
    const yIntersectionCheck = await pgClient.query(`
      WITH trail_geometries AS (
        SELECT 
          trail_uuid as trail_id,
          trail_name as trail_name,
          the_geom as trail_geom,
          ST_StartPoint(the_geom) as start_point,
          ST_EndPoint(the_geom) as end_point
        FROM carthorse_1756318501665.ways
        WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
      ),
      intersection_pairs AS (
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.trail_geom as trail1_geom,
          t1.start_point as trail1_start,
          t1.end_point as trail1_end,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.trail_geom as trail2_geom,
          t2.start_point as trail2_start,
          t2.end_point as trail2_end,
          ST_Intersection(t1.trail_geom, t2.trail_geom) as intersection_point
        FROM trail_geometries t1
        JOIN trail_geometries t2 ON t1.trail_id < t2.trail_id
        WHERE ST_Intersects(t1.trail_geom, t2.trail_geom)
          AND ST_GeometryType(ST_Intersection(t1.trail_geom, t2.trail_geom)) = 'ST_Point'
      ),
      filtered_intersections AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail2_id,
          trail2_name,
          intersection_point,
          -- Check if intersection is far from endpoints (midpoint intersection)
          LEAST(
            ST_Distance(trail1_start, intersection_point),
            ST_Distance(trail1_end, intersection_point)
          ) as trail1_distance_to_endpoint,
          LEAST(
            ST_Distance(trail2_start, intersection_point),
            ST_Distance(trail2_end, intersection_point)
          ) as trail2_distance_to_endpoint
        FROM intersection_pairs
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail2_id,
        trail2_name,
        ST_AsText(intersection_point) as intersection_coords,
        trail1_distance_to_endpoint as distance1,
        trail2_distance_to_endpoint as distance2
      FROM filtered_intersections
      WHERE trail1_distance_to_endpoint > 5.0  -- Intersection is far from trail1 endpoints
        AND trail2_distance_to_endpoint > 5.0  -- Intersection is far from trail2 endpoints
      ORDER BY trail1_distance_to_endpoint ASC
      LIMIT 20
    `);

    console.log(`Found ${yIntersectionCheck.rows.length} potential Y-intersections in staging data:`);
    
    if (yIntersectionCheck.rows.length > 0) {
      yIntersectionCheck.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. ${row.trail1_name} ↔ ${row.trail2_name}`);
        console.log(`     Trail1 ID: ${row.trail1_id}`);
        console.log(`     Trail2 ID: ${row.trail2_id}`);
        console.log(`     Intersection: ${row.intersection_coords}`);
        console.log(`     Distances: ${row.distance1.toFixed(1)}m, ${row.distance2.toFixed(1)}m`);
      });
      
      // Test the splitting logic (READ-ONLY simulation)
      if (yIntersectionCheck.rows.length > 0) {
        console.log('\n🧪 Testing Y-intersection splitting simulation (READ-ONLY)...');
        
        const firstIntersection = yIntersectionCheck.rows[0];
        console.log(`Simulating split for: ${firstIntersection.trail1_name} ↔ ${firstIntersection.trail2_name}`);
        
        // Get the full trail data for the first intersection (READ-ONLY)
        const trail1Data = await pgClient.query(`
          SELECT trail_uuid, trail_name, the_geom, trail_type, length_km, elevation_gain, elevation_loss
          FROM carthorse_1756318501665.ways 
          WHERE trail_uuid = $1
        `, [firstIntersection.trail1_id]);
        
        const trail2Data = await pgClient.query(`
          SELECT trail_uuid, trail_name, the_geom, trail_type, length_km, elevation_gain, elevation_loss
          FROM carthorse_1756318501665.ways 
          WHERE trail_uuid = $1
        `, [firstIntersection.trail2_id]);
        
        if (trail1Data.rows.length > 0 && trail2Data.rows.length > 0) {
          console.log(`✅ Found trail data for splitting simulation`);
          console.log(`   Trail 1: ${trail1Data.rows[0].trail_name} (${trail1Data.rows[0].length_km}km)`);
          console.log(`   Trail 2: ${trail2Data.rows[0].trail_name} (${trail2Data.rows[0].length_km}km)`);
          
          // Test the splitting logic (READ-ONLY simulation)
          await testSplittingSimulation(pgClient, trail1Data.rows[0], trail2Data.rows[0], firstIntersection.intersection_point);
        }
      }
    } else {
      console.log('No Y-intersections found in staging data.');
      
      // Check for any intersections at all
      console.log('\n🔍 Checking for any intersections in staging data...');
      const anyIntersections = await pgClient.query(`
        SELECT COUNT(*) as intersection_count
        FROM (
          SELECT DISTINCT t1.trail_uuid as trail1_id, t2.trail_uuid as trail2_id
          FROM carthorse_1756318501665.ways t1
          JOIN carthorse_1756318501665.ways t2 ON t1.trail_uuid < t2.trail_uuid
          WHERE ST_Intersects(t1.the_geom, t2.the_geom)
        ) intersections
      `);
      
      console.log(`Total intersections found: ${anyIntersections.rows[0].intersection_count}`);
    }

  } catch (error) {
    console.error('❌ Error testing staging Y-intersections:', error);
  } finally {
    await pgClient.end();
  }
}

async function testSplittingSimulation(pgClient, trail1, trail2, intersectionPoint) {
  try {
    console.log('\n🔧 Testing splitting logic simulation (READ-ONLY)...');
    
    // Test splitting trail 1 at the intersection point (READ-ONLY simulation)
    console.log(`\nSimulating split of ${trail1.trail_name} at intersection point...`);
    
    const splitResult1 = await pgClient.query(`
      SELECT (ST_Dump(ST_Split($1::geometry, ST_Buffer($2::geography, 0.1)::geometry))).geom AS segment
    `, [trail1.the_geom, intersectionPoint]);
    
    console.log(`   Trail 1 would be split into ${splitResult1.rows.length} segments`);
    
    // Test splitting trail 2 at the intersection point (READ-ONLY simulation)
    console.log(`\nSimulating split of ${trail2.trail_name} at intersection point...`);
    
    const splitResult2 = await pgClient.query(`
      SELECT (ST_Dump(ST_Split($1::geometry, ST_Buffer($2::geography, 0.1)::geometry))).geom AS segment
    `, [trail2.the_geom, intersectionPoint]);
    
    console.log(`   Trail 2 would be split into ${splitResult2.rows.length} segments`);
    
    // Calculate lengths of split segments (READ-ONLY)
    console.log('\n📏 Simulated segment lengths:');
    
    for (let i = 0; i < splitResult1.rows.length; i++) {
      const length = await pgClient.query(`
        SELECT ST_Length($1::geography) as length_m
      `, [splitResult1.rows[i].segment]);
      console.log(`   Trail 1 segment ${i + 1}: ${length.rows[0].length_m.toFixed(1)}m`);
    }
    
    for (let i = 0; i < splitResult2.rows.length; i++) {
      const length = await pgClient.query(`
        SELECT ST_Length($1::geography) as length_m
      `, [splitResult2.rows[i].segment]);
      console.log(`   Trail 2 segment ${i + 1}: ${length.rows[0].length_m.toFixed(1)}m`);
    }
    
    console.log('\n✅ Y-intersection splitting simulation completed successfully!');
    console.log('⚠️  This was a READ-ONLY simulation - no data was modified.');
    
  } catch (error) {
    console.error('❌ Error in splitting simulation:', error);
  }
}

testStagingYIntersections();
