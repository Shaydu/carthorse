import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function testPgRoutingNCAR() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: 'carthorse',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: 'trail_master_db',
  });

  try {
    console.log('🔍 Testing pgRouting functions on NCAR trails...');

    // Create a test schema
    const testSchema = 'test_ncar_pgrouting';
    await pgClient.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await pgClient.query(`CREATE SCHEMA ${testSchema}`);

    // Create test trails table with NCAR trails
    await pgClient.query(`
      CREATE TABLE ${testSchema}.test_trails (
        id serial PRIMARY KEY,
        name text,
        geom geometry(LineString, 4326)
      )
    `);

    // Insert NCAR Trail (simplified coordinates from our analysis)
    await pgClient.query(`
      INSERT INTO ${testSchema}.test_trails (name, geom) VALUES
      ('NCAR Trail', ST_GeomFromText('LINESTRING(-105.282685 39.977781, -105.280484 39.978003, -105.278210 39.977432)', 4326)),
      ('NCAR Water Tank Road', ST_GeomFromText('LINESTRING(-105.280379 39.981349, -105.280962 39.977496)', 4326))
    `);

    console.log('📊 Test trails created');

    // Test pgr_separateCrossing with different tolerances
    console.log('\n🔗 Testing pgr_separateCrossing...');
    
    const tolerances = [0.0001, 0.001, 0.01, 0.1, 1.0, 2.0, 3.0];
    
    for (const tolerance of tolerances) {
      try {
        const result = await pgClient.query(`
          SELECT COUNT(*) as count FROM pgr_separateCrossing(
            'SELECT id, geom FROM ${testSchema}.test_trails',
            ${tolerance / 111000.0}
          )
        `);
        
        console.log(`   Tolerance ${tolerance}m (${(tolerance / 111000.0).toFixed(8)} degrees): ${result.rows[0].count} segments`);
      } catch (error) {
        console.log(`   Tolerance ${tolerance}m: ERROR - ${(error as Error).message}`);
      }
    }

    // Test pgr_splitTouching with different tolerances
    console.log('\n🔗 Testing pgr_splitTouching...');
    
    for (const tolerance of tolerances) {
      try {
        const result = await pgClient.query(`
          SELECT COUNT(*) as count FROM pgr_separatetouching(
            'SELECT id, geom FROM ${testSchema}.test_trails',
            ${tolerance / 111000.0}
          )
        `);
        
        console.log(`   Tolerance ${tolerance}m (${(tolerance / 111000.0).toFixed(8)} degrees): ${result.rows[0].count} segments`);
      } catch (error) {
        console.log(`   Tolerance ${tolerance}m: ERROR - ${(error as Error).message}`);
      }
    }

    // Test direct intersection detection
    console.log('\n🔍 Testing direct intersection detection...');
    
    const intersectionResult = await pgClient.query(`
      SELECT 
        t1.name as trail1,
        t2.name as trail2,
        ST_Intersects(t1.geom, t2.geom) as intersects,
        ST_Crosses(t1.geom, t2.geom) as crosses,
        ST_Touches(t1.geom, t2.geom) as touches,
        ST_GeometryType(ST_Intersection(t1.geom, t2.geom)) as intersection_type,
        ST_AsText(ST_Intersection(t1.geom, t2.geom)) as intersection_geom,
        ST_Distance(t1.geom::geography, t2.geom::geography) as distance_meters
      FROM ${testSchema}.test_trails t1
      CROSS JOIN ${testSchema}.test_trails t2
      WHERE t1.id < t2.id
    `);

    if (intersectionResult.rows.length > 0) {
      const intersection = intersectionResult.rows[0];
      console.log(`   ${intersection.trail1} ↔ ${intersection.trail2}:`);
      console.log(`     Intersects: ${intersection.intersects}`);
      console.log(`     Crosses: ${intersection.crosses}`);
      console.log(`     Touches: ${intersection.touches}`);
      console.log(`     Distance: ${intersection.distance_meters.toFixed(1)}m`);
      console.log(`     Intersection type: ${intersection.intersection_type}`);
      if (intersection.intersection_geom) {
        console.log(`     Intersection geometry: ${intersection.intersection_geom}`);
      }
    }

    // Test endpoint-to-line proximity
    console.log('\n🔍 Testing endpoint-to-line proximity...');
    
    const proximityResult = await pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          id,
          name,
          ST_StartPoint(geom) as start_point,
          ST_EndPoint(geom) as end_point,
          geom
        FROM ${testSchema}.test_trails
      )
      SELECT 
        ep.name as endpoint_trail,
        'start' as endpoint_type,
        mp.name as midpoint_trail,
        ST_Distance(ep.start_point::geography, mp.geom::geography) as distance_meters,
        ST_AsText(ep.start_point) as endpoint_coords,
        ST_AsText(ST_ClosestPoint(mp.geom, ep.start_point)) as closest_point_coords
      FROM trail_endpoints ep
      CROSS JOIN ${testSchema}.test_trails mp
      WHERE ep.id != mp.id
      UNION ALL
      SELECT 
        ep.name as endpoint_trail,
        'end' as endpoint_type,
        mp.name as midpoint_trail,
        ST_Distance(ep.end_point::geography, mp.geom::geography) as distance_meters,
        ST_AsText(ep.end_point) as endpoint_coords,
        ST_AsText(ST_ClosestPoint(mp.geom, ep.end_point)) as closest_point_coords
      FROM trail_endpoints ep
      CROSS JOIN ${testSchema}.test_trails mp
      WHERE ep.id != mp.id
      ORDER BY distance_meters
    `);

    console.log('   Endpoint-to-trail distances:');
    proximityResult.rows.forEach((row, index) => {
      console.log(`     ${index + 1}. ${row.endpoint_trail} ${row.endpoint_type} → ${row.midpoint_trail}: ${row.distance_meters.toFixed(1)}m`);
      console.log(`        Endpoint: ${row.endpoint_coords}`);
      console.log(`        Closest point: ${row.closest_point_coords}`);
    });

    // Clean up
    await pgClient.query(`DROP SCHEMA ${testSchema} CASCADE`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

testPgRoutingNCAR().catch(console.error);
