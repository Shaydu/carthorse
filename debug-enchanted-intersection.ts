import { Pool } from 'pg';
import { getProductionDbConfig } from './src/database/connection';

async function debugEnchantedIntersection() {
  const config = getProductionDbConfig();
  const pgClient = new Pool(config);

  try {
    // Find the staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rowCount === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`🔍 Using staging schema: ${stagingSchema}`);
    
    // Check if intersection_points table exists
    const tableExists = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'intersection_points'
      )
    `, [stagingSchema]);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ intersection_points table does not exist');
      return;
    }
    
    // Check for Enchanted-related trails
    const enchantedTrails = await pgClient.query(`
      SELECT app_uuid, name, ST_AsText(ST_StartPoint(geometry)) as start_point, ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%enchanted%' OR name ILIKE '%kohler%'
      ORDER BY name
    `);
    
    console.log(`\n🔍 Enchanted-related trails found: ${enchantedTrails.rowCount}`);
    for (const trail of enchantedTrails.rows) {
      console.log(`   ${trail.name} (${trail.app_uuid})`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
    }
    
    // Check for intersection points involving Enchanted trails
    const enchantedIntersections = await pgClient.query(`
      SELECT 
        ip.connected_trail_names,
        ip.node_type,
        ip.distance_meters,
        ST_AsText(ip.intersection_point) as intersection_coords,
        ST_X(ip.intersection_point) as lng,
        ST_Y(ip.intersection_point) as lat
      FROM ${stagingSchema}.intersection_points ip
      WHERE ip.connected_trail_names && ARRAY['Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail']
      ORDER BY ip.distance_meters
    `);
    
    console.log(`\n🔍 Enchanted-related intersection points: ${enchantedIntersections.rowCount}`);
    for (const intersection of enchantedIntersections.rows) {
      console.log(`   ${intersection.connected_trail_names.join(' ↔ ')}`);
      console.log(`     Type: ${intersection.node_type}, Distance: ${intersection.distance_meters}m`);
      console.log(`     Coords: ${intersection.intersection_coords} (${intersection.lng}, ${intersection.lat})`);
    }
    
    // Check for the specific target point
    const targetLng = -105.2823931909462;
    const targetLat = 39.98859709804337;
    const tolerance = 0.001; // ~100 meters
    
    const nearbyIntersections = await pgClient.query(`
      SELECT 
        ip.connected_trail_names,
        ip.node_type,
        ip.distance_meters,
        ST_AsText(ip.intersection_point) as intersection_coords,
        ST_X(ip.intersection_point) as lng,
        ST_Y(ip.intersection_point) as lat,
        ST_Distance(ip.intersection_point, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance_to_target
      FROM ${stagingSchema}.intersection_points ip
      WHERE ST_DWithin(ip.intersection_point, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)
      ORDER BY distance_to_target
    `, [targetLng, targetLat, tolerance]);
    
    console.log(`\n🎯 Intersections near target point (${targetLng}, ${targetLat}): ${nearbyIntersections.rowCount}`);
    for (const intersection of nearbyIntersections.rows) {
      console.log(`   ${intersection.connected_trail_names.join(' ↔ ')}`);
      console.log(`     Type: ${intersection.node_type}, Distance: ${intersection.distance_meters}m`);
      console.log(`     Coords: ${intersection.intersection_coords} (${intersection.lng}, ${intersection.lat})`);
      console.log(`     Distance to target: ${intersection.distance_to_target}m`);
    }
    
    // Check if trails are being split correctly
    const splitTrails = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%enchanted%' OR name ILIKE '%kohler%'
      ORDER BY name, ST_Length(geometry::geography) DESC
    `);
    
    console.log(`\n🔪 Split Enchanted trails: ${splitTrails.rowCount}`);
    for (const trail of splitTrails.rows) {
      console.log(`   ${trail.name} (${trail.app_uuid})`);
      console.log(`     Start: ${trail.start_point}`);
      console.log(`     End: ${trail.end_point}`);
      console.log(`     Length: ${trail.length_meters}m`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugEnchantedIntersection();
