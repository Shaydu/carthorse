const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testAllIntersectionCasesFixed() {
  try {
    console.log('🔍 Testing All Intersection Cases from Database (FIXED)...');
    
    // Define all test cases with correct trail IDs from public.trails
    const testCases = [
      {
        name: 'Enchanted T-Intersection',
        trail1Id: '67fa5621-d393-4953-ba82-f79ad67cdaf5', // Enchanted Mesa Trail (COTREX)
        trail2Id: 'c7c8ecd5-42c8-4947-b02e-25dc832e2f1e', // Enchanted-Kohler Spur Trail (COTREX)
        trail1Name: 'Enchanted Mesa Trail',
        trail2Name: 'Enchanted-Kohler Spur Trail',
        expectedType: 'T-Intersection'
      },
      {
        name: 'Mesa Trail T-Intersection',
        trail1Id: '2ebd1682-27b1-4bc2-83ec-912405718e0b', // Mesa Trail (1056m)
        trail2Id: '0332db1f-7a0c-42cd-9c11-41ae569a8aa6', // Mesa Trail (633m) - intersects at point
        trail1Name: 'Mesa Trail',
        trail2Name: 'Mesa Trail',
        expectedType: 'T-Intersection'
      },
      {
        name: 'Mesa Trail MultiPoint Intersection',
        trail1Id: '2ebd1682-27b1-4bc2-83ec-912405718e0b', // Mesa Trail (1056m)
        trail2Id: '192dd782-1b18-4255-bcf5-9f419f22d9c6', // Mesa Trail (3851m) - intersects at multiple points
        trail1Name: 'Mesa Trail',
        trail2Name: 'Mesa Trail',
        expectedType: 'MultiPoint-Intersection'
      }
      // Commented out for debugging
      // {
      //   name: 'Shanahan T-Intersection',
      //   trail1Id: '643fc095-8bbd-4310-9028-723484460fbd', // North Fork Shanahan Trail (COTREX)
      //   trail2Id: '67143e1d-83c5-4223-9c58-3c6f670fd7b2', // Shanahan Connector Trail (COTREX)
      //   trail1Name: 'North Fork Shanahan Trail',
      //   trail2Name: 'Shanahan Connector Trail',
      //   expectedType: 'T-Intersection'
      // },
      // {
      //   name: 'South Fork Shanahan T-Intersection',
      //   trail1Id: '70c28016-fd07-459c-85b5-87e196b766d5', // South Fork Shanahan Trail (COTREX)
      //   trail2Id: '3349f8aa-66c9-4b75-8e3a-d72e3d0c70fc', // Mesa Trail (COTREX)
      //   trail1Name: 'South Fork Shanahan Trail',
      //   trail2Name: 'Mesa Trail',
      //   expectedType: 'T-Intersection'
      // },
      {
        name: 'Skunk Canyon Y-Intersection',
        trail1Id: '44e10188-02f8-4074-afee-86c4bf65c47b', // Skunk Canyon Spur Trail (COTREX)
        trail2Id: '8d5477b8-20aa-4446-9d0a-5f236e5be27c', // Kohler Spur Trail (COTREX)
        trail1Name: 'Skunk Canyon Spur Trail',
        trail2Name: 'Kohler Spur Trail',
        expectedType: 'Y-Intersection'
      },
      {
        name: 'Mesa Trail T-Intersection',
        trail1Id: '2ebd1682-27b1-4bc2-83ec-912405718e0b', // Mesa Trail (1056m)
        trail2Id: '0332db1f-7a0c-42cd-9c11-41ae569a8aa6', // Mesa Trail (633m) - intersects at point
        trail1Name: 'Mesa Trail',
        trail2Name: 'Mesa Trail',
        expectedType: 'T-Intersection'
      },
      {
        name: 'Mesa Trail MultiPoint Intersection',
        trail1Id: '2ebd1682-27b1-4bc2-83ec-912405718e0b', // Mesa Trail (1056m)
        trail2Id: '192dd782-1b18-4255-bcf5-9f419f22d9c6', // Mesa Trail (3851m) - intersects at multiple points
        trail1Name: 'Mesa Trail',
        trail2Name: 'Mesa Trail',
        expectedType: 'MultiPoint-Intersection'
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
  await pgClient.query('DROP TABLE IF EXISTS temp_all_test_fixed');
  await pgClient.query(`
    CREATE TABLE temp_all_test_fixed AS 
    SELECT *, ST_Length(geometry::geography) as length_meters 
    FROM trails 
    WHERE app_uuid IN ($1, $2)
  `, [trail1.app_uuid, trail2.app_uuid]);
  
  try {
    const tolerance = intersectionInfo.tolerance;
    
    console.log(`     Step 1: Rounding coordinates...`);
    await pgClient.query(`
      UPDATE temp_all_test_fixed 
      SET geometry = ST_SnapToGrid(geometry, 0.000001)
    `);
    
    console.log(`     Step 2: Snapping trails with tolerance ${tolerance}...`);
    
    // Snap trails to each other
    await pgClient.query(`
      UPDATE temp_all_test_fixed 
      SET geometry = ST_Snap(
        geometry, 
        (SELECT geometry FROM temp_all_test_fixed WHERE app_uuid = $1), 
        $2
      )
      WHERE app_uuid = $3
    `, [trail2.app_uuid, tolerance, trail1.app_uuid]);
    
    await pgClient.query(`
      UPDATE temp_all_test_fixed 
      SET geometry = ST_Snap(
        geometry, 
        (SELECT geometry FROM temp_all_test_fixed WHERE app_uuid = $1), 
        $2
      )
      WHERE app_uuid = $3
    `, [trail1.app_uuid, tolerance, trail2.app_uuid]);
    
    // Check what the snapped geometries look like
    const snappedCheck = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_m,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM temp_all_test_fixed
      ORDER BY name
    `);
    
    console.log(`       After snapping:`);
    snappedCheck.rows.forEach(row => {
      console.log(`         ${row.name}: ${row.num_points || 'null'} points, ${row.length_m ? row.length_m.toFixed(1) : 'null'}m`);
      console.log(`           Start: ${row.start_point || 'null'}, End: ${row.end_point || 'null'}`);
    });
    
    console.log(`     Step 3: Finding intersection points...`);
    
    // First, let's see what the intersection actually is in the temp table
    const tempIntersectionCheck = await pgClient.query(`
      WITH trail1 AS (
        SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $1
      ),
      trail2 AS (
        SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $2
      ),
      intersection AS (
        SELECT ST_Intersection(trail1.geom, trail2.geom) as geom
        FROM trail1, trail2
      )
      SELECT 
        ST_GeometryType(intersection.geom) as intersection_type,
        ST_NumGeometries(intersection.geom) as intersection_count,
        ST_AsText(intersection.geom) as intersection_text,
        ST_IsEmpty(intersection.geom) as is_empty
      FROM intersection
    `, [trail1.app_uuid, trail2.app_uuid]);
    
    const tempIntersection = tempIntersectionCheck.rows[0];
    console.log(`       Temp table intersection: type=${tempIntersection.intersection_type}, count=${tempIntersection.intersection_count}, empty=${tempIntersection.is_empty}`);
    console.log(`       Temp table intersection text: ${tempIntersection.intersection_text}`);
    
    // Improved intersection point extraction
    let intersectionPoints = [];
    
    if (tempIntersection.intersection_type === 'ST_MultiPoint') {
      // Extract individual points from MultiPoint using ST_Dump
      const pointsResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $2
        ),
        intersection AS (
          SELECT ST_Intersection(trail1.geom, trail2.geom) as geom
          FROM trail1, trail2
        ),
        dumped AS (
          SELECT (ST_Dump(intersection.geom)).geom as point_geom,
                 (ST_Dump(intersection.geom)).path as point_path
          FROM intersection
        )
        SELECT 
          point_geom,
          point_path,
          ST_GeometryType(point_geom) as geom_type,
          ST_AsText(point_geom) as geom_text
        FROM dumped
      `, [trail1.app_uuid, trail2.app_uuid]);
      
      console.log(`       Raw ST_Dump results: ${pointsResult.rows.length} rows`);
      pointsResult.rows.forEach((row, index) => {
        console.log(`         Row ${index}: type=${row.geom_type}, path=${row.point_path}, text=${row.geom_text}`);
      });
      
      intersectionPoints = pointsResult.rows.filter(row => 
        row.point_geom && row.geom_type === 'ST_Point'
      );
      console.log(`       Found ${intersectionPoints.length} intersection points from MultiPoint`);
      
    } else if (tempIntersection.intersection_type === 'ST_Point') {
      // Single point intersection
      const pointResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $2
        )
        SELECT ST_Intersection(trail1.geom, trail2.geom) as point_geom
        FROM trail1, trail2
      `, [trail1.app_uuid, trail2.app_uuid]);
      
      intersectionPoints = [{ point_geom: pointResult.rows[0].point_geom, point_path: [1] }];
      console.log(`       Found 1 intersection point`);
      
    } else if (tempIntersection.intersection_type === 'ST_LineString') {
      // Line intersection - extract endpoints and sample points
      const lineResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $2
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
        UNION ALL
        SELECT 
          ST_PointN(intersection.geom, 1) as point_geom
        FROM intersection
        WHERE ST_NumPoints(intersection.geom) > 1
      `, [trail1.app_uuid, trail2.app_uuid]);
      
      intersectionPoints = lineResult.rows.map((row, index) => ({ 
        point_geom: row.point_geom, 
        point_path: [index + 1] 
      }));
      console.log(`       Found ${intersectionPoints.length} intersection points from LineString`);
      
    } else if (tempIntersection.intersection_type === 'ST_MultiLineString') {
      // MultiLineString intersection - extract endpoints from each line
      const multiLineResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $2
        ),
        intersection AS (
          SELECT ST_Intersection(trail1.geom, trail2.geom) as geom
          FROM trail1, trail2
        ),
        dumped AS (
          SELECT (ST_Dump(intersection.geom)).geom as line_geom,
                 (ST_Dump(intersection.geom)).path as line_path
          FROM intersection
        )
        SELECT 
          ST_StartPoint(line_geom) as point_geom
        FROM dumped
        WHERE ST_GeometryType(line_geom) = 'ST_LineString'
        UNION ALL
        SELECT 
          ST_EndPoint(line_geom) as point_geom
        FROM dumped
        WHERE ST_GeometryType(line_geom) = 'ST_LineString'
      `, [trail1.app_uuid, trail2.app_uuid]);
      
      intersectionPoints = multiLineResult.rows.map((row, index) => ({ 
        point_geom: row.point_geom, 
        point_path: [index + 1] 
      }));
      console.log(`       Found ${intersectionPoints.length} intersection points from MultiLineString`);
      
    } else if (tempIntersection.intersection_type === 'ST_GeometryCollection') {
      // Complex intersection - extract all point geometries
      const complexResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $2
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
      
      intersectionPoints = complexResult.rows.filter(row => 
        row.point_geom && row.point_geom.type === 'Point'
      );
      console.log(`       Found ${intersectionPoints.length} intersection points from GeometryCollection`);
    }
    
    if (intersectionPoints.length > 0) {
      console.log(`     Step 4: Splitting trails at intersection points...`);
      
      // Get intersection point from the temporary table (after snapping)
      const tempIntersectionResult = await pgClient.query(`
        WITH trail1 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $1
        ),
        trail2 AS (
          SELECT geometry as geom FROM temp_all_test_fixed WHERE app_uuid = $2
        )
        SELECT ST_Intersection(trail1.geom, trail2.geom) as intersection_point
        FROM trail1, trail2
      `, [trail1.app_uuid, trail2.app_uuid]);
      
      const tempIntersectionPoint = tempIntersectionResult.rows[0].intersection_point;
      console.log(`       Using intersection point from temp table: ${tempIntersectionPoint ? 'Found' : 'NULL'}`);
      if (tempIntersectionPoint) {
        console.log(`       Intersection point type: ${tempIntersectionPoint.type || 'unknown'}`);
        console.log(`       Intersection point WKT: ${tempIntersectionPoint.wkt || 'unknown'}`);
      }
      
      // Split both trails at the intersection point
      await splitTrailAtIntersectionPoint(trail1.app_uuid, tempIntersectionPoint, 1);
      await splitTrailAtIntersectionPoint(trail2.app_uuid, tempIntersectionPoint, 1);
      
      // Count results
      const finalCount = await pgClient.query(`
        SELECT COUNT(*) as count, 
               COUNT(CASE WHEN name LIKE '%(Segment %' THEN 1 END) as segments
        FROM temp_all_test_fixed
      `);
      
      console.log(`     ✅ Final result: ${finalCount.rows[0].count} trails, ${finalCount.rows[0].segments} segments`);
      
      return {
        success: finalCount.rows[0].segments > 0,
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
    await pgClient.query('DROP TABLE IF EXISTS temp_all_test_fixed');
  }
}

async function splitTrailAtIntersectionPoint(trailId, intersectionPoint, pointIndex) {
  try {
    console.log(`         Attempting to split trail ${trailId} at point ${pointIndex}`);
    
    const splitResult = await pgClient.query(`
      WITH trail_split AS (
        SELECT ST_Split(
          (SELECT geometry FROM temp_all_test_fixed WHERE app_uuid = $1),
          ST_Buffer($2::geometry, 0.000001)
        ) as split_geom
      )
      SELECT 
        ST_NumGeometries(split_geom) as num_segments,
        split_geom
      FROM trail_split
    `, [trailId, intersectionPoint]);
    
    const split = splitResult.rows[0];
    console.log(`         Split result: ${split.num_segments} segments`);
    
    if (split.num_segments > 1) {
      console.log(`         Trail ${trailId}: Split into ${split.num_segments} segments`);
      console.log(`         Split geometry type: ${split.split_geom.type}`);
      
      // Get original trail data
      const originalTrail = await pgClient.query(`
        SELECT * FROM temp_all_test_fixed WHERE app_uuid = $1
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
                INSERT INTO temp_all_test_fixed (
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
              console.log(`           Inserted segment ${i}: ${length.rows[0].length_m.toFixed(1)}m`);
            } else {
              console.log(`           Skipped short segment ${i}: ${length.rows[0].length_m.toFixed(1)}m`);
            }
          }
        }
        
        // Delete original trail
        await pgClient.query(`
          DELETE FROM temp_all_test_fixed WHERE app_uuid = $1
        `, [trailId]);
      }
    }
  } catch (error) {
    console.log(`         ❌ Failed to split trail ${trailId}: ${error.message}`);
  }
}

testAllIntersectionCasesFixed();
