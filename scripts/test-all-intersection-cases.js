const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testAllIntersectionCases() {
  try {
    console.log('🔍 Testing All Intersection Cases from Database...');
    
    // Define all test cases with their expected intersection types
    const testCases = [
      {
        name: 'Bluebell Y-Intersection',
        trail1Id: 'ad04f6c9-3521-41e0-a43c-3496f44be4b7',
        trail2Id: 'bdf819ed-742a-4769-ba88-4e57aec24bae',
        trail1Name: 'Bluebell Road',
        trail2Name: 'Bluebell Spur Trail',
        expectedType: 'Y-Intersection'
      },
      {
        name: 'Enchanted T-Intersection',
        trail1Id: '67fa5621-d393-4953-ba82-f79ad67cdaf5',
        trail2Id: 'c7c8ecd5-42c8-4947-b02e-25dc832e2f1e',
        trail1Name: 'Enchanted Mesa Trail',
        trail2Name: 'Enchanted-Kohler Spur Trail',
        expectedType: 'T-Intersection'
      },
      {
        name: 'Kohler P-Intersection',
        trail1Id: '712ff0c8-b8cc-404e-88fe-399a6a602a75',
        trail2Id: 'a72a4e1a-3c7d-433f-9133-b52a97e4ab2f',
        trail1Name: 'Kohler Mesa Trail',
        trail2Name: 'Kohler Mesa Trail (2nd)',
        expectedType: 'P-Intersection'
      },
      {
        name: 'Shanahan T-Intersection',
        trail1Id: 'd6b2af8a-a32f-4ae0-b6ed-a55c5b0a4f9a',
        trail2Id: '628e07c6-b319-4d16-956d-ab5b0a26c7fa',
        trail1Name: 'North Fork Shanahan Trail',
        trail2Name: 'Shanahan Connector Trail',
        expectedType: 'T-Intersection'
      }
    ];
    
    const results = [];
    
    for (const testCase of testCases) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 Testing: ${testCase.name}`);
      console.log(`${'='.repeat(80)}`);
      
      const result = await testSingleCase(testCase);
      results.push(result);
    }
    
    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('📋 SUMMARY OF ALL TEST CASES');
    console.log(`${'='.repeat(80)}`);
    
    let successCount = 0;
    for (const result of results) {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.name}: ${result.intersectionType} (${result.segmentsCreated} segments)`);
      if (result.success) successCount++;
    }
    
    console.log(`\n🎯 Overall Success Rate: ${successCount}/${results.length} (${(successCount/results.length*100).toFixed(1)}%)`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

async function testSingleCase(testCase) {
  try {
    console.log(`🔍 Testing: ${testCase.trail1Name} ↔ ${testCase.trail2Name}`);
    
    // Get trail data from database
    const trailsResult = await pgClient.query(`
      SELECT 
        app_uuid, 
        name, 
        source,
        ST_AsText(geometry) as geom_text,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_X(ST_StartPoint(geometry)) as start_lng,
        ST_Y(ST_StartPoint(geometry)) as start_lat,
        ST_X(ST_EndPoint(geometry)) as end_lng,
        ST_Y(ST_EndPoint(geometry)) as end_lat,
        ST_IsSimple(geometry) as is_simple,
        ST_IsValid(geometry) as is_valid,
        ST_GeometryType(geometry) as geom_type,
        ST_Dimension(geometry) as dimensions,
        ST_SRID(geometry) as srid
      FROM trails 
      WHERE app_uuid IN ($1, $2)
      ORDER BY name
    `, [testCase.trail1Id, testCase.trail2Id]);

    if (trailsResult.rows.length !== 2) {
      console.log(`   ❌ Expected 2 trails, found: ${trailsResult.rows.length}`);
      return {
        name: testCase.name,
        success: false,
        error: `Expected 2 trails, found: ${trailsResult.rows.length}`,
        intersectionType: 'Unknown',
        segmentsCreated: 0
      };
    }

    const [trail1, trail2] = trailsResult.rows;
    
    console.log(`   Trail 1: ${trail1.name} (${trail1.length_meters.toFixed(1)}m, ${trail1.num_points} points)`);
    console.log(`   Trail 2: ${trail2.name} (${trail2.length_meters.toFixed(1)}m, ${trail2.num_points} points)`);

    // Analyze intersection types with multiple tolerances
    const intersectionInfo = await analyzeIntersectionTypes(trail1, trail2);
    
    if (!intersectionInfo) {
      return {
        name: testCase.name,
        success: false,
        error: 'No intersection found with any tolerance',
        intersectionType: 'None',
        segmentsCreated: 0
      };
    }
    
    console.log(`   ✅ Found ${intersectionInfo.type} with tolerance ${intersectionInfo.tolerance}`);
    
    // Test comprehensive splitting
    const splittingResult = await testComprehensiveSplitting(trail1, trail2, intersectionInfo);
    
    return {
      name: testCase.name,
      success: splittingResult.success,
      intersectionType: intersectionInfo.type,
      segmentsCreated: splittingResult.segmentsCreated,
      tolerance: intersectionInfo.tolerance,
      error: splittingResult.error
    };
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return {
      name: testCase.name,
      success: false,
      error: error.message,
      intersectionType: 'Error',
      segmentsCreated: 0
    };
  }
}

async function analyzeIntersectionTypes(trail1, trail2) {
  console.log(`\n   🔍 Analyzing Intersection Types:`);
  
  // Test with multiple tolerances
  const tolerances = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005];
  
  for (const tolerance of tolerances) {
    console.log(`     Testing tolerance: ${tolerance}`);
    
    try {
      const result = await pgClient.query(`
        WITH trail1_rounded AS (
          SELECT ST_SnapToGrid(geometry, 0.000001) as geom 
          FROM trails WHERE app_uuid = $1
        ),
        trail2_rounded AS (
          SELECT ST_SnapToGrid(geometry, 0.000001) as geom 
          FROM trails WHERE app_uuid = $2
        ),
        trail1_snapped AS (
          SELECT ST_Snap(trail1_rounded.geom, trail2_rounded.geom, $3) as geom 
          FROM trail1_rounded, trail2_rounded
        ),
        trail2_snapped AS (
          SELECT ST_Snap(trail2_rounded.geom, trail1_rounded.geom, $3) as geom 
          FROM trail1_rounded, trail2_rounded
        ),
        intersection AS (
          SELECT ST_Intersection(trail1_snapped.geom, trail2_snapped.geom) as geom
          FROM trail1_snapped, trail2_snapped
        )
        SELECT 
          ST_Intersects(trail1_snapped.geom, trail2_snapped.geom) as intersects,
          ST_NumGeometries(intersection.geom) as intersection_count,
          ST_GeometryType(intersection.geom) as intersection_type,
          ST_AsText(intersection.geom) as intersection_geom,
          ST_Length(intersection.geom::geography) as intersection_length
        FROM trail1_snapped, trail2_snapped, intersection
      `, [trail1.app_uuid, trail2.app_uuid, tolerance]);

      const intersection = result.rows[0];
      
      if (intersection.intersects) {
        console.log(`       ✅ Intersection found!`);
        console.log(`       Type: ${intersection.intersection_type}`);
        console.log(`       Count: ${intersection.intersection_count}`);
        console.log(`       Length: ${intersection.intersection_length.toFixed(2)}m`);
        
        // Classify intersection type
        const intersectionType = classifyIntersectionType(intersection);
        console.log(`       Classification: ${intersectionType}`);
        
        return { tolerance, intersection, type: intersectionType };
      } else {
        console.log(`       ❌ No intersection`);
      }
    } catch (error) {
      console.log(`       ❌ Error: ${error.message}`);
    }
  }
  
  return null;
}

