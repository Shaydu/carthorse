const { Pool } = require('pg');

const pgClient = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: ''
});

async function debugNonIntersectingTrails() {
  try {
    console.log('🔍 Debugging Non-Intersecting Trails...');
    
    // The two failing cases
    const failingCases = [
      {
        name: 'Enchanted Problem Case',
        trail1Id: '67fa5621-d393-4953-ba82-f79ad67cdaf5',
        trail2Id: 'c7c8ecd5-42c8-4947-b02e-25dc832e2f1e'
      },
      {
        name: 'South Fork Shanahan Case',
        trail1Id: '70c28016-fd07-459c-85b5-87e196b766d5',
        trail2Id: '3349f8aa-66c9-4b75-8e3a-d72e3d0c70fc'
      }
    ];
    
    for (const testCase of failingCases) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 Debugging: ${testCase.name}`);
      console.log(`${'='.repeat(80)}`);
      
      // Get trail data
      const trailsResult = await pgClient.query(`
        SELECT 
          app_uuid, 
          name, 
          ST_AsText(geometry) as geom_text,
          ST_Length(geometry::geography) as length_m,
          ST_NumPoints(geometry) as num_points,
          ST_X(ST_StartPoint(geometry)) as start_lng,
          ST_Y(ST_StartPoint(geometry)) as start_lat,
          ST_X(ST_EndPoint(geometry)) as end_lng,
          ST_Y(ST_EndPoint(geometry)) as end_lat
        FROM public.trails 
        WHERE app_uuid IN ($1, $2)
        ORDER BY name
      `, [testCase.trail1Id, testCase.trail2Id]);
      
      if (trailsResult.rows.length < 2) {
        console.log(`❌ Need both trails, found: ${trailsResult.rows.length}`);
        continue;
      }
      
      const trail1 = trailsResult.rows[0];
      const trail2 = trailsResult.rows[1];
      
      console.log(`   Trail 1: ${trail1.name} (${trail1.app_uuid})`);
      console.log(`     Length: ${trail1.length_m.toFixed(1)}m, Points: ${trail1.num_points}`);
      console.log(`     Start: (${trail1.start_lng.toFixed(6)}, ${trail1.start_lat.toFixed(6)})`);
      console.log(`     End: (${trail1.end_lng.toFixed(6)}, ${trail1.end_lat.toFixed(6)})`);
      
      console.log(`   Trail 2: ${trail2.name} (${trail2.app_uuid})`);
      console.log(`     Length: ${trail2.length_m.toFixed(1)}m, Points: ${trail2.num_points}`);
      console.log(`     Start: (${trail2.start_lng.toFixed(6)}, ${trail2.start_lat.toFixed(6)})`);
      console.log(`     End: (${trail2.end_lng.toFixed(6)}, ${trail2.end_lat.toFixed(6)})`);
      
      // Check if trails are close to each other
      const distanceResult = await pgClient.query(`
        SELECT 
          ST_Distance(ST_GeomFromText($1), ST_GeomFromText($2)) as distance_m,
          ST_DWithin(ST_GeomFromText($1), ST_GeomFromText($2), 0.001) as within_1km,
          ST_DWithin(ST_GeomFromText($1), ST_GeomFromText($2), 0.01) as within_10km
      `, [trail1.geom_text, trail2.geom_text]);
      
      const distance = distanceResult.rows[0];
      console.log(`   Distance between trails: ${distance.distance_m.toFixed(1)}m`);
      console.log(`   Within 1km: ${distance.within_1km}`);
      console.log(`   Within 10km: ${distance.within_10km}`);
      
      // Try different tolerances for intersection detection
      console.log(`   Testing intersection with different tolerances:`);
      const tolerances = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
      
      for (const tolerance of tolerances) {
        try {
          const intersectionResult = await pgClient.query(`
            SELECT 
              ST_IsEmpty(ST_Intersection(
                ST_Buffer(ST_GeomFromText($1), $3),
                ST_Buffer(ST_GeomFromText($2), $3)
              )) as is_empty
          `, [trail1.geom_text, trail2.geom_text, tolerance]);
          
          const isEmpty = intersectionResult.rows[0].is_empty;
          if (!isEmpty) {
            console.log(`     ✅ Tolerance ${tolerance}: Found intersection`);
          } else {
            console.log(`     ❌ Tolerance ${tolerance}: No intersection`);
          }
        } catch (error) {
          console.log(`     ❌ Tolerance ${tolerance}: Error - ${error.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugNonIntersectingTrails();
