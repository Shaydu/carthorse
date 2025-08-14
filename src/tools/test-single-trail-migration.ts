#!/usr/bin/env node
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';
import { AtomicTrailInserter } from './carthorse-postgres-atomic-insert';

async function testSingleTrailMigration() {
  console.log('🧪 Testing single trail migration for ID 4409...');
  
  const pgClient = new Pool(getDatabasePoolConfig());
  const atomicInserter = new AtomicTrailInserter('trail_master_db');
  
  try {
    await pgClient.connect();
    await atomicInserter.connect();
    console.log('✅ Connected to database and elevation system');

    // Get trail ID 4409
    const trailQuery = `
      SELECT 
        id,
        cpw_objectid,
        name,
        trail_type,
        length_miles,
        difficulty,
        surface_type,
        ST_AsText(geometry) as geometry_text,
        created_at
      FROM public.cotrex_trails
      WHERE id = 4409
    `;
    
    const trailResult = await pgClient.query(trailQuery);
    if (trailResult.rows.length === 0) {
      console.log('❌ Trail ID 4409 not found');
      return;
    }
    
    const trail = trailResult.rows[0];
    console.log(`📊 Trail found: ${trail.name} (CPW ID: ${trail.cpw_objectid})`);
    console.log(`   Geometry: ${trail.geometry_text.substring(0, 100)}...`);

    // Parse geometry to coordinates
    const coordinates = parseGeometryText(trail.geometry_text);
    console.log(`   Coordinates: ${coordinates.length} points`);
    console.log(`   First 3 coordinates: ${coordinates.slice(0, 3).map(c => `[${c[0]}, ${c[1]}]`).join(', ')}`);

    if (coordinates.length === 0) {
      console.log('❌ No coordinates found');
      return;
    }

    // Test elevation lookup
    console.log('\n🔍 Testing elevation lookup...');
    let elevationData: any;
    try {
      elevationData = await atomicInserter.processTrailElevation(coordinates);
      console.log(`   ✅ Elevation data:`);
      console.log(`      - Elevations: ${elevationData.elevations.map(e => e || 'null').join(', ')}`);
      console.log(`      - Elevation gain: ${elevationData.elevation_gain}`);
      console.log(`      - Max elevation: ${elevationData.max_elevation}`);
      console.log(`      - Min elevation: ${elevationData.min_elevation}`);
      console.log(`      - Avg elevation: ${elevationData.avg_elevation}`);
    } catch (error) {
      console.log(`   ❌ Elevation error: ${error.message}`);
      return;
    }

    // Test interpolation
    console.log('\n🔍 Testing interpolation...');
    const interpolatedCoordinates = interpolateElevationData(coordinates, elevationData.elevations);
    console.log(`   ✅ Interpolated coordinates: ${interpolatedCoordinates.length} points`);
    console.log(`   First 3 interpolated: ${interpolatedCoordinates.slice(0, 3).join(', ')}`);

    // Test geometry hash generation
    const linestring3D = `LINESTRING Z (${interpolatedCoordinates.join(', ')})`;
    const geometryHash = generateMD5Hash(linestring3D);
    console.log(`   ✅ Geometry hash: ${geometryHash}`);

    // Test insertion
    console.log('\n🔍 Testing database insertion...');
    const uuid = generateUUID();
    const insertQuery = `
      INSERT INTO public.trails (
        app_uuid,
        name,
        osm_id,
        source,
        region,
        trail_type,
        surface,
        difficulty,
        source_tags,
        geometry,
        geometry_hash,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, ST_GeomFromText($10, 4326), $11, $12, $13, $14, $15, $16, $17, $18, $19
      ) RETURNING id
    `;

    const values = [
      uuid,
      trail.name || 'Unknown CPW Trail',
      `cpw_${trail.cpw_objectid}`,
      'cotrex',
      'boulder',
      trail.trail_type || 'unknown',
      trail.surface_type || 'unknown',
      trail.difficulty || 'unknown',
      JSON.stringify({
        cpw_objectid: trail.cpw_objectid,
        trail_type: trail.trail_type,
        difficulty: trail.difficulty,
        surface_type: trail.surface_type,
        length_miles: trail.length_miles
      }),
      linestring3D,
      geometryHash,
      (trail.length_miles || 0) * 1.60934,
      elevationData.elevation_gain,
      elevationData.elevation_loss,
      elevationData.max_elevation,
      elevationData.min_elevation,
      elevationData.avg_elevation,
      trail.created_at || new Date(),
      new Date()
    ];

    try {
      const insertResult = await pgClient.query(insertQuery, values);
      console.log(`   ✅ Successfully inserted trail with ID: ${insertResult.rows[0].id}`);
      
      // Verify insertion
      const verifyQuery = `SELECT id, name, source, region FROM public.trails WHERE app_uuid = $1`;
      const verifyResult = await pgClient.query(verifyQuery, [uuid]);
      console.log(`   ✅ Verification: ${verifyResult.rows[0].name} (source: ${verifyResult.rows[0].source}, region: ${verifyResult.rows[0].region})`);
      
    } catch (error) {
      console.log(`   ❌ Insertion error: ${error.message}`);
      console.log(`   Error details:`, error);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pgClient.end();
    await atomicInserter.disconnect();
  }
}

function parseGeometryText(geometryText: string): number[][] {
  try {
    const match = geometryText.match(/LINESTRING\s*Z?\s*\(([^)]+)\)/i);
    if (!match) {
      return [];
    }

    const coordPairs = match[1].split(',').map(pair => pair.trim());
    return coordPairs.map(pair => {
      const coords = pair.split(/\s+/).map(Number);
      return [coords[0], coords[1]];
    });
  } catch (error) {
    console.error('Error parsing geometry:', error);
    return [];
  }
}

function interpolateElevationData(coordinates: number[][], elevations: number[]): string[] {
  const interpolatedCoordinates: string[] = [];
  
  for (let i = 0; i < coordinates.length; i++) {
    let elevation = elevations[i];
    
    if (elevation === undefined || elevation === null || elevation <= 0) {
      elevation = interpolateElevationFromNearby(coordinates, elevations, i);
    }
    
    const [lng, lat] = coordinates[i];
    interpolatedCoordinates.push(`${lng} ${lat} ${elevation}`);
  }
  
  return interpolatedCoordinates;
}

function interpolateElevationFromNearby(coordinates: number[][], elevations: number[], currentIndex: number): number {
  const currentCoord = coordinates[currentIndex];
  const validElevations: { distance: number; elevation: number }[] = [];
  
  for (let i = 0; i < coordinates.length; i++) {
    if (i === currentIndex) continue;
    
    const elevation = elevations[i];
    if (elevation !== undefined && elevation !== null && elevation > 0) {
      const distance = calculateDistance(currentCoord, coordinates[i]);
      if (distance <= 1000) {
        validElevations.push({ distance, elevation });
      }
    }
  }
  
  if (validElevations.length === 0) {
    return 1600;
  }
  
  validElevations.sort((a, b) => a.distance - b.distance);
  
  const maxPoints = Math.min(5, validElevations.length);
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (let i = 0; i < maxPoints; i++) {
    const { distance, elevation } = validElevations[i];
    const weight = 1 / (distance + 1);
    totalWeight += weight;
    weightedSum += elevation * weight;
  }
  
  return Math.round(weightedSum / totalWeight);
}

function calculateDistance(coord1: number[], coord2: number[]): number {
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;
  
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateMD5Hash(text: string): string {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(text).digest('hex');
}

if (require.main === module) {
  testSingleTrailMigration();
}
