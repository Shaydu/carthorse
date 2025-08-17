const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function testRobustSplitting() {
  try {
    console.log('🔍 Testing Robust Splitting (working prototype approach for all cases)...');
    
    // All our test cases - using app_uuid for precise lookup
    const testCases = [
      {
        name: 'Enchanted T-Intersection',
        trail1Uuid: '67fa5621-d393-4953-ba82-f79ad67cdaf5', // Enchanted Mesa Trail (longest)
        trail2Uuid: 'c7c8ecd5-42c8-4947-b02e-25dc832e2f1e', // Enchanted-Kohler Spur Trail
        expectedType: 'T-Intersection'
      },
      {
        name: 'South Fork Shanahan T-Intersection',
        trail1Uuid: '70c28016-fd07-459c-85b5-87e196b766d5', // South Fork Shanahan Trail
        trail2Uuid: '42b9df47-d726-4a16-b0d8-f2a4f9200eb0', // Mesa Trail
        expectedType: 'T-Intersection'
      },
      {
        name: 'Shanahan T-Intersection',
        trail1Uuid: '643fc095-8bbd-4310-9028-723484460fbd', // North Fork Shanahan Trail
        trail2Uuid: '67143e1d-83c5-4223-9c58-3c6f670fd7b2', // Shanahan Connector Trail
        expectedType: 'T-Intersection'
      },
      {
        name: 'Skunk Canyon Y-Intersection',
        trail1Uuid: '44e10188-02f8-4074-afee-86c4bf65c47b', // Skunk Canyon Spur Trail
        trail2Uuid: '8d5477b8-20aa-4446-9d0a-5f236e5be27c', // Kohler Spur Trail
        expectedType: 'Y-Intersection'
      },
      {
        name: 'NCAR T-Intersection',
        trail1Uuid: '60145864-ab31-42d8-8278-c33758971c62', // NCAR Trail (longest)
        trail2Uuid: 'df6ad642-ba4e-4a0c-8952-648d9dcefe4d', // NCAR Water Tank Road
        expectedType: 'T-Intersection'
      }
    ];
    
    const results = [];
    const allSplitSegments = []; // Collect all split segments for export
    
    for (const testCase of testCases) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 Testing: ${testCase.name}`);
      console.log(`${'='.repeat(80)}`);
      
      const result = await testSingleCase(testCase);
      results.push(result);
      
      // Collect split segments if successful
      if (result.success && result.segments) {
        allSplitSegments.push(...result.segments);
      }
    }
    
    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('📋 SUMMARY OF ALL TEST CASES');
    console.log(`${'='.repeat(80)}`);
    
    let successCount = 0;
    for (const result of results) {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.name}: ${result.segmentsCreated} segments created`);
      if (result.success) successCount++;
    }
    
    console.log(`\n🎯 Overall Success Rate: ${successCount}/${results.length} (${(successCount/results.length*100).toFixed(1)}%)`);
    
    // Export GeoJSON of all split segments
    if (allSplitSegments.length > 0) {
      console.log(`\n📤 Exporting ${allSplitSegments.length} split segments to GeoJSON...`);
      await exportSplitSegmentsToGeoJSON(allSplitSegments);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

async function testSingleCase(testCase) {
  try {
    // Build the query using app_uuid for precise lookup
    let query, params;
    
    if (testCase.trail1Uuid && testCase.trail2Uuid) {
      console.log(`🔍 Testing: ${testCase.trail1Uuid} ↔ ${testCase.trail2Uuid}`);
      query = `
        SELECT app_uuid, name, ST_AsText(geometry) as geom_text, ST_SRID(geometry) as srid
        FROM public.trails 
        WHERE app_uuid IN ($1, $2) AND source = 'cotrex'
        ORDER BY name
      `;
      params = [testCase.trail1Uuid, testCase.trail2Uuid];
    } else {
      console.log(`❌ Invalid test case: missing trail UUIDs`);
      return { success: false, segmentsCreated: 0, error: 'Invalid test case' };
    }
    
    // Get trail data (COTREX only) - preserve SRID
    const trailsResult = await pgClient.query(query, params);
    
    if (trailsResult.rows.length < 2) {
      console.log(`❌ Need both trails, found: ${trailsResult.rows.length}`);
      return { success: false, segmentsCreated: 0, error: 'Trails not found' };
    }
    
    const trail1 = trailsResult.rows[0];
    const trail2 = trailsResult.rows[1];
    
    console.log(`   Trail 1: ${trail1.name} (${trail1.app_uuid}) - SRID: ${trail1.srid}`);
    console.log(`   Trail 2: ${trail2.name} (${trail2.app_uuid}) - SRID: ${trail2.srid}`);
    
    // Step 1: Round coordinates to 6 decimal places (exactly like working prototype)
    console.log(`   Step 1: Rounding coordinates...`);
    const roundedResult = await pgClient.query(`
      WITH rounded_trails AS (
        SELECT 
          ST_GeomFromText(
            'SRID=${trail1.srid};LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText('SRID=${trail1.srid};${trail1.geom_text}'), pt1)
            ) || 
            ')'
          ) as trail1_rounded,
          ST_GeomFromText(
            'SRID=${trail2.srid};LINESTRING(' || 
            string_agg(
              ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
              ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText('SRID=${trail2.srid};${trail2.geom_text}'), pt2)
            ) || 
            ')'
          ) as trail2_rounded
        FROM 
          (SELECT (ST_DumpPoints(ST_GeomFromText('SRID=${trail1.srid};${trail1.geom_text}'))).geom AS pt1) as points1,
          (SELECT (ST_DumpPoints(ST_GeomFromText('SRID=${trail2.srid};${trail2.geom_text}'))).geom AS pt2) as points2
      )
      SELECT trail1_rounded, trail2_rounded FROM rounded_trails
    `);
    
    if (roundedResult.rows.length === 0) {
      console.log(`   ❌ Failed to round coordinates`);
      return { success: false, segmentsCreated: 0, error: 'Coordinate rounding failed' };
    }
    
    const trail1Rounded = roundedResult.rows[0].trail1_rounded;
    const trail2Rounded = roundedResult.rows[0].trail2_rounded;
    
    // Step 2: Try multiple snapping tolerances (like working prototype but more robust)
    console.log(`   Step 2: Snapping trails...`);
    let trail1Snapped, trail2Snapped;
    let snapTolerance = 1e-6; // Start with working prototype tolerance
    
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const snappedResult = await pgClient.query(`
          SELECT 
            ST_Snap($1::geometry, $2::geometry, $3) AS trail1_snapped,
            ST_Snap($2::geometry, $1::geometry, $3) AS trail2_snapped
        `, [trail1Rounded, trail2Rounded, snapTolerance]);
        
        trail1Snapped = snappedResult.rows[0].trail1_snapped;
        trail2Snapped = snappedResult.rows[0].trail2_snapped;
        
        console.log(`     ✅ Snapped with tolerance ${snapTolerance}`);
        break;
      } catch (error) {
        console.log(`     ⚠️  Snapping with tolerance ${snapTolerance} failed, trying next...`);
        snapTolerance *= 10; // Try larger tolerance
      }
    }
    
    if (!trail1Snapped || !trail2Snapped) {
      console.log(`   ❌ Failed to snap trails`);
      return { success: false, segmentsCreated: 0, error: 'Snapping failed' };
    }
    
    // Step 3: Find actual intersections using ST_Intersection (like working prototype)
    console.log(`   Step 3: Finding actual intersections...`);
    
    // Use ST_Intersection to find actual intersection points (like working prototype)
    const intersectionResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
    `, [trail1Snapped, trail2Snapped]);
    
    console.log(`     🔍 Found ${intersectionResult.rows.length} intersection(s)`);
    
    if (intersectionResult.rows.length === 0) {
      console.log(`     ❌ No intersections found - trails don't actually intersect`);
      return { success: false, segmentsCreated: 0, error: 'No intersections found', name: testCase.name };
    }
    
    // Step 4: Extend visitor trail to touch visited trail and split there
    console.log(`   Step 4: Extending visitor trail to touch visited trail...`);
    let totalSegments = 0;
    const splitSegments = [];
    
    // Determine which trail is the visitor vs visited
    // Check distance from BOTH endpoints of each trail to the other trail's geometry
    const trail1StartToTrail2 = await pgClient.query(`
      SELECT ST_Distance(ST_StartPoint($1::geometry), $2::geometry) as distance_m
    `, [trail1Snapped, trail2Snapped]);
    
    const trail1EndToTrail2 = await pgClient.query(`
      SELECT ST_Distance(ST_EndPoint($1::geometry), $2::geometry) as distance_m
    `, [trail1Snapped, trail2Snapped]);
    
    const trail2StartToTrail1 = await pgClient.query(`
      SELECT ST_Distance(ST_StartPoint($1::geometry), $2::geometry) as distance_m
    `, [trail2Snapped, trail1Snapped]);
    
    const trail2EndToTrail1 = await pgClient.query(`
      SELECT ST_Distance(ST_EndPoint($1::geometry), $2::geometry) as distance_m
    `, [trail2Snapped, trail1Snapped]);
    
    const trail1MinDistance = Math.min(trail1StartToTrail2.rows[0].distance_m, trail1EndToTrail2.rows[0].distance_m);
    const trail2MinDistance = Math.min(trail2StartToTrail1.rows[0].distance_m, trail2EndToTrail1.rows[0].distance_m);
    
    console.log(`     📍 ${trail1.name} closest endpoint to ${trail2.name}: ${trail1MinDistance.toFixed(2)}m`);
    console.log(`     📍 ${trail2.name} closest endpoint to ${trail1.name}: ${trail2MinDistance.toFixed(2)}m`);
    
    // Determine which trail is the visitor (has closest endpoint to other trail)
    const trail1IsVisitor = trail1MinDistance < trail2MinDistance;
    const visitedTrail = trail1IsVisitor ? trail2Snapped : trail1Snapped;
    const visitorTrail = trail1IsVisitor ? trail1Snapped : trail2Snapped;
    const visitedTrailName = trail1IsVisitor ? trail2.name : trail1.name;
    const visitorTrailName = trail1IsVisitor ? trail1.name : trail2.name;
    
    // Get the CLOSEST endpoint of the visitor trail to the visited trail
    const visitorStartToVisited = await pgClient.query(`
      SELECT ST_Distance(ST_StartPoint($1::geometry), $2::geometry) as distance_m
    `, [visitorTrail, visitedTrail]);
    
    const visitorEndToVisited = await pgClient.query(`
      SELECT ST_Distance(ST_EndPoint($1::geometry), $2::geometry) as distance_m
    `, [visitorTrail, visitedTrail]);
    
    const startDistance = visitorStartToVisited.rows[0].distance_m;
    const endDistance = visitorEndToVisited.rows[0].distance_m;
    
    console.log(`     📍 ${visitorTrailName} start endpoint to ${visitedTrailName}: ${startDistance.toFixed(2)}m`);
    console.log(`     📍 ${visitorTrailName} end endpoint to ${visitedTrailName}: ${endDistance.toFixed(2)}m`);
    
    // Use the CLOSEST endpoint (not the farthest)
    const useStartEndpoint = startDistance < endDistance;
    const visitorEndpoint = useStartEndpoint ? 
      await pgClient.query(`SELECT ST_StartPoint($1) as endpoint`, [visitorTrail]).then(r => r.rows[0].endpoint) :
      await pgClient.query(`SELECT ST_EndPoint($1) as endpoint`, [visitorTrail]).then(r => r.rows[0].endpoint);
    
    console.log(`     🎯 Using ${useStartEndpoint ? 'start' : 'end'} endpoint of ${visitorTrailName} (closest to ${visitedTrailName})`);
    
    console.log(`     🛤️  Visited trail (to be split): ${visitedTrailName}`);
    console.log(`     🛤️  Visitor trail (to be extended): ${visitorTrailName}`);
    
    // Find the closest point on the visited trail to the visitor endpoint
    const closestPointResult = await pgClient.query(`
      SELECT ST_ClosestPoint($1::geometry, $2::geometry) as closest_point
    `, [visitedTrail, visitorEndpoint]);
    
    const closestPoint = closestPointResult.rows[0].closest_point;
    
    // Check if the visitor endpoint is already very close to the visited trail
    const endpointToTrailDistance = await pgClient.query(`
      SELECT ST_Distance($1::geometry, $2::geometry) as distance_m
    `, [visitorEndpoint, visitedTrail]);
    
    const distance = endpointToTrailDistance.rows[0].distance_m;
    console.log(`     📏 Distance from visitor endpoint to visited trail: ${distance.toFixed(3)}m`);
    
    let splitPoint;
    let extendedVisitorLine;
    
    if (distance < 0.001) { // If already very close (less than 1mm)
      console.log(`     ✅ Visitor endpoint already very close to visited trail, using closest point`);
      splitPoint = closestPoint;
      // Create a tiny extension line for visualization
      const tinyExtensionResult = await pgClient.query(`
        SELECT ST_MakeLine($1::geometry, $2::geometry) as extended_line
      `, [visitorEndpoint, closestPoint]);
      extendedVisitorLine = tinyExtensionResult.rows[0].extended_line;
    } else {
      // Create a line from visitor endpoint to the closest point on visited trail
      const extendedVisitorLineResult = await pgClient.query(`
        SELECT ST_MakeLine($1::geometry, $2::geometry) as extended_line
      `, [visitorEndpoint, closestPoint]);
      
      extendedVisitorLine = extendedVisitorLineResult.rows[0].extended_line;
      
      // Find where the extended visitor line intersects the visited trail
      const extendedIntersectionResult = await pgClient.query(`
        SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
      `, [visitedTrail, extendedVisitorLine]);
      
      if (extendedIntersectionResult.rows.length === 0) {
        console.log(`     ❌ Extended visitor trail doesn't intersect visited trail`);
        return { success: false, segmentsCreated: 0, error: 'Extended trail doesn\'t intersect', name: testCase.name };
      }
      
      // Use the first intersection point (should be the closest point)
      splitPoint = extendedIntersectionResult.rows[0].pt;
    }
    console.log(`     ✅ Extended intersection point: ${splitPoint}`);
    
    // Split visited trail at this intersection point
    const splitVisitedTrailResult = await pgClient.query(`
      SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
    `, [visitedTrail, splitPoint]);
    
    console.log(`     📏 ${visitedTrailName} split into ${splitVisitedTrailResult.rows.length} segments`);
    totalSegments += splitVisitedTrailResult.rows.length;
    
    // Collect visited trail segments (filter out very small segments)
    for (let i = 0; i < splitVisitedTrailResult.rows.length; i++) {
      const segment = splitVisitedTrailResult.rows[i].segment;
      const length = await pgClient.query(`
        SELECT ST_Length($1::geography) as length_m
      `, [segment]);
      
      // Filter out segments shorter than 5 meters to avoid weird little segments
      if (length.rows[0].length_m > 5) {
        splitSegments.push({
          name: `${visitedTrailName} Segment ${i + 1}`,
          geometry: segment,
          length_m: length.rows[0].length_m,
          original_trail: 'visited_trail',
          segment_index: i + 1,
          source: 'split'
        });
      } else {
        console.log(`     ⚠️  Skipped small segment ${i + 1}: ${length.rows[0].length_m.toFixed(1)}m`);
      }
    }
    
    // Add the visitor trail as-is (don't split it)
    const visitorLength = await pgClient.query(`
      SELECT ST_Length($1::geography) as length_m
    `, [visitorTrail]);
    
    splitSegments.push({
      name: `${visitorTrailName} (Visitor)`,
      geometry: visitorTrail,
      length_m: visitorLength.rows[0].length_m,
      original_trail: 'visitor_trail',
      segment_index: 1,
      source: 'visitor'
    });
    
    console.log(`   ✅ Total segments created: ${totalSegments + 1}`); // +1 for visitor trail
    
    return { 
      success: true, 
      segmentsCreated: totalSegments + 1,
      segments: splitSegments,
      name: testCase.name,
      intersectionCount: 1
    };
    

    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, segmentsCreated: 0, error: error.message, name: testCase.name };
  }
}

