const { Pool } = require('pg');
const fs = require('fs');

// Database connection
const pgClient = new Pool({
  user: 'carthorse',
  host: 'localhost',
  database: 'trail_master_db',
  password: 'carthorse',
  port: 5432,
});

async function testFoothillsDetection() {
  try {
    console.log('🔍 Testing Foothills North Trail intersection detection...');
    
    // Check if the trails exist in staging
    const trailsResult = await pgClient.query(`
      SELECT app_uuid, name, ST_Length(geometry::geography) as length_m
      FROM staging.trails 
      WHERE name IN ('Foothills North Trail', 'North Sky Trail')
      ORDER BY name
    `);
    
    console.log('📊 Found trails in staging:');
    for (const trail of trailsResult.rows) {
      console.log(`   - ${trail.name}: ${trail.app_uuid} (${parseFloat(trail.length_m).toFixed(1)}m)`);
    }
    
    if (trailsResult.rows.length < 2) {
      console.log('❌ Missing trails in staging schema');
      return;
    }
    
    // Test the exact detection query from MultipointIntersectionSplittingService
    const detectionQuery = `
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
        FROM staging.trails t1
        JOIN staging.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE 
          ST_Length(t1.geometry::geography) >= 10.0
          AND ST_Length(t2.geometry::geography) >= 10.0
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND t1.app_uuid != t2.app_uuid
          AND (t1.name = 'Foothills North Trail' OR t2.name = 'Foothills North Trail')
          AND (t1.name = 'North Sky Trail' OR t2.name = 'North Sky Trail')
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
          EXISTS(
            SELECT 1 FROM (
              SELECT (ST_Dump(intersection_geom)).geom as point_geom
            ) points
            WHERE ST_DWithin(points.point_geom, trail1_start, 1.0) 
               OR ST_DWithin(points.point_geom, trail1_end, 1.0)
               OR ST_DWithin(points.point_geom, trail2_start, 1.0)
               OR ST_DWithin(points.point_geom, trail2_end, 1.0)
          ) as has_endpoint_intersection,
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
        AND (
          (point_count = 2 AND has_middle_intersection) OR
          (point_count > 2 AND has_middle_intersection) OR
          (point_count = 2 AND has_endpoint_intersection AND has_middle_intersection) OR
          (point_count = 2 AND has_endpoint_intersection AND NOT has_middle_intersection)
        )
    `;
    
    const detectionResult = await pgClient.query(detectionQuery);
    
    console.log(`\n🔍 Detection results: ${detectionResult.rows.length} intersections found`);
    
    for (const row of detectionResult.rows) {
      console.log(`\n📍 Intersection: ${row.trail1_name} ↔ ${row.trail2_name}`);
      console.log(`   Type: ${row.intersection_type}`);
      console.log(`   Point count: ${row.point_count}`);
      console.log(`   Has endpoint intersection: ${row.has_endpoint_intersection}`);
      console.log(`   Has middle intersection: ${row.has_middle_intersection}`);
      
      // Test splitting on trail1
      console.log(`\n🔧 Testing split on ${row.trail1_name}...`);
      const splitResult = await pgClient.query(`
        SELECT ST_Split($1::geometry, $2::geometry) as split_geom
      `, [row.trail1_geom, row.intersection_geom]);
      
      if (splitResult.rows.length > 0 && splitResult.rows[0].split_geom) {
        const splitGeom = splitResult.rows[0].split_geom;
        
        // Count segments
        const segmentsResult = await pgClient.query(`
          SELECT ST_NumGeometries($1::geometry) as segment_count
        `, [splitGeom]);
        
        const segmentCount = segmentsResult.rows[0].segment_count;
        console.log(`   ✅ Split successful: ${segmentCount} segments created`);
        
        if (segmentCount > 1) {
          // Get segment lengths
          const lengthsResult = await pgClient.query(`
            SELECT 
              (ST_Dump($1::geometry)).path[1] as segment_num,
              ST_Length((ST_Dump($1::geometry)).geom::geography) as length_m
            FROM (SELECT $1::geometry as geom) as g
            ORDER BY segment_num
          `, [splitGeom]);
          
          console.log(`   📏 Segment lengths:`);
          for (const lengthRow of lengthsResult.rows) {
            console.log(`      Segment ${lengthRow.segment_num}: ${parseFloat(lengthRow.length_m).toFixed(1)}m`);
          }
        }
      } else {
        console.log(`   ❌ Split failed: no geometry returned`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testFoothillsDetection();
