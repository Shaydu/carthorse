const fs = require('fs');
const { Pool } = require('pg');

async function testSpecificYIntersection() {
  const pgClient = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    console.log('🔍 Testing Y-intersection between specific trails...');
    
    // Read the GeoJSON file
    const geojsonPath = 'test-output/boulder-holy-grail-bbox-layer1-trails.geojson';
    const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
    
    // Find the specific trails
    const southForkShanahan = geojsonData.features.find(f => 
      f.properties.id === 'c254aef5-207b-47d6-a7eb-bb8428c4d933'
    );
    
    const bluestemConnector = geojsonData.features.find(f => 
      f.properties.id === '8542d5e2-894f-4507-a499-f4acf4fce2e2'
    );
    
    if (!southForkShanahan) {
      console.log('❌ South Fork Shanahan Trail not found in GeoJSON');
      return;
    }
    
    if (!bluestemConnector) {
      console.log('❌ Bluestem Connector Trail not found in GeoJSON');
      return;
    }
    
    console.log('✅ Found both trails in GeoJSON:');
    console.log(`   South Fork Shanahan: ${southForkShanahan.properties.name} (${southForkShanahan.properties.length_km}km)`);
    console.log(`   Bluestem Connector: ${bluestemConnector.properties.name} (${bluestemConnector.properties.length_km}km)`);
    
    // Convert GeoJSON geometries to WKT for PostGIS analysis
    const southForkGeom = JSON.stringify(southForkShanahan.geometry);
    const bluestemGeom = JSON.stringify(bluestemConnector.geometry);
    
    // Test intersection using PostGIS
    const intersectionTest = await pgClient.query(`
      WITH trail_geometries AS (
        SELECT 
          'south_fork' as trail_id,
          'South Fork Shanahan Trail Segment 1' as trail_name,
          ST_GeomFromGeoJSON($1) as trail_geom
        UNION ALL
        SELECT 
          'bluestem' as trail_id,
          'Bluestem Connector Trail' as trail_name,
          ST_GeomFromGeoJSON($2) as trail_geom
      ),
      intersection_analysis AS (
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.trail_geom as trail1_geom,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.trail_geom as trail2_geom,
          ST_Intersection(t1.trail_geom, t2.trail_geom) as intersection_point,
          ST_StartPoint(t1.trail_geom) as trail1_start,
          ST_EndPoint(t1.trail_geom) as trail1_end,
          ST_StartPoint(t2.trail_geom) as trail2_start,
          ST_EndPoint(t2.trail_geom) as trail2_end
        FROM trail_geometries t1
        JOIN trail_geometries t2 ON t1.trail_id < t2.trail_id
        WHERE ST_Intersects(t1.trail_geom, t2.trail_geom)
      )
      SELECT 
        trail1_name,
        trail2_name,
        ST_AsText(intersection_point) as intersection_coords,
        ST_GeometryType(intersection_point) as intersection_type,
        ST_Distance(trail1_start, intersection_point) as trail1_start_dist,
        ST_Distance(trail1_end, intersection_point) as trail1_end_dist,
        ST_Distance(trail2_start, intersection_point) as trail2_start_dist,
        ST_Distance(trail2_end, intersection_point) as trail2_end_dist,
        LEAST(
          ST_Distance(trail1_start, intersection_point),
          ST_Distance(trail1_end, intersection_point)
        ) as trail1_min_dist_to_endpoint,
        LEAST(
          ST_Distance(trail2_start, intersection_point),
          ST_Distance(trail2_end, intersection_point)
        ) as trail2_min_dist_to_endpoint
      FROM intersection_analysis
    `, [southForkGeom, bluestemGeom]);
    
    if (intersectionTest.rows.length > 0) {
      console.log('\n🔍 Intersection Analysis Results:');
      intersectionTest.rows.forEach((row, index) => {
        console.log(`\n  Intersection ${index + 1}:`);
        console.log(`    Trails: ${row.trail1_name} ↔ ${row.trail2_name}`);
        console.log(`    Type: ${row.intersection_type}`);
        console.log(`    Coordinates: ${row.intersection_coords}`);
        console.log(`    Trail1 distances: start=${row.trail1_start_dist.toFixed(3)}m, end=${row.trail1_end_dist.toFixed(3)}m`);
        console.log(`    Trail2 distances: start=${row.trail2_start_dist.toFixed(3)}m, end=${row.trail2_end_dist.toFixed(3)}m`);
        console.log(`    Min distances to endpoints: Trail1=${row.trail1_min_dist_to_endpoint.toFixed(3)}m, Trail2=${row.trail2_min_dist_to_endpoint.toFixed(3)}m`);
        
        // Determine if this is a Y-intersection (midpoint intersection)
        const isYIntersection = row.trail1_min_dist_to_endpoint > 5.0 && row.trail2_min_dist_to_endpoint > 5.0;
        console.log(`    Y-Intersection: ${isYIntersection ? 'YES' : 'NO'}`);
        
        if (isYIntersection) {
          console.log('    🎯 This is a Y-intersection that needs splitting!');
        }
      });
    } else {
      console.log('\n❌ No intersections found between these trails');
    }
    
    // Also test with a smaller tolerance to see if there are near-intersections
    console.log('\n🔍 Testing for near-intersections (within 10m)...');
    
    const nearIntersectionTest = await pgClient.query(`
      WITH trail_geometries AS (
        SELECT 
          'south_fork' as trail_id,
          'South Fork Shanahan Trail Segment 1' as trail_name,
          ST_GeomFromGeoJSON($1) as trail_geom
        UNION ALL
        SELECT 
          'bluestem' as trail_id,
          'Bluestem Connector Trail' as trail_name,
          ST_GeomFromGeoJSON($2) as trail_geom
      )
      SELECT 
        t1.trail_name as trail1_name,
        t2.trail_name as trail2_name,
        ST_Distance(t1.trail_geom, t2.trail_geom) as distance_m
      FROM trail_geometries t1
      JOIN trail_geometries t2 ON t1.trail_id < t2.trail_id
      WHERE ST_DWithin(t1.trail_geom, t2.trail_geom, 10)
      ORDER BY ST_Distance(t1.trail_geom, t2.trail_geom)
    `, [southForkGeom, bluestemGeom]);
    
    if (nearIntersectionTest.rows.length > 0) {
      console.log('Near-intersections found:');
      nearIntersectionTest.rows.forEach(row => {
        console.log(`  ${row.trail1_name} ↔ ${row.trail2_name}: ${row.distance_m.toFixed(3)}m`);
      });
    } else {
      console.log('No near-intersections found within 10m');
    }

  } catch (error) {
    console.error('❌ Error testing specific Y-intersection:', error);
  } finally {
    await pgClient.end();
  }
}

testSpecificYIntersection();
