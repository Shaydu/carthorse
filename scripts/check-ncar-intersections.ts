import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkNCARIntersections() {
  const pgClient = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'tester',
    password: process.env.PGPASSWORD || 'your_password_here',
    database: process.env.PGDATABASE || 'trail_master_db_test',
  });

  try {
    console.log('🔍 Checking actual intersections between NCAR Trail and NCAR Water Tank Road...');
    
    // Find the staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📁 Using schema: ${stagingSchema}`);
    
    // Get the trail geometries
    const trailResult = await pgClient.query(`
      SELECT 
        id,
        name,
        app_uuid,
        ST_AsText(geometry) as geom_text,
        ST_Length(geometry::geography) as length_meters,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%NCAR%'
      ORDER BY name
    `);
    
    if (trailResult.rows.length === 0) {
      console.log('❌ No NCAR trails found in staging');
      return;
    }
    
    console.log(`\n📊 Found ${trailResult.rows.length} NCAR trails in staging:`);
    trailResult.rows.forEach((trail, index) => {
      console.log(`   ${index + 1}. ${trail.name} (ID: ${trail.id}, UUID: ${trail.app_uuid})`);
      console.log(`      Length: ${trail.length_meters.toFixed(1)}m`);
    });
    
    // Check intersections between all NCAR trails
    if (trailResult.rows.length >= 2) {
      for (let i = 0; i < trailResult.rows.length; i++) {
        for (let j = i + 1; j < trailResult.rows.length; j++) {
          const trail1 = trailResult.rows[i];
          const trail2 = trailResult.rows[j];
          
          console.log(`\n🔗 Checking intersection between:`);
          console.log(`   ${trail1.name} (${trail1.app_uuid})`);
          console.log(`   ${trail2.name} (${trail2.app_uuid})`);
          
          // Check intersection details
          const intersectionResult = await pgClient.query(`
            SELECT 
              ST_Intersects(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}')) as intersects,
              ST_Crosses(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}')) as crosses,
              ST_Touches(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}')) as touches,
              ST_GeometryType(ST_Intersection(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}'))) as intersection_type,
              ST_AsText(ST_Intersection(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${trail2.geom_text}'))) as intersection_geom,
              ST_Distance(ST_GeomFromText('${trail1.geom_text}')::geography, ST_GeomFromText('${trail2.geom_text}')::geography) as distance_meters
          `);
          
          const intersection = intersectionResult.rows[0];
          console.log(`   Intersects: ${intersection.intersects}`);
          console.log(`   Crosses: ${intersection.crosses}`);
          console.log(`   Touches: ${intersection.touches}`);
          console.log(`   Distance: ${intersection.distance_meters.toFixed(1)}m`);
          console.log(`   Intersection type: ${intersection.intersection_type}`);
          
          if (intersection.intersects && intersection.intersection_geom) {
            console.log(`   Intersection geometry: ${intersection.intersection_geom}`);
            
            // Check where the intersection occurs on each trail
            const locationResult = await pgClient.query(`
              SELECT 
                ST_LineLocatePoint(ST_GeomFromText('${trail1.geom_text}'), ST_GeomFromText('${intersection.intersection_geom}')) as trail1_location_ratio,
                ST_LineLocatePoint(ST_GeomFromText('${trail2.geom_text}'), ST_GeomFromText('${intersection.intersection_geom}')) as trail2_location_ratio
            `);
            
            const location = locationResult.rows[0];
            console.log(`   Location on ${trail1.name}: ${(location.trail1_location_ratio * 100).toFixed(1)}%`);
            console.log(`   Location on ${trail2.name}: ${(location.trail2_location_ratio * 100).toFixed(1)}%`);
          }
        }
      }
    }
    
    // Also check if there are any intersection points stored in the database
    const intersectionPointsResult = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.intersection_points
    `);
    
    console.log(`\n📍 Intersection points in database: ${intersectionPointsResult.rows[0].count}`);
    
    if (parseInt(intersectionPointsResult.rows[0].count) > 0) {
      const pointsResult = await pgClient.query(`
        SELECT 
          id,
          ST_AsText(point) as point_geom,
          trail1_id,
          trail2_id,
          distance_meters
        FROM ${stagingSchema}.intersection_points
        ORDER BY distance_meters
      `);
      
      console.log(`\n📍 Stored intersection points:`);
      pointsResult.rows.forEach((point, index) => {
        console.log(`   ${index + 1}. Point: ${point.point_geom}`);
        console.log(`      Trail1 ID: ${point.trail1_id}, Trail2 ID: ${point.trail2_id}`);
        console.log(`      Distance: ${point.distance_meters.toFixed(1)}m`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
  }
}

checkNCARIntersections().catch(console.error);
