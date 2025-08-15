#!/usr/bin/env node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

async function debugTIntersectionExport() {
  console.log('🔍 Debugging T-intersection detection and export...');
  
  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const client = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    max: dbConfig.max,
    idleTimeoutMillis: dbConfig.idleTimeoutMillis,
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Find the most recent staging schema
    const stagingSchemasResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (stagingSchemasResult.rowCount === 0) {
      console.log('❌ No staging schemas found');
      return;
    }

    const stagingSchema = stagingSchemasResult.rows[0].schema_name;
    console.log(`📊 Using staging schema: ${stagingSchema}`);

    // Check if trails table exists and has data
    const trailsCountResult = await client.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.trails
    `);
    console.log(`📊 Trails in staging: ${trailsCountResult.rows[0].count}`);

    // Check if intersection_points table exists and has data
    const intersectionCountResult = await client.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.intersection_points
    `);
    console.log(`📊 Intersection points in staging: ${intersectionCountResult.rows[0].count}`);

    // Check for T-intersections specifically
    const tIntersectionCountResult = await client.query(`
      SELECT COUNT(*) as count, node_type 
      FROM ${stagingSchema}.intersection_points 
      GROUP BY node_type
    `);
    console.log('📊 Intersection types found:');
    tIntersectionCountResult.rows.forEach(row => {
      console.log(`   - ${row.node_type}: ${row.count}`);
    });

    // Look for the Enchanted Mesa Trail specifically
    const enchantedMesaResult = await client.query(`
      SELECT 
        app_uuid, name, 
        ST_NumPoints(geometry) as num_points,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%Enchanted Mesa%'
    `);

    console.log('\n🔍 Enchanted Mesa Trail details:');
    if (enchantedMesaResult.rowCount > 0) {
      enchantedMesaResult.rows.forEach((trail, index) => {
        console.log(`   Trail ${index + 1}:`);
        console.log(`     UUID: ${trail.app_uuid}`);
        console.log(`     Name: ${trail.name}`);
        console.log(`     Points: ${trail.num_points}`);
        console.log(`     Length: ${trail.length_meters?.toFixed(2)}m`);
        console.log(`     Start: ${trail.start_point}`);
        console.log(`     End: ${trail.end_point}`);
      });
    } else {
      console.log('   ❌ Enchanted Mesa Trail not found in staging');
    }

    // Check for intersections involving Enchanted Mesa Trail
    const enchantedIntersectionsResult = await client.query(`
      SELECT 
        ip.id, ip.node_type, ip.distance_meters,
        ip.connected_trail_names,
        ST_AsText(ip.point) as intersection_point
      FROM ${stagingSchema}.intersection_points ip
      WHERE ip.connected_trail_names && ARRAY['Enchanted Mesa Trail']
    `);

    console.log('\n🔍 Intersections involving Enchanted Mesa Trail:');
    if (enchantedIntersectionsResult.rowCount > 0) {
      enchantedIntersectionsResult.rows.forEach((intersection, index) => {
        console.log(`   Intersection ${index + 1}:`);
        console.log(`     Type: ${intersection.node_type}`);
        console.log(`     Distance: ${intersection.distance_meters}m`);
        console.log(`     Connected trails: ${intersection.connected_trail_names?.join(', ')}`);
        console.log(`     Point: ${intersection.intersection_point}`);
      });
    } else {
      console.log('   ❌ No intersections found for Enchanted Mesa Trail');
    }

    // Check if trails are being split at intersections
    const splitTrailsResult = await client.query(`
      SELECT 
        name, COUNT(*) as segment_count,
        array_agg(app_uuid) as segment_uuids
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%Enchanted Mesa%'
      GROUP BY name
    `);

    console.log('\n🔍 Enchanted Mesa Trail splitting status:');
    if (splitTrailsResult.rowCount > 0) {
      splitTrailsResult.rows.forEach((trail, index) => {
        console.log(`   Trail ${index + 1}:`);
        console.log(`     Name: ${trail.name}`);
        console.log(`     Segments: ${trail.segment_count}`);
        console.log(`     Segment UUIDs: ${trail.segment_uuids?.join(', ')}`);
      });
    } else {
      console.log('   ❌ No Enchanted Mesa Trail segments found');
    }

    // Check for any trails that might be intersecting with Enchanted Mesa
    const nearbyTrailsResult = await client.query(`
      WITH enchanted_mesa AS (
        SELECT geometry FROM ${stagingSchema}.trails 
        WHERE name ILIKE '%Enchanted Mesa%'
        LIMIT 1
      )
      SELECT 
        t.name, t.app_uuid,
        ST_Distance(t.geometry::geography, em.geometry::geography) as distance_meters,
        ST_AsText(ST_ClosestPoint(t.geometry, ST_StartPoint(em.geometry))) as closest_point_to_start,
        ST_AsText(ST_ClosestPoint(t.geometry, ST_EndPoint(em.geometry))) as closest_point_to_end
      FROM ${stagingSchema}.trails t, enchanted_mesa em
      WHERE t.name NOT ILIKE '%Enchanted Mesa%'
        AND ST_DWithin(t.geometry::geography, em.geometry::geography, 10)
      ORDER BY distance_meters ASC
      LIMIT 5
    `);

    console.log('\n🔍 Nearby trails (within 10m of Enchanted Mesa):');
    if (nearbyTrailsResult.rowCount > 0) {
      nearbyTrailsResult.rows.forEach((trail, index) => {
        console.log(`   Trail ${index + 1}:`);
        console.log(`     Name: ${trail.name}`);
        console.log(`     UUID: ${trail.app_uuid}`);
        console.log(`     Distance: ${trail.distance_meters?.toFixed(3)}m`);
        console.log(`     Closest to start: ${trail.closest_point_to_start}`);
        console.log(`     Closest to end: ${trail.closest_point_to_end}`);
      });
    } else {
      console.log('   ❌ No nearby trails found');
    }

    // Check the export query that would be used
    console.log('\n🔍 Testing export query for Enchanted Mesa Trail:');
    const exportTestResult = await client.query(`
      SELECT 
        app_uuid, name, region, 
        trail_type, surface as surface_type, 
        CASE 
          WHEN difficulty = 'unknown' THEN 'moderate'
          ELSE difficulty
        END as difficulty,
        ST_AsGeoJSON(geometry, 6, 0) as geojson,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      FROM ${stagingSchema}.trails
      WHERE name ILIKE '%Enchanted Mesa%'
        AND geometry IS NOT NULL
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
      ORDER BY name
    `);

    console.log(`📊 Export query found ${exportTestResult.rowCount} Enchanted Mesa Trail segments for export`);
    exportTestResult.rows.forEach((trail, index) => {
      console.log(`   Export segment ${index + 1}:`);
      console.log(`     UUID: ${trail.app_uuid}`);
      console.log(`     Name: ${trail.name}`);
      console.log(`     Length: ${trail.length_km?.toFixed(3)}km`);
      console.log(`     Points: ${JSON.parse(trail.geojson).coordinates.length}`);
    });

  } catch (error) {
    console.error('❌ Error during debugging:', error);
  } finally {
    await client.end();
  }
}

// Run the debug function
debugTIntersectionExport().catch(console.error);

