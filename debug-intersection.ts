import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function debugIntersection() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'carthorse',
    password: process.env.PGPASSWORD || ''
  });

  try {
    // Use the specific staging schema
   
    const stagingSchema = 'carthorse_1755267820086';
    console.log(`🔍 Using staging schema: ${stagingSchema}`);
    
    // Check if intersection_points table exists and has data
    const intersectionCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.intersection_points
    `);
    console.log(`📊 Total intersection points: ${intersectionCount.rows[0].count}`);
    
    // Check for the specific intersection point near the coordinates
    const specificIntersection = await pgClient.query(`
      SELECT 
        ST_AsText(intersection_point) as point_text,
        ST_X(intersection_point) as x,
        ST_Y(intersection_point) as y,
        connected_trail_names,
        node_type,
        distance_meters
      FROM ${stagingSchema}.intersection_points
      WHERE ST_DWithin(
        intersection_point, 
        ST_SetSRID(ST_MakePoint(-105.282393, 39.988597), 4326), 
        0.001
      )
    `);
    
    console.log(`🎯 Intersection points near (-105.282393, 39.988597):`);
    if (specificIntersection.rowCount && specificIntersection.rowCount > 0) {
      specificIntersection.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. Point: ${row.point_text}`);
        console.log(`      X: ${row.x}, Y: ${row.y}`);
        console.log(`      Connected trails: ${row.connected_trail_names}`);
        console.log(`      Node type: ${row.node_type}`);
        console.log(`      Distance: ${row.distance_meters}m`);
      });
    } else {
      console.log('   ❌ No intersection points found near the specified coordinates');
    }
    
    // Check Enchanted Mesa Trail segments
    const enchantedSegments = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails
      WHERE name LIKE '%Enchanted Mesa%'
      ORDER BY name, app_uuid
    `);
    
    console.log(`\n🌲 Enchanted Mesa Trail segments: ${enchantedSegments.rowCount}`);
    enchantedSegments.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ID: ${row.app_uuid}`);
      console.log(`      Name: ${row.name}`);
      console.log(`      Start: ${row.start_point}`);
      console.log(`      End: ${row.end_point}`);
      console.log(`      Length: ${Math.round(row.length_meters)}m`);
    });
    
    // Check if any trails pass through the intersection point
    const trailsAtPoint = await pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_Distance(geometry, ST_SetSRID(ST_MakePoint(-105.282393, 39.988597), 4326)) as distance_meters
      FROM ${stagingSchema}.trails
      WHERE ST_DWithin(
        geometry, 
        ST_SetSRID(ST_MakePoint(-105.282393, 39.988597), 4326), 
        0.001
      )
      ORDER BY distance_meters
    `);
    
    console.log(`\n🛤️ Trails passing through the intersection point:`);
    if (trailsAtPoint.rowCount && trailsAtPoint.rowCount > 0) {
      trailsAtPoint.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. ${row.name} (${row.app_uuid})`);
        console.log(`      Distance: ${row.distance_meters}m`);
      });
    } else {
      console.log('   ❌ No trails found passing through the intersection point');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

debugIntersection();
