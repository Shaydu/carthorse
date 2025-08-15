import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkTrailIntersectionType() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: process.env.PGDATABASE || 'trail_master_db_test',
  });

  try {
    console.log('🔍 Checking intersection type between Enchanted Mesa Trail and Kohler Mesa Trail...');
    
    // Find the staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using staging schema: ${stagingSchema}`);
    
    // Check if trails table exists
    const tableResult = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'trails'
      )
    `, [stagingSchema]);
    
    if (!tableResult.rows[0].exists) {
      console.error('❌ Trails table not found in staging schema');
      return;
    }
    
    // Get the specific trails
    const trailsResult = await pgClient.query(`
      SELECT 
        id,
        name,
        ST_AsText(ST_Force2D(geometry)) as geom_text,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE name IN ('Enchanted Mesa Trail', 'Kohler Mesa Trail')
      ORDER BY name
    `);
    
    if (trailsResult.rows.length < 2) {
      console.error('❌ Could not find both trails');
      console.log('Available trails:');
      const allTrails = await pgClient.query(`
        SELECT name FROM ${stagingSchema}.trails WHERE name LIKE '%Mesa%'
      `);
      allTrails.rows.forEach(row => console.log(`  - ${row.name}`));
      return;
    }
    
    const enchantedTrail = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
    const kohlerTrail = trailsResult.rows.find(t => t.name === 'Kohler Mesa Trail');
    
    console.log(`\n📍 Enchanted Mesa Trail:`);
    console.log(`   ID: ${enchantedTrail.id}`);
    console.log(`   Length: ${enchantedTrail.length_meters.toFixed(1)}m`);
    
    console.log(`\n📍 Kohler Mesa Trail:`);
    console.log(`   ID: ${kohlerTrail.id}`);
    console.log(`   Length: ${kohlerTrail.length_meters.toFixed(1)}m`);
    
    // Check intersection types
    const intersectionResult = await pgClient.query(`
      SELECT 
        ST_Crosses($1::geometry, $2::geometry) as crosses,
        ST_Touches($1::geometry, $2::geometry) as touches,
        ST_Intersects($1::geometry, $2::geometry) as intersects,
        ST_DWithin($1::geometry, $2::geometry, 0.0001) as within_10m,
        ST_DWithin($1::geometry, $2::geometry, 0.0002) as within_20m,
        ST_Distance($1::geometry::geography, $2::geometry::geography) as distance_meters,
        ST_AsText(ST_Intersection($1::geometry, $2::geometry)) as intersection_geom
      FROM (SELECT $1::geometry as geom1, $2::geometry as geom2) as t
    `, [enchantedTrail.geom_text, kohlerTrail.geom_text]);
    
    const intersection = intersectionResult.rows[0];
    
    console.log(`\n🔍 Intersection Analysis:`);
    console.log(`   Crosses: ${intersection.crosses}`);
    console.log(`   Touches: ${intersection.touches}`);
    console.log(`   Intersects: ${intersection.intersects}`);
    console.log(`   Within 10m: ${intersection.within_10m}`);
    console.log(`   Within 20m: ${intersection.within_20m}`);
    console.log(`   Distance: ${intersection.distance_meters.toFixed(2)}m`);
    console.log(`   Intersection geometry: ${intersection.intersection_geom}`);
    
    // Check what our custom detection would find
    const customDetectionResult = await pgClient.query(`
      WITH trail_pairs AS (
        SELECT 
          t1.id as trail1_id,
          t1.name as trail1_name,
          t2.id as trail2_id,
          t2.name as trail2_name,
          ST_Force2D(t1.geometry) as trail1_geom,
          ST_Force2D(t2.geometry) as trail2_geom
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE t1.name = 'Enchanted Mesa Trail' AND t2.name = 'Kohler Mesa Trail'
      )
      SELECT 
        trail1_name,
        trail2_name,
        ST_Crosses(trail1_geom, trail2_geom) as crosses,
        ST_DWithin(trail1_geom, trail2_geom, 0.000018) as within_tolerance,
        ST_Distance(trail1_geom::geography, trail2_geom::geography) as distance_meters,
        ST_ClosestPoint(trail1_geom, trail2_geom) as closest_point,
        ST_LineLocatePoint(trail1_geom, ST_ClosestPoint(trail1_geom, trail2_geom)) as location_ratio
      FROM trail_pairs
    `);
    
    if (customDetectionResult.rows.length > 0) {
      const detection = customDetectionResult.rows[0];
      console.log(`\n🔍 Custom Detection Analysis:`);
      console.log(`   Crosses: ${detection.crosses}`);
      console.log(`   Within tolerance (2m): ${detection.within_tolerance}`);
      console.log(`   Distance: ${detection.distance_meters.toFixed(2)}m`);
      console.log(`   Location ratio: ${detection.location_ratio.toFixed(3)}`);
      
      if (detection.crosses) {
        console.log(`\n❌ These trails CROSS each other, so they're excluded from custom T-intersection detection`);
        console.log(`   They should be handled by pgr_separateCrossing, but that's failing with GeometryCollection error`);
      } else if (detection.within_tolerance) {
        console.log(`\n✅ These trails are within tolerance and don't cross - they should be detected by custom T-intersection`);
      } else {
        console.log(`\n❌ These trails are too far apart (${detection.distance_meters.toFixed(2)}m) for T-intersection detection`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkTrailIntersectionType().catch(console.error);
