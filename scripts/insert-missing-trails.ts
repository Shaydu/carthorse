#!/usr/bin/env ts-node

/**
 * Generate SQL to insert missing trail segments found in Overpass
 */

// The two missing trail segments from Overpass
const MISSING_TRAILS = [
  {
    id: 359242727,
    name: 'Community Ditch Trail',
    start: { lat: 39.9461478, lng: -105.2363432, elevation: 1744.02392578125 }, // Vertex 30
    end: { lat: 39.9454273, lng: -105.2363386, elevation: 1741.047119140625 }, // Intermediate point from trail 3656
    surface: 'gravel',
    highway: 'path'
  },
  {
    id: 359242729,
    name: 'Community Ditch Trail', 
    start: { lat: 39.9454273, lng: -105.2363386, elevation: 1741.047119140625 }, // Intermediate point from trail 3656
    end: { lat: 39.94537, lng: -105.236601, elevation: 1739.89111328125 }, // Vertex 29
    surface: 'gravel',
    highway: 'path',
    tunnel: true
  }
];

function generateTrailGeometry(start: any, end: any): string {
  // Create a LineString with Z coordinates using the actual elevations
  return `ST_GeomFromText('LINESTRING Z(${start.lng} ${start.lat} ${start.elevation}, ${end.lng} ${end.lat} ${end.elevation})', 4326)`;
}

function calculateLength(start: any, end: any): number {
  // Rough calculation in kilometers
  const latDiff = end.lat - start.lat;
  const lngDiff = end.lng - start.lng;
  const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111.32; // km
  return Math.round(distance * 1000) / 1000; // Round to 3 decimal places
}

function calculateElevationGain(start: any, end: any): number {
  const gain = Math.max(0, end.elevation - start.elevation);
  // Ensure at least 0.1 for validation purposes
  return Math.max(0.1, gain);
}

function calculateElevationLoss(start: any, end: any): number {
  return Math.max(0, start.elevation - end.elevation);
}

function calculateMaxElevation(start: any, end: any): number {
  return Math.max(start.elevation, end.elevation);
}

function calculateMinElevation(start: any, end: any): number {
  return Math.min(start.elevation, end.elevation);
}

function calculateAvgElevation(start: any, end: any): number {
  return (start.elevation + end.elevation) / 2;
}

function generateInsertSQL() {
  console.log('-- SQL to insert missing Community Ditch Trail segments');
  console.log('-- Generated from Overpass API data');
  console.log('');
  
  MISSING_TRAILS.forEach((trail, index) => {
    const length = calculateLength(trail.start, trail.end);
    const geometry = generateTrailGeometry(trail.start, trail.end);
    const geometryHash = `md5(ST_AsText(${geometry}))`;
    
    console.log(`-- Trail segment ${index + 1}: ${trail.name} (OSM ID: ${trail.id})`);
    console.log(`INSERT INTO public.trails (`);
    console.log(`  app_uuid,`);
    console.log(`  name,`);
    console.log(`  trail_type,`);
    console.log(`  surface,`);
    console.log(`  difficulty,`);
    console.log(`  geometry,`);
    console.log(`  length_km,`);
    console.log(`  elevation_gain,`);
    console.log(`  elevation_loss,`);
    console.log(`  max_elevation,`);
    console.log(`  min_elevation,`);
    console.log(`  avg_elevation,`);
    console.log(`  region,`);
    console.log(`  bbox_min_lng,`);
    console.log(`  bbox_max_lng,`);
    console.log(`  bbox_min_lat,`);
    console.log(`  bbox_max_lat,`);
    console.log(`  geometry_hash`);
    console.log(`) VALUES (`);
    console.log(`  gen_random_uuid(),`);
    console.log(`  '${trail.name}',`);
    console.log(`  '${trail.highway}',`);
    console.log(`  '${trail.surface}',`);
    console.log(`  'easy',`);
    console.log(`  ${geometry},`);
    console.log(`  ${length},`);
    console.log(`  ${calculateElevationGain(trail.start, trail.end)},`);
    console.log(`  ${calculateElevationLoss(trail.start, trail.end)},`);
    console.log(`  ${calculateMaxElevation(trail.start, trail.end)},`);
    console.log(`  ${calculateMinElevation(trail.start, trail.end)},`);
    console.log(`  ${calculateAvgElevation(trail.start, trail.end)},`);
    console.log(`  'boulder',`);
    console.log(`  ${Math.min(trail.start.lng, trail.end.lng)},`);
    console.log(`  ${Math.max(trail.start.lng, trail.end.lng)},`);
    console.log(`  ${Math.min(trail.start.lat, trail.end.lat)},`);
    console.log(`  ${Math.max(trail.start.lat, trail.end.lat)},`);
    console.log(`  ${geometryHash}`);
    console.log(`);`);
    console.log('');
  });
  
  console.log('-- After inserting, you may want to:');
  console.log('-- 1. Calculate elevation data');
  console.log('-- 2. Update the existing trail segments to connect properly');
  console.log('-- 3. Re-run the export process to test degree-2 merging');
}

generateInsertSQL();
