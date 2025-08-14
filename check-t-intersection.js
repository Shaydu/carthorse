const { Client } = require('pg');

async function checkTIntersection() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔍 Checking T-intersection between specific trails...\n');

    // Get the specific trails
    const trail1Uuid = 'f6be74a4-50bf-438c-b2e7-9eb0eaf6e5b0';
    const trail2Uuid = 'c46da730-c355-4b8b-b0c9-2a395c1239e9';

    // Also search for trails with similar names
    console.log('🔍 Searching for trails with similar names...');
    const similarTrailsResult = await client.query(`
      SELECT app_uuid, name, 
             ST_AsText(ST_StartPoint(geometry)) as start_point,
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE name ILIKE '%Big Bluestem%' OR name ILIKE '%South Boulder Creek%'
      ORDER BY name
    `);
    
    console.log(`Found ${similarTrailsResult.rows.length} trails with similar names:`);
    similarTrailsResult.rows.forEach(trail => {
      console.log(`   ${trail.app_uuid}: ${trail.name} (${trail.length_meters.toFixed(2)}m)`);
    });
    console.log('');

    console.log(`📍 Trail 1 UUID: ${trail1Uuid}`);
    console.log(`📍 Trail 2 UUID: ${trail2Uuid}\n`);

    // First check public schema
    console.log('🔍 Checking public schema...');
    let trail1Result = await client.query(`
      SELECT app_uuid, name, 
             ST_AsText(ST_StartPoint(geometry)) as start_point,
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_AsText(geometry) as geometry_text,
             ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE app_uuid = $1
    `, [trail1Uuid]);

    let trail2Result = await client.query(`
      SELECT app_uuid, name, 
             ST_AsText(ST_StartPoint(geometry)) as start_point,
             ST_AsText(ST_EndPoint(geometry)) as end_point,
             ST_AsText(geometry) as geometry_text,
             ST_Length(geometry::geography) as length_meters
      FROM public.trails 
      WHERE app_uuid = $1
    `, [trail2Uuid]);

    // If not found in public, check staging schemas
    if (trail1Result.rows.length === 0 || trail2Result.rows.length === 0) {
      console.log('🔍 Checking staging schemas...');
      
      // Get all staging schemas
      const stagingSchemasResult = await client.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'staging_%'
        ORDER BY schema_name DESC
        LIMIT 5
      `);
      
      for (const schema of stagingSchemasResult.rows) {
        const schemaName = schema.schema_name;
        console.log(`   Checking ${schemaName}...`);
        
        const t1Result = await client.query(`
          SELECT app_uuid, name, 
                 ST_AsText(ST_StartPoint(geometry)) as start_point,
                 ST_AsText(ST_EndPoint(geometry)) as end_point,
                 ST_AsText(geometry) as geometry_text,
                 ST_Length(geometry::geography) as length_meters
          FROM ${schemaName}.trails 
          WHERE app_uuid = $1
        `, [trail1Uuid]);
        
        const t2Result = await client.query(`
          SELECT app_uuid, name, 
                 ST_AsText(ST_StartPoint(geometry)) as start_point,
                 ST_AsText(ST_EndPoint(geometry)) as end_point,
                 ST_AsText(geometry) as geometry_text,
                 ST_Length(geometry::geography) as length_meters
          FROM ${schemaName}.trails 
          WHERE app_uuid = $1
        `, [trail2Uuid]);
        
        if (t1Result.rows.length > 0 && t2Result.rows.length > 0) {
          console.log(`   ✅ Found both trails in ${schemaName}`);
          trail1Result = t1Result;
          trail2Result = t2Result;
          break;
        }
      }
    }

    if (trail1Result.rows.length === 0) {
      console.log('❌ Trail 1 not found in database');
      return;
    }

    if (trail2Result.rows.length === 0) {
      console.log('❌ Trail 2 not found in database');
      return;
    }

    const trail1 = trail1Result.rows[0];
    const trail2 = trail2Result.rows[0];

    console.log(`📍 Trail 1: ${trail1.name}`);
    console.log(`   Start: ${trail1.start_point}`);
    console.log(`   End: ${trail1.end_point}`);
    console.log(`   Length: ${trail1.length_meters.toFixed(2)}m`);

    console.log(`\n📍 Trail 2: ${trail2.name}`);
    console.log(`   Start: ${trail2.start_point}`);
    console.log(`   End: ${trail2.end_point}`);
    console.log(`   Length: ${trail2.length_meters.toFixed(2)}m`);

    // Check for true geometric intersection
    console.log('\n🔍 Checking for true geometric intersection...');
    const intersectionResult = await client.query(`
      SELECT 
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_Intersects(t1.geometry, t2.geometry) as intersects
      FROM public.trails t1, public.trails t2
      WHERE t1.app_uuid = $1 AND t2.app_uuid = $2
    `, [trail1Uuid, trail2Uuid]);

    console.log(`   Intersects: ${intersectionResult.rows[0].intersects}`);
    console.log(`   Intersection type: ${intersectionResult.rows[0].intersection_type}`);
    if (intersectionResult.rows[0].intersection_point) {
      console.log(`   Intersection point: ${intersectionResult.rows[0].intersection_point}`);
    }

    // Check for T-intersection (endpoint near trail)
    console.log('\n🔍 Checking for T-intersection...');
    const tIntersectionResult = await client.query(`
      SELECT 
        -- Trail 1 start point near Trail 2
        ST_DWithin(ST_StartPoint(t1.geometry), t2.geometry, 0.0001) as t1_start_near_t2,
        ST_Distance(ST_StartPoint(t1.geometry), t2.geometry) as t1_start_distance,
        
        -- Trail 1 end point near Trail 2
        ST_DWithin(ST_EndPoint(t1.geometry), t2.geometry, 0.0001) as t1_end_near_t2,
        ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) as t1_end_distance,
        
        -- Trail 2 start point near Trail 1
        ST_DWithin(ST_StartPoint(t2.geometry), t1.geometry, 0.0001) as t2_start_near_t1,
        ST_Distance(ST_StartPoint(t2.geometry), t1.geometry) as t2_start_distance,
        
        -- Trail 2 end point near Trail 1
        ST_DWithin(ST_EndPoint(t2.geometry), t1.geometry, 0.0001) as t2_end_near_t1,
        ST_Distance(ST_EndPoint(t2.geometry), t1.geometry) as t2_end_distance
      FROM public.trails t1, public.trails t2
      WHERE t1.app_uuid = $1 AND t2.app_uuid = $2
    `, [trail1Uuid, trail2Uuid]);

    const tResult = tIntersectionResult.rows[0];
    console.log(`   T1 start near T2: ${tResult.t1_start_near_t2} (${(tResult.t1_start_distance * 111000).toFixed(2)}m)`);
    console.log(`   T1 end near T2: ${tResult.t1_end_near_t2} (${(tResult.t1_end_distance * 111000).toFixed(2)}m)`);
    console.log(`   T2 start near T1: ${tResult.t2_start_near_t1} (${(tResult.t2_start_distance * 111000).toFixed(2)}m)`);
    console.log(`   T2 end near T1: ${tResult.t2_end_near_t1} (${(tResult.t2_end_distance * 111000).toFixed(2)}m)`);

    // Check endpoint-to-endpoint proximity
    console.log('\n🔍 Checking endpoint-to-endpoint proximity...');
    const endpointResult = await client.query(`
      SELECT 
        ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.0001) as start_start_near,
        ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.0001) as start_end_near,
        ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.0001) as end_start_near,
        ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.0001) as end_end_near,
        
        ST_Distance(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry)) as start_start_dist,
        ST_Distance(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry)) as start_end_dist,
        ST_Distance(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry)) as end_start_dist,
        ST_Distance(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry)) as end_end_dist
      FROM public.trails t1, public.trails t2
      WHERE t1.app_uuid = $1 AND t2.app_uuid = $2
    `, [trail1Uuid, trail2Uuid]);

    const eResult = endpointResult.rows[0];
    console.log(`   Start-Start near: ${eResult.start_start_near} (${(eResult.start_start_dist * 111000).toFixed(2)}m)`);
    console.log(`   Start-End near: ${eResult.start_end_near} (${(eResult.start_end_dist * 111000).toFixed(2)}m)`);
    console.log(`   End-Start near: ${eResult.end_start_near} (${(eResult.end_start_dist * 111000).toFixed(2)}m)`);
    console.log(`   End-End near: ${eResult.end_end_near} (${(eResult.end_end_dist * 111000).toFixed(2)}m)`);

    // Summary
    console.log('\n📊 SUMMARY:');
    const hasTrueIntersection = intersectionResult.rows[0].intersects;
    const hasTIntersection = tResult.t1_start_near_t2 || tResult.t1_end_near_t2 || 
                            tResult.t2_start_near_t1 || tResult.t2_end_near_t1;
    const hasEndpointProximity = eResult.start_start_near || eResult.start_end_near || 
                                eResult.end_start_near || eResult.end_end_near;

    console.log(`   True intersection: ${hasTrueIntersection ? 'YES' : 'NO'}`);
    console.log(`   T-intersection: ${hasTIntersection ? 'YES' : 'NO'}`);
    console.log(`   Endpoint proximity: ${hasEndpointProximity ? 'YES' : 'NO'}`);

    if (hasTIntersection && !hasTrueIntersection) {
      console.log('\n💡 This is a T-intersection that would be missed by current detection logic!');
    }

    // Check for any actual intersections between Big Bluestem and South Boulder Creek trails
    console.log('\n🔍 Checking for any intersections between Big Bluestem and South Boulder Creek trails...');
    const allIntersectionsResult = await client.query(`
      SELECT 
        t1.app_uuid as t1_uuid,
        t1.name as t1_name,
        t2.app_uuid as t2_uuid,
        t2.name as t2_name,
        ST_AsText(ST_Intersection(t1.geometry, t2.geometry)) as intersection_point,
        ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) as intersection_type,
        ST_Intersects(t1.geometry, t2.geometry) as intersects,
        ST_Distance(ST_StartPoint(t1.geometry), t2.geometry) as t1_start_distance,
        ST_Distance(ST_EndPoint(t1.geometry), t2.geometry) as t1_end_distance,
        ST_Distance(ST_StartPoint(t2.geometry), t1.geometry) as t2_start_distance,
        ST_Distance(ST_EndPoint(t2.geometry), t1.geometry) as t2_end_distance
      FROM public.trails t1
      JOIN public.trails t2 ON t1.id < t2.id
      WHERE (t1.name ILIKE '%Big Bluestem%' AND t2.name ILIKE '%South Boulder Creek%')
         OR (t1.name ILIKE '%South Boulder Creek%' AND t2.name ILIKE '%Big Bluestem%')
      ORDER BY t1.name, t2.name
    `);
    
    console.log(`Found ${allIntersectionsResult.rows.length} trail pairs to check:`);
    allIntersectionsResult.rows.forEach((pair, i) => {
      console.log(`\n${i + 1}. ${pair.t1_name} ↔ ${pair.t2_name}`);
      console.log(`   UUIDs: ${pair.t1_uuid} ↔ ${pair.t2_uuid}`);
      console.log(`   Intersects: ${pair.intersects}`);
      console.log(`   Intersection type: ${pair.intersection_type}`);
      
      const minDistance = Math.min(
        pair.t1_start_distance * 111000,
        pair.t1_end_distance * 111000,
        pair.t2_start_distance * 111000,
        pair.t2_end_distance * 111000
      );
      
      console.log(`   Closest distance: ${minDistance.toFixed(2)}m`);
      
      if (pair.intersects) {
        console.log(`   ✅ TRUE INTERSECTION FOUND!`);
      } else if (minDistance < 10) {
        console.log(`   🎯 POTENTIAL T-INTERSECTION (${minDistance.toFixed(2)}m)`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

checkTIntersection();
