const { Pool } = require('pg');

async function testYIntersectionSplitting() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    console.log('🔍 Testing Y-intersection splitting on staging schema...');
    
    const stagingSchema = 'carthorse_1756318501665';
    
    // First, let's check for potential Y-intersections
    console.log('\n📊 Checking for potential Y-intersections...');
    
    const intersectionCheck = await pgClient.query(`
      WITH trail_geometries AS (
        SELECT 
          trail_uuid as trail_id,
          trail_name as trail_name,
          the_geom as trail_geom,
          ST_StartPoint(the_geom) as start_point,
          ST_EndPoint(the_geom) as end_point
        FROM ${stagingSchema}.ways
      ),
      intersection_pairs AS (
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.trail_geom as trail1_geom,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.trail_geom as trail2_geom,
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
            ST_Distance(ST_StartPoint(trail1_geom), intersection_point),
            ST_Distance(ST_EndPoint(trail1_geom), intersection_point)
          ) as trail1_distance_to_endpoint,
          LEAST(
            ST_Distance(ST_StartPoint(trail2_geom), intersection_point),
            ST_Distance(ST_EndPoint(trail2_geom), intersection_point)
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
    `);

    console.log(`Found ${intersectionCheck.rows.length} potential Y-intersections:`);
    
    if (intersectionCheck.rows.length > 0) {
      intersectionCheck.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. ${row.trail1_name} ↔ ${row.trail2_name}`);
        console.log(`     Intersection: ${row.intersection_coords}`);
        console.log(`     Distances: ${row.distance1.toFixed(1)}m, ${row.distance2.toFixed(1)}m`);
      });
      
      // Now let's check specifically for Bluestem and Shanahan intersections
      console.log('\n🔍 Checking specifically for Bluestem ↔ Shanahan intersections...');
      
      const bluestemShanahanCheck = await pgClient.query(`
        WITH trail_geometries AS (
          SELECT 
            trail_uuid as trail_id,
            trail_name as trail_name,
            the_geom as trail_geom,
            ST_StartPoint(the_geom) as start_point,
            ST_EndPoint(the_geom) as end_point
          FROM ${stagingSchema}.ways
          WHERE trail_name LIKE '%Bluestem%' OR trail_name LIKE '%Shanahan%'
        ),
        intersection_pairs AS (
          SELECT 
            t1.trail_id as trail1_id,
            t1.trail_name as trail1_name,
            t1.trail_geom as trail1_geom,
            t2.trail_id as trail2_id,
            t2.trail_name as trail2_name,
            t2.trail_geom as trail2_geom,
            ST_Intersection(t1.trail_geom, t2.trail_geom) as intersection_point
          FROM trail_geometries t1
          JOIN trail_geometries t2 ON t1.trail_id < t2.trail_id
          WHERE ST_Intersects(t1.trail_geom, t2.trail_geom)
            AND ST_GeometryType(ST_Intersection(t1.trail_geom, t2.trail_geom)) = 'ST_Point'
        )
        SELECT 
          trail1_id,
          trail1_name,
          trail2_id,
          trail2_name,
          ST_AsText(intersection_point) as intersection_coords,
          ST_Distance(ST_StartPoint(trail1_geom), intersection_point) as trail1_start_dist,
          ST_Distance(ST_EndPoint(trail1_geom), intersection_point) as trail1_end_dist,
          ST_Distance(ST_StartPoint(trail2_geom), intersection_point) as trail2_start_dist,
          ST_Distance(ST_EndPoint(trail2_geom), intersection_point) as trail2_end_dist
        FROM intersection_pairs
        ORDER BY trail1_name, trail2_name
      `);

      console.log(`Found ${bluestemShanahanCheck.rows.length} Bluestem ↔ Shanahan intersections:`);
      
      bluestemShanahanCheck.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. ${row.trail1_name} ↔ ${row.trail2_name}`);
        console.log(`     Intersection: ${row.intersection_coords}`);
        console.log(`     Trail1 distances: start=${row.trail1_start_dist.toFixed(1)}m, end=${row.trail1_end_dist.toFixed(1)}m`);
        console.log(`     Trail2 distances: start=${row.trail2_start_dist.toFixed(1)}m, end=${row.trail2_end_dist.toFixed(1)}m`);
      });
    } else {
      console.log('No Y-intersections found in the current staging schema.');
    }

  } catch (error) {
    console.error('❌ Error testing Y-intersection splitting:', error);
  } finally {
    await pgClient.end();
  }
}

testYIntersectionSplitting();