function classifyIntersectionType(intersection) {
  const count = intersection.intersection_count;
  const type = intersection.intersection_type;
  const length = intersection.intersection_length;
  
  if (type === 'ST_Point') {
    return 'T-Intersection';
  }
  
  if (type === 'ST_MultiPoint') {
    if (count === 2) return 'X-Intersection';
    if (count > 2) return 'P-Intersection (Multiple Points)';
    return 'T-Intersection (Multiple Points)';
  }
  
  if (type === 'ST_LineString') {
    if (length > 0) return 'Y-Intersection (Overlapping)';
  }
  
  if (type === 'ST_GeometryCollection') {
    return 'Complex-Intersection (Mixed)';
  }
  
  return 'Unknown-Intersection';
}

async function testComprehensiveSplitting(trail1, trail2, intersectionInfo) {
  console.log(`\n   🔧 Testing Comprehensive Splitting:`);
  
  // Create temporary table for testing
  await pgClient.query('DROP TABLE IF EXISTS temp_all_test');
  await pgClient.query(`
    CREATE TABLE temp_all_test AS 
    SELECT * FROM trails 
    WHERE app_uuid IN ($1, $2)
  `, [trail1.app_uuid, trail2.app_uuid]);
  
  try {
    const tolerance = intersectionInfo.tolerance;
    
    console.log(`     Step 1: Rounding coordinates...`);
    await pgClient.query(`
      UPDATE temp_all_test 
      SET geometry = ST_SnapToGrid(geometry, 0.000001)
    `);
    
    console.log(`     Step 2: Snapping trails with tolerance ${tolerance}...`);
    await pgClient.query(`
      UPDATE temp_all_test 
      SET geometry = ST_Snap(geometry, (
        SELECT ST_Union(geometry) 
        FROM temp_all_test 
        WHERE app_uuid != temp_all_test.app_uuid
      ), ${tolerance})
    `);
    
    console.log(`     Step 3: Finding intersection points...`);
    
    // Handle different intersection types
    let intersectionPoints = [];
    
    if (intersectionInfo.intersection.intersection_type === 'ST_MultiPoint') {
      // Extract individual points from MultiPoint
      const pointsResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test WHERE app_uuid = $2
        ),
        intersection AS (
          SELECT ST_Intersection(trail1.geom, trail2.geom) as geom
          FROM trail1, trail2
        )
        SELECT 
          (ST_Dump(intersection.geom)).geom as point_geom,
          (ST_Dump(intersection.geom)).path as point_path
        FROM intersection
      `, [trail1.app_uuid, trail2.app_uuid]);
      
      intersectionPoints = pointsResult.rows;
      console.log(`       Found ${intersectionPoints.length} intersection points`);
      
    } else if (intersectionInfo.intersection.intersection_type === 'ST_Point') {
      // Single point intersection
      const pointResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test WHERE app_uuid = $2
        )
        SELECT ST_Intersection(trail1.geom, trail2.geom) as point_geom
        FROM trail1, trail2
      `, [trail1.app_uuid, trail2.app_uuid]);
      
      intersectionPoints = [{ point_geom: pointResult.rows[0].point_geom, point_path: [1] }];
      console.log(`       Found 1 intersection point`);
      
    } else if (intersectionInfo.intersection.intersection_type === 'ST_LineString') {
      // Line intersection - extract endpoints
      const lineResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test WHERE app_uuid = $2
        ),
        intersection AS (
          SELECT ST_Intersection(trail1.geom, trail2.geom) as geom
          FROM trail1, trail2
        )
        SELECT 
          ST_StartPoint(intersection.geom) as point_geom
        FROM intersection
        UNION ALL
        SELECT 
          ST_EndPoint(intersection.geom) as point_geom
        FROM intersection
      `, [trail1.app_uuid, trail2.app_uuid]);
      
      intersectionPoints = lineResult.rows.map((row, index) => ({ 
        point_geom: row.point_geom, 
        point_path: [index + 1] 
      }));
      console.log(`       Found ${intersectionPoints.length} intersection endpoints`);
    }
    
    if (intersectionPoints.length > 0) {
      console.log(`     Step 4: Splitting trails at intersection points...`);
      
      // Split both trails at all intersection points
      for (let i = 0; i < intersectionPoints.length; i++) {
        const point = intersectionPoints[i];
        console.log(`       Processing intersection point ${i + 1}`);
        
        await splitTrailAtIntersectionPoint(trail1.app_uuid, point.point_geom, i + 1);
        await splitTrailAtIntersectionPoint(trail2.app_uuid, point.point_geom, i + 1);
      }
      
      // Count results
      const finalCount = await pgClient.query(`
        SELECT COUNT(*) as count, 
               COUNT(CASE WHEN name LIKE '%(Segment %' THEN 1 END) as segments
        FROM temp_all_test
      `);
      
      console.log(`     ✅ Final result: ${finalCount.rows[0].count} trails, ${finalCount.rows[0].segments} segments`);
      
      return {
        success: true,
        segmentsCreated: finalCount.rows[0].segments
      };
      
    } else {
      console.log(`     ❌ No intersection points found for splitting`);
      return {
        success: false,
        segmentsCreated: 0,
        error: 'No intersection points found for splitting'
      };
    }
    
  } catch (error) {
    console.log(`     ❌ Splitting failed: ${error.message}`);
    return {
      success: false,
      segmentsCreated: 0,
      error: error.message
    };
  } finally {
    await pgClient.query('DROP TABLE IF EXISTS temp_all_test');
  }
}

async function splitTrailAtIntersectionPoint(trailId, intersectionPoint, pointIndex) {
  try {
    const splitResult = await pgClient.query(`
      WITH intersection_point AS (
        SELECT $1::geometry as point
      ),
      trail_split AS (
        SELECT ST_Split(
          (SELECT geometry FROM temp_all_test WHERE app_uuid = $2),
          ST_Buffer(intersection_point.point, 0.000001)
        ) as split_geom
        FROM intersection_point
      )
      SELECT 
        ST_NumGeometries(split_geom) as num_segments,
        split_geom
      FROM trail_split
    `, [intersectionPoint, trailId]);
    
    const split = splitResult.rows[0];
    
    if (split.num_segments > 1) {
      console.log(`         Trail ${trailId}: Split into ${split.num_segments} segments`);
      
      // Get original trail data
      const originalTrail = await pgClient.query(`
        SELECT * FROM temp_all_test WHERE app_uuid = $1
      `, [trailId]);
      
      if (originalTrail.rows.length > 0) {
        const trail = originalTrail.rows[0];
        
        // Insert split segments
        for (let i = 1; i <= split.num_segments; i++) {
          const segmentGeom = await pgClient.query(`
            SELECT ST_GeometryN($1, $2) as geom
          `, [split.split_geom, i]);
          
          if (segmentGeom.rows[0].geom) {
            const length = await pgClient.query(`
              SELECT ST_Length($1::geography) as length_m
            `, [segmentGeom.rows[0].geom]);
            
            if (length.rows[0].length_m > 1) {
              await pgClient.query(`
                INSERT INTO temp_all_test (
                  app_uuid, name, source, geometry, trail_type, surface_type, 
                  difficulty, length_meters, elevation_gain, elevation_loss, 
                  max_elevation, min_elevation, avg_elevation, bbox_min_lng, 
                  bbox_max_lng, bbox_min_lat, bbox_max_lat
                ) VALUES (
                  gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
                )
              `, [
                `${trail.name} (Segment ${i})`,
                trail.source,
                segmentGeom.rows[0].geom,
                trail.trail_type,
                trail.surface_type,
                trail.difficulty,
                length.rows[0].length_m,
                trail.elevation_gain,
                trail.elevation_loss,
                trail.max_elevation,
                trail.min_elevation,
                trail.avg_elevation,
                trail.bbox_min_lng,
                trail.bbox_max_lng,
                trail.bbox_min_lat,
                trail.bbox_max_lat
              ]);
            }
          }
        }
        
        // Delete original trail
        await pgClient.query(`
          DELETE FROM temp_all_test WHERE app_uuid = $1
        `, [trailId]);
      }
    }
  } catch (error) {
    console.log(`         ❌ Failed to split trail ${trailId}: ${error.message}`);
  }
}

testAllIntersectionCases();
