#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { getDatabasePoolConfig } from './src/utils/config-loader';

interface Point {
  lng: number;
  lat: number;
  elevation: number;
}

interface PathSegment {
  start: Point;
  end: Point;
}

function calculateDistance(point1: Point, point2: Point): number {
  const R = 6371000; // Earth's radius in meters
  const lat1Rad = point1.lat * Math.PI / 180;
  const lat2Rad = point2.lat * Math.PI / 180;
  const deltaLatRad = (point2.lat - point1.lat) * Math.PI / 180;
  const deltaLngRad = (point2.lng - point1.lng) * Math.PI / 180;

  const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) *
    Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  // Calculate distance from point to line segment
  const A = point.lng - lineStart.lng;
  const B = point.lat - lineStart.lat;
  const C = lineEnd.lng - lineStart.lng;
  const D = lineEnd.lat - lineStart.lat;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    // Line start and end are the same point
    return calculateDistance(point, lineStart);
  }

  let param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    xx = lineStart.lng;
    yy = lineStart.lat;
  } else if (param > 1) {
    xx = lineEnd.lng;
    yy = lineEnd.lat;
  } else {
    xx = lineStart.lng + param * C;
    yy = lineStart.lat + param * D;
  }

  const dx = point.lng - xx;
  const dy = point.lat - yy;
  
  // Convert to meters using approximate conversion
  const latMeters = dy * 111320; // 1 degree latitude ≈ 111,320 meters
  const lngMeters = dx * 111320 * Math.cos(point.lat * Math.PI / 180);
  
  return Math.sqrt(latMeters * latMeters + lngMeters * lngMeters);
}

async function calculateDistanceToPath() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide schema name as argument');
    console.error('Usage: npx ts-node calculate-distance-to-path.ts <schema>');
    process.exit(1);
  }

  console.log(`🔍 Calculating distance from point to path for schema: ${schema}`);

  // The point you want to check
  const targetPoint: Point = {
    lng: -105.295095,
    lat: 39.990015,
    elevation: 2176.841796875
  };

  // Connect to database
  const dbConfig = getDatabasePoolConfig();
  const pool = new Pool(dbConfig);

  try {
    console.log('✅ Connected to database');

    // Find the closest path segment to this point
    const query = `
      SELECT 
        ST_AsText(geometry) as geom_text,
        ST_Distance(
          geometry,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        ) * 111320 as distance_meters
      FROM ${schema}.trails 
      WHERE ST_DWithin(
        geometry,
        ST_SetSRID(ST_MakePoint($1, $2), 4326),
        0.01
      )
      ORDER BY ST_Distance(
        geometry,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)
      )
      LIMIT 5;
    `;

    const result = await pool.query(query, [targetPoint.lng, targetPoint.lat]);

    if (result.rows.length === 0) {
      console.log('❌ No nearby paths found within 0.01 degrees');
      return;
    }

    console.log(`\n📍 Target point: ${targetPoint.lng}, ${targetPoint.lat}, ${targetPoint.elevation}`);
    console.log(`\n🛤️  Found ${result.rows.length} nearby path(s):`);

    result.rows.forEach((row, index) => {
      console.log(`\n  Path ${index + 1}:`);
      console.log(`    Distance: ${row.distance_meters.toFixed(2)} meters`);
      console.log(`    Geometry: ${row.geom_text.substring(0, 100)}...`);
    });

    const closestPath = result.rows[0];
    console.log(`\n✅ Closest path is ${closestPath.distance_meters.toFixed(2)} meters away`);

    // Now let's add this as a problem node
    console.log(`\n🎯 Adding this point as a problem node for Y intersection split...`);

    const insertQuery = `
      INSERT INTO ${schema}.graphsage_predictions (
        node_id, lat, lng, elevation, degree, 
        predicted_label, confidence, 
        node_type, type, color, stroke
      ) VALUES (
        NULL, $1, $2, $3, 3,
        2, 1.0,
        'connector', 'edge_network_vertex', '#FF0000', '#FF0000'
      )
      ON CONFLICT (lat, lng) DO UPDATE SET
        predicted_label = 2,
        confidence = 1.0,
        degree = 3,
        node_type = 'connector',
        type = 'edge_network_vertex',
        color = '#FF0000',
        stroke = '#FF0000';
    `;

    await pool.query(insertQuery, [
      targetPoint.lat,
      targetPoint.lng, 
      targetPoint.elevation
    ]);

    console.log(`✅ Added problem node: ${targetPoint.lng}, ${targetPoint.lat}, ${targetPoint.elevation}`);
    console.log(`   - Should be snapped to nearest path`);
    console.log(`   - Should be split into Y intersection (degree 3)`);
    console.log(`   - Distance to nearest path: ${closestPath.distance_meters.toFixed(2)} meters`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

calculateDistanceToPath().catch(console.error);