async function exportSplitSegmentsToGeoJSON(segments) {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Create GeoJSON structure
    const geojson = {
      type: 'FeatureCollection',
      features: []
    };
    
    // Convert each segment to GeoJSON feature
    for (const segment of segments) {
      // Convert PostGIS geometry to GeoJSON
      const geomResult = await pgClient.query(`
        SELECT ST_AsGeoJSON($1) as geojson
      `, [segment.geometry]);
      
      const geometry = JSON.parse(geomResult.rows[0].geojson);
      
      const feature = {
        type: 'Feature',
        properties: {
          name: segment.name,
          original_trail: segment.original_trail,
          segment_index: segment.segment_index,
          length_m: Math.round(segment.length_m),
          length_km: (segment.length_m / 1000).toFixed(3)
        },
        geometry: geometry
      };
      
      geojson.features.push(feature);
    }
    
    // Write to file
    const outputPath = path.join(__dirname, 'test-output', 'robust-splitting-results.geojson');
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ GeoJSON exported to: ${outputPath}`);
    console.log(`📊 Features: ${geojson.features.length}`);
    
    // Also export original trails for comparison
    await exportOriginalTrailsForComparison();
    
  } catch (error) {
    console.error('❌ Error exporting GeoJSON:', error);
  }
}

async function exportOriginalTrailsForComparison() {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Get all original trails used in testing (COTREX only)
    const originalTrailsResult = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsGeoJSON(geometry) as geojson,
        ST_Length(geometry::geography) as length_m
      FROM public.trails 
      WHERE app_uuid IN (
        '4cda78f2-3a86-4e56-9300-c62480ca11fa',
        'a610885e-8cf0-48bd-9b47-2217e2055101',
        '67fa5621-d393-4953-ba82-f79ad67cdaf5',
        'c7c8ecd5-42c8-4947-b02e-25dc832e2f1e',
        '643fc095-8bbd-4310-9028-723484460fbd',
        '67143e1d-83c5-4223-9c58-3c6f670fd7b2',
        '70c28016-fd07-459c-85b5-87e196b766d5',
        '3349f8aa-66c9-4b75-8e3a-d72e3d0c70fc',
        '44e10188-02f8-4074-afee-86c4bf65c47b',
        '8d5477b8-20aa-4446-9d0a-5f236e5be27c'
      ) AND source = 'cotrex'
      ORDER BY name
    `);
    
    const geojson = {
      type: 'FeatureCollection',
      features: []
    };
    
    for (const trail of originalTrailsResult.rows) {
      const feature = {
        type: 'Feature',
        properties: {
          name: trail.name,
          app_uuid: trail.app_uuid,
          length_m: Math.round(trail.length_m),
          length_km: (trail.length_m / 1000).toFixed(3),
          type: 'original'
        },
        geometry: JSON.parse(trail.geojson)
      };
      
      geojson.features.push(feature);
    }
    
    const outputPath = path.join(__dirname, 'test-output', 'original-trails-for-comparison.geojson');
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    
    console.log(`✅ Original trails exported to: ${outputPath}`);
    console.log(`📊 Original trails: ${geojson.features.length}`);
    
  } catch (error) {
    console.error('❌ Error exporting original trails:', error);
  }
}

testRobustSplitting();
