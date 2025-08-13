import { Pool } from 'pg';
import axios from 'axios';

export interface TrailGap {
  id: string;
  trail1_id: string;
  trail1_name: string;
  trail1_endpoint: 'start' | 'end';
  trail2_id: string;
  trail2_name: string;
  trail2_endpoint: 'start' | 'end';
  gap_distance_meters: number;
  gap_geometry: any; // LineString between endpoints
  trail1_coords: [number, number]; // [lng, lat]
  trail2_coords: [number, number]; // [lng, lat]
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  confidence_score: number; // 0-1 based on distance and trail similarity
}

export interface ExternalTrailCandidate {
  id: string;
  name: string;
  geometry: any;
  length_meters: number;
  surface?: string;
  difficulty?: string;
  source: 'overpass' | 'other_api';
  confidence: number;
  metadata: Record<string, any>;
}

export interface GapBackfillResult {
  gapsIdentified: number;
  candidatesFound: number;
  trailsAdded: number;
  details: Array<{
    gap: TrailGap;
    candidates: ExternalTrailCandidate[];
    selectedCandidate?: ExternalTrailCandidate;
  }>;
}

export interface BackfilledTrailMetadata {
  backfill_id: string;
  backfill_timestamp: string;
  gap_trail1_id: string;
  gap_trail1_name: string;
  gap_trail2_id: string;
  gap_trail2_name: string;
  gap_distance_meters: number;
  candidate_source: string;
  candidate_confidence: number;
  backfill_version: string;
}

export interface GapBackfillConfig {
  maxGapDistanceMeters: number;
  minCandidateLengthMeters: number;
  maxCandidateLengthMeters: number;
  confidenceThreshold: number;
  bboxExpansionMeters: number;
  enableOverpass: boolean;
  enableOtherApis: boolean;
}

export interface VisualizationConfig {
  exportCandidates?: boolean;
  outputPath?: string;
  includeGaps?: boolean;
  includeExistingTrails?: boolean;
  includeConnectivityAnalysis?: boolean;
}

export interface ConnectivityAnalysis {
  beforeBackfill: {
    totalNodes: number;
    reachableNodes: number;
    connectivityPercentage: number;
    isolatedComponents: number;
  };
  afterBackfill: {
    totalNodes: number;
    reachableNodes: number;
    connectivityPercentage: number;
    isolatedComponents: number;
  };
  improvement: {
    percentageIncrease: number;
    additionalReachableNodes: number;
    componentsReduced: number;
  };
}

/**
 * Enhanced gap detection that identifies gaps in the trails layer
 * (not the edges layer like the existing gap detection)
 */
export async function identifyTrailGaps(
  pgClient: Pool,
  schema: string,
  config: GapBackfillConfig,
  regionFilter?: string
): Promise<TrailGap[]> {
  console.log('🔍 Identifying gaps in trails layer...');
  
  const result = await pgClient.query(`
    WITH trail_endpoints AS (
      -- Get start and end points of all trails
      SELECT 
        id as trail_id,
        name as trail_name,
        ST_StartPoint(geometry) as start_point,
        ST_EndPoint(geometry) as end_point,
        ST_AsText(ST_StartPoint(geometry)) as start_coords,
        ST_AsText(ST_EndPoint(geometry)) as end_coords
      FROM ${schema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry::geography) > 10  -- Minimum trail length
        ${regionFilter ? `AND region = '${regionFilter}'` : ''}
    ),
    endpoint_pairs AS (
      -- Find pairs of trail endpoints that are close but not connected
      SELECT 
        t1.trail_id as trail1_id,
        t1.trail_name as trail1_name,
        'start' as trail1_endpoint,
        t1.start_point as trail1_point,
        t1.start_coords as trail1_coords,
        t2.trail_id as trail2_id,
        t2.trail_name as trail2_name,
        'start' as trail2_endpoint,
        t2.start_point as trail2_point,
        t2.start_coords as trail2_coords,
        ST_Distance(t1.start_point, t2.start_point) * 111320 as distance_meters
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.trail_id < t2.trail_id
        AND ST_DWithin(t1.start_point, t2.start_point, $1 / 111320.0)
        AND ST_Distance(t1.start_point, t2.start_point) * 111320 <= $2
        
      UNION ALL
      
      SELECT 
        t1.trail_id as trail1_id,
        t1.trail_name as trail1_name,
        'start' as trail1_endpoint,
        t1.start_point as trail1_point,
        t1.start_coords as trail1_coords,
        t2.trail_id as trail2_id,
        t2.trail_name as trail2_name,
        'end' as trail2_endpoint,
        t2.end_point as trail2_point,
        t2.end_coords as trail2_coords,
        ST_Distance(t1.start_point, t2.end_point) * 111320 as distance_meters
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.trail_id != t2.trail_id
        AND ST_DWithin(t1.start_point, t2.end_point, $1 / 111320.0)
        AND ST_Distance(t1.start_point, t2.end_point) * 111320 <= $2
        
      UNION ALL
      
      SELECT 
        t1.trail_id as trail1_id,
        t1.trail_name as trail1_name,
        'end' as trail1_endpoint,
        t1.end_point as trail1_point,
        t1.end_coords as trail1_coords,
        t2.trail_id as trail2_id,
        t2.trail_name as trail2_name,
        'start' as trail2_endpoint,
        t2.start_point as trail2_point,
        t2.start_coords as trail2_coords,
        ST_Distance(t1.end_point, t2.start_point) * 111320 as distance_meters
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.trail_id != t2.trail_id
        AND ST_DWithin(t1.end_point, t2.start_point, $1 / 111320.0)
        AND ST_Distance(t1.end_point, t2.start_point) * 111320 <= $2
        
      UNION ALL
      
      SELECT 
        t1.trail_id as trail1_id,
        t1.trail_name as trail1_name,
        'end' as trail1_endpoint,
        t1.end_point as trail1_point,
        t1.end_coords as trail1_coords,
        t2.trail_id as trail2_id,
        t2.trail_name as trail2_name,
        'end' as trail2_endpoint,
        t2.end_point as trail2_point,
        t2.end_coords as trail2_coords,
        ST_Distance(t1.end_point, t2.end_point) * 111320 as distance_meters
      FROM trail_endpoints t1
      CROSS JOIN trail_endpoints t2
      WHERE t1.trail_id < t2.trail_id
        AND ST_DWithin(t1.end_point, t2.end_point, $1 / 111320.0)
        AND ST_Distance(t1.end_point, t2.end_point) * 111320 <= $2
    ),
    filtered_pairs AS (
      -- Filter out pairs that are already connected by existing trails
      SELECT ep.*
      FROM endpoint_pairs ep
      WHERE NOT EXISTS (
        SELECT 1 FROM ${schema}.trails t
        WHERE ST_DWithin(t.geometry, ep.trail1_point, 5 / 111320.0)
          AND ST_DWithin(t.geometry, ep.trail2_point, 5 / 111320.0)
          ${regionFilter ? `AND t.region = '${regionFilter}'` : ''}
      )
    )
    SELECT 
      'gap_' || trail1_id || '_' || trail1_endpoint || '_' || trail2_id || '_' || trail2_endpoint as id,
      trail1_id,
      trail1_name,
      trail1_endpoint,
      trail2_id,
      trail2_name,
      trail2_endpoint,
      distance_meters,
      ST_MakeLine(trail1_point, trail2_point) as gap_geometry,
      ST_X(trail1_point) as trail1_lng,
      ST_Y(trail1_point) as trail1_lat,
      ST_X(trail2_point) as trail2_lng,
      ST_Y(trail2_point) as trail2_lat,
      ST_Envelope(ST_Collect(trail1_point, trail2_point)) as bbox,
      -- Confidence score based on distance and name similarity
      CASE 
        WHEN distance_meters <= 20 THEN 0.9
        WHEN distance_meters <= 50 THEN 0.7
        WHEN distance_meters <= 100 THEN 0.5
        ELSE 0.3
      END * 
      CASE 
        WHEN trail1_name ILIKE '%' || trail2_name || '%' OR trail2_name ILIKE '%' || trail1_name || '%' THEN 1.0
        WHEN trail1_name ~ trail2_name OR trail2_name ~ trail1_name THEN 0.8
        ELSE 0.6
      END as confidence_score
    FROM filtered_pairs
    ORDER BY distance_meters, confidence_score DESC
  `, [config.maxGapDistanceMeters, config.maxGapDistanceMeters]);
  
  const gaps: TrailGap[] = result.rows.map(row => ({
    id: row.id,
    trail1_id: row.trail1_id,
    trail1_name: row.trail1_name,
    trail1_endpoint: row.trail1_endpoint,
    trail2_id: row.trail2_id,
    trail2_name: row.trail2_name,
    trail2_endpoint: row.trail2_endpoint,
    gap_distance_meters: row.distance_meters,
    gap_geometry: row.gap_geometry,
    trail1_coords: [row.trail1_lng, row.trail1_lat],
    trail2_coords: [row.trail2_lng, row.trail2_lat],
    bbox: [
      row.bbox_min_lng, row.bbox_min_lat,
      row.bbox_max_lng, row.bbox_max_lat
    ],
    confidence_score: row.confidence_score
  }));
  
  console.log(`🔍 Identified ${gaps.length} potential trail gaps`);
  return gaps;
}

/**
 * Query Overpass API for trail data in the gap area
 */
export async function queryOverpassForTrails(
  bbox: [number, number, number, number],
  expansionMeters: number
): Promise<ExternalTrailCandidate[]> {
  if (!process.env.ENABLE_OVERPASS_API) {
    console.log('⚠️ Overpass API disabled by environment variable');
    return [];
  }
  
  console.log(`🌐 Querying Overpass API for trails in bbox: [${bbox.join(', ')}]`);
  
  // Expand bbox by specified meters
  const expansionDegrees = expansionMeters / 111320;
  const expandedBbox = [
    bbox[0] - expansionDegrees,
    bbox[1] - expansionDegrees,
    bbox[2] + expansionDegrees,
    bbox[3] + expansionDegrees
  ];
  
  const overpassQuery = `
    [out:json][timeout:25];
    (
      way["highway"="path"](bbox);
      way["highway"="footway"](bbox);
      way["highway"="bridleway"](bbox);
      way["highway"="steps"](bbox);
      way["highway"="pedestrian"](bbox);
      way["leisure"="park"](bbox);
      way["landuse"="recreation_ground"](bbox);
    );
    out body;
    >;
    out skel qt;
  `.replace(/bbox/g, expandedBbox.join(','));
  
  try {
    const response = await axios.post('https://overpass-api.de/api/interpreter', overpassQuery, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000
    });
    
    const candidates: ExternalTrailCandidate[] = [];
    const data = response.data as any;
    
    if (data.elements) {
      for (const element of data.elements) {
        if (element.type === 'way' && element.geometry) {
          // Convert OSM way to LineString geometry
          const coordinates = element.geometry.map((node: any) => [node.lon, node.lat]);
          const geometry = {
            type: 'LineString',
            coordinates: coordinates
          };
          
          const lengthMeters = calculateLineStringLength(geometry);
          
          if (lengthMeters >= 10 && lengthMeters <= 5000) { // Reasonable trail length
            candidates.push({
              id: `overpass_${element.id}`,
              name: element.tags?.name || `Trail ${element.id}`,
              geometry: geometry,
              length_meters: lengthMeters,
              surface: element.tags?.surface,
              difficulty: element.tags?.difficulty,
              source: 'overpass',
              confidence: 0.7, // Base confidence for OSM data
              metadata: {
                osm_id: element.id,
                tags: element.tags,
                timestamp: new Date().toISOString()
              }
            });
          }
        }
      }
    }
    
    console.log(`🌐 Found ${candidates.length} trail candidates from Overpass API`);
    return candidates;
    
  } catch (error) {
    console.error('❌ Error querying Overpass API:', error);
    return [];
  }
}

/**
 * Calculate length of a LineString geometry in meters
 */
function calculateLineStringLength(geometry: any): number {
  if (geometry.type !== 'LineString' || !geometry.coordinates || geometry.coordinates.length < 2) {
    return 0;
  }
  
  let totalLength = 0;
  for (let i = 1; i < geometry.coordinates.length; i++) {
    const [lon1, lat1] = geometry.coordinates[i - 1];
    const [lon2, lat2] = geometry.coordinates[i];
    
    // Haversine formula for distance calculation
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    totalLength += R * c;
  }
  
  return totalLength;
}

/**
 * Main function to identify gaps and backfill with external data
 */
export async function backfillTrailGaps(
  pgClient: Pool,
  schema: string,
  config: GapBackfillConfig
): Promise<GapBackfillResult> {
  console.log('🔧 Starting trail gap backfill process...');
  
  // Step 1: Identify gaps
  const gaps = await identifyTrailGaps(pgClient, schema, config);
  
  if (gaps.length === 0) {
    console.log('✅ No trail gaps identified');
    return {
      gapsIdentified: 0,
      candidatesFound: 0,
      trailsAdded: 0,
      details: []
    };
  }
  
  const result: GapBackfillResult = {
    gapsIdentified: gaps.length,
    candidatesFound: 0,
    trailsAdded: 0,
    details: []
  };
  
  // Step 2: For each gap, query external APIs
  for (const gap of gaps) {
    console.log(`🔍 Processing gap: ${gap.trail1_name} → ${gap.trail2_name} (${gap.gap_distance_meters.toFixed(1)}m)`);
    
    const candidates: ExternalTrailCandidate[] = [];
    
    // Query Overpass API
    if (config.enableOverpass) {
      const overpassCandidates = await queryOverpassForTrails(gap.bbox, config.bboxExpansionMeters);
      candidates.push(...overpassCandidates);
    }
    
    // TODO: Add other API integrations here
    // - OpenStreetMap API
    // - Trail-specific APIs
    // - Government trail databases
    
    result.candidatesFound += candidates.length;
    
    // Step 3: Select best candidate and add to trails table
    const bestCandidate = selectBestCandidate(gap, candidates, config);
    
    if (bestCandidate && bestCandidate.confidence >= config.confidenceThreshold) {
      try {
        await addTrailFromCandidate(pgClient, schema, bestCandidate, gap);
        result.trailsAdded++;
        console.log(`✅ Added trail: ${bestCandidate.name} (${bestCandidate.length_meters.toFixed(1)}m)`);
      } catch (error) {
        console.error(`❌ Failed to add trail for gap ${gap.id}:`, error);
      }
    }
    
    result.details.push({
      gap,
      candidates,
      selectedCandidate: bestCandidate
    });
  }
  
  console.log(`📊 Gap backfill complete: ${result.gapsIdentified} gaps, ${result.candidatesFound} candidates, ${result.trailsAdded} trails added`);
  return result;
}

/**
 * Select the best candidate trail for a given gap
 */
function selectBestCandidate(
  gap: TrailGap,
  candidates: ExternalTrailCandidate[],
  config: GapBackfillConfig
): ExternalTrailCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  
  // Score candidates based on multiple factors
  const scoredCandidates = candidates.map(candidate => {
    let score = candidate.confidence;
    
    // Length preference (not too short, not too long)
    const lengthRatio = candidate.length_meters / gap.gap_distance_meters;
    if (lengthRatio >= 0.8 && lengthRatio <= 1.5) {
      score += 0.2; // Good length match
    } else if (lengthRatio >= 0.5 && lengthRatio <= 2.0) {
      score += 0.1; // Acceptable length
    }
    
    // Name similarity
    const nameSimilarity = calculateNameSimilarity(gap.trail1_name, candidate.name) +
                          calculateNameSimilarity(gap.trail2_name, candidate.name);
    score += nameSimilarity * 0.1;
    
    // Source preference
    if (candidate.source === 'overpass') {
      score += 0.05; // Slight preference for OSM data
    }
    
    return { candidate, score };
  });
  
  // Sort by score and return the best
  scoredCandidates.sort((a, b) => b.score - a.score);
  return scoredCandidates[0]?.candidate;
}

/**
 * Calculate similarity between two trail names
 */
function calculateNameSimilarity(name1: string, name2: string): number {
  const words1 = name1.toLowerCase().split(/\s+/);
  const words2 = name2.toLowerCase().split(/\s+/);
  
  const commonWords = words1.filter(word => words2.includes(word));
  return commonWords.length / Math.max(words1.length, words2.length);
}

/**
 * Add a candidate trail to the trails table with backfill metadata
 */
async function addTrailFromCandidate(
  pgClient: Pool,
  schema: string,
  candidate: ExternalTrailCandidate,
  gap: TrailGap
): Promise<void> {
  const geometrySql = `ST_GeomFromGeoJSON('${JSON.stringify(candidate.geometry)}')`;
  const backfillId = `backfill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const backfillTimestamp = new Date().toISOString();
  
  // Create metadata JSON
  const metadata: BackfilledTrailMetadata = {
    backfill_id: backfillId,
    backfill_timestamp: backfillTimestamp,
    gap_trail1_id: gap.trail1_id,
    gap_trail1_name: gap.trail1_name,
    gap_trail2_id: gap.trail2_id,
    gap_trail2_name: gap.trail2_name,
    gap_distance_meters: gap.gap_distance_meters,
    candidate_source: candidate.source,
    candidate_confidence: candidate.confidence,
    backfill_version: '1.0.0'
  };
  
  await pgClient.query(`
    INSERT INTO ${schema}.trails (
      app_uuid, name, trail_type, surface, difficulty,
      geometry, length_km, elevation_gain, elevation_loss,
      region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
      metadata
    )
    VALUES (
      $1, $2, $3, $4, $5, ${geometrySql}, $6, $7, $8, $9, $10, $11, $12, $13, $14
    )
  `, [
    candidate.id,
    candidate.name,
    'path', // Default trail type
    candidate.surface || 'unknown',
    candidate.difficulty || 'unknown',
    candidate.length_meters / 1000, // Convert to km
    0, // elevation_gain (unknown)
    0, // elevation_loss (unknown)
    'backfilled', // region
    candidate.geometry.coordinates[0][0], // bbox_min_lng
    candidate.geometry.coordinates[candidate.geometry.coordinates.length - 1][0], // bbox_max_lng
    Math.min(...candidate.geometry.coordinates.map((c: number[]) => c[1])), // bbox_min_lat
    Math.max(...candidate.geometry.coordinates.map((c: number[]) => c[1])), // bbox_max_lat
    JSON.stringify(metadata) // metadata
  ]);
}

/**
 * Query backfilled trails with optional filters
 */
export async function queryBackfilledTrails(
  pgClient: Pool,
  schema: string = 'public',
  options: {
    backfillId?: string;
    dateRange?: { start: string; end: string };
    confidenceThreshold?: number;
    source?: string;
    limit?: number;
  } = {}
): Promise<Array<{
  id: string;
  name: string;
  region: string;
  length_km: number;
  metadata: BackfilledTrailMetadata;
  created_at: string;
}>> {
  let whereClause = "region = 'backfilled'";
  const params: any[] = [];
  let paramIndex = 1;
  
  if (options.backfillId) {
    whereClause += ` AND metadata->>'backfill_id' = $${paramIndex++}`;
    params.push(options.backfillId);
  }
  
  if (options.dateRange) {
    whereClause += ` AND metadata->>'backfill_timestamp' >= $${paramIndex++} AND metadata->>'backfill_timestamp' <= $${paramIndex++}`;
    params.push(options.dateRange.start, options.dateRange.end);
  }
  
  if (options.confidenceThreshold !== undefined) {
    whereClause += ` AND CAST(metadata->>'candidate_confidence' AS FLOAT) >= $${paramIndex++}`;
    params.push(options.confidenceThreshold);
  }
  
  if (options.source) {
    whereClause += ` AND metadata->>'candidate_source' = $${paramIndex++}`;
    params.push(options.source);
  }
  
  const limitClause = options.limit ? `LIMIT ${options.limit}` : '';
  
  const result = await pgClient.query(`
    SELECT 
      id,
      name,
      region,
      length_km,
      metadata,
      created_at
    FROM ${schema}.trails
    WHERE ${whereClause}
    ORDER BY metadata->>'backfill_timestamp' DESC
    ${limitClause}
  `, params);
  
  return result.rows.map(row => ({
    ...row,
    metadata: JSON.parse(row.metadata)
  }));
}

/**
 * Delete backfilled trails by criteria
 */
export async function deleteBackfilledTrails(
  pgClient: Pool,
  schema: string = 'public',
  criteria: {
    backfillId?: string;
    dateRange?: { start: string; end: string };
    confidenceThreshold?: number;
    source?: string;
  } = {}
): Promise<{ deletedCount: number }> {
  let whereClause = "region = 'backfilled'";
  const params: any[] = [];
  let paramIndex = 1;
  
  if (criteria.backfillId) {
    whereClause += ` AND metadata->>'backfill_id' = $${paramIndex++}`;
    params.push(criteria.backfillId);
  }
  
  if (criteria.dateRange) {
    whereClause += ` AND metadata->>'backfill_timestamp' >= $${paramIndex++} AND metadata->>'backfill_timestamp' <= $${paramIndex++}`;
    params.push(criteria.dateRange.start, criteria.dateRange.end);
  }
  
  if (criteria.confidenceThreshold !== undefined) {
    whereClause += ` AND CAST(metadata->>'candidate_confidence' AS FLOAT) >= $${paramIndex++}`;
    params.push(criteria.confidenceThreshold);
  }
  
  if (criteria.source) {
    whereClause += ` AND metadata->>'candidate_source' = $${paramIndex++}`;
    params.push(criteria.source);
  }
  
  const result = await pgClient.query(`
    DELETE FROM ${schema}.trails
    WHERE ${whereClause}
    RETURNING id
  `, params);
  
  return { deletedCount: result.rowCount || 0 };
}

/**
 * Get statistics about backfilled trails
 */
export async function getBackfilledTrailStats(
  pgClient: Pool,
  schema: string = 'public'
): Promise<{
  totalBackfilled: number;
  bySource: Record<string, number>;
  byConfidence: {
    high: number; // >= 0.8
    medium: number; // 0.6-0.8
    low: number; // < 0.6
  };
  averageLength: number;
  totalLength: number;
}> {
  const result = await pgClient.query(`
    SELECT 
      COUNT(*) as total_count,
      AVG(length_km) as avg_length,
      SUM(length_km) as total_length,
      metadata->>'candidate_source' as source,
      metadata->>'candidate_confidence' as confidence
    FROM ${schema}.trails
    WHERE region = 'backfilled'
    GROUP BY metadata->>'candidate_source', metadata->>'candidate_confidence'
  `);
  
  const stats = {
    totalBackfilled: 0,
    bySource: {} as Record<string, number>,
    byConfidence: { high: 0, medium: 0, low: 0 },
    averageLength: 0,
    totalLength: 0
  };
  
  let totalLength = 0;
  let totalCount = 0;
  
  result.rows.forEach(row => {
    const count = parseInt(row.total_count);
    const length = parseFloat(row.avg_length) * count;
    const confidence = parseFloat(row.confidence);
    const source = row.source;
    
    stats.totalBackfilled += count;
    totalLength += length;
    totalCount += count;
    
    stats.bySource[source] = (stats.bySource[source] || 0) + count;
    
    if (confidence >= 0.8) {
      stats.byConfidence.high += count;
    } else if (confidence >= 0.6) {
      stats.byConfidence.medium += count;
    } else {
      stats.byConfidence.low += count;
    }
  });
  
  stats.averageLength = totalCount > 0 ? totalLength / totalCount : 0;
  stats.totalLength = totalLength;
  
  return stats;
}

/**
 * Export backfill candidates and gaps as GeoJSON for visualization
 */
export async function exportBackfillVisualization(
  pgClient: Pool,
  schema: string,
  gaps: TrailGap[],
  config: GapBackfillConfig,
  vizConfig: VisualizationConfig = {}
): Promise<string> {
  console.log('🎨 Generating backfill visualization GeoJSON...');
  
  const features: any[] = [];
  const outputPath = vizConfig.outputPath || `backfill-candidates-${Date.now()}.geojson`;
  
  // Add existing trails if requested
  if (vizConfig.includeExistingTrails) {
    console.log('📊 Adding existing trails to visualization...');
    const existingTrails = await pgClient.query(`
      SELECT 
        id,
        name,
        ST_AsGeoJSON(geometry) as geometry,
        trail_type,
        surface,
        region
      FROM ${schema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    existingTrails.rows.forEach(trail => {
      features.push({
        type: 'Feature',
        geometry: JSON.parse(trail.geometry),
        properties: {
          id: trail.id,
          name: trail.name,
          trail_type: trail.trail_type,
          surface: trail.surface,
          region: trail.region,
          type: 'existing_trail',
          color: '#2E8B57', // Sea green for existing trails
          weight: 3,
          opacity: 0.8
        }
      });
    });
  }
  
  // Add gap lines
  if (vizConfig.includeGaps) {
    console.log('🔗 Adding gap connections to visualization...');
    gaps.forEach((gap, index) => {
      // Create a line between the gap endpoints
      const gapGeometry = {
        type: 'LineString',
        coordinates: [gap.trail1_coords, gap.trail2_coords]
      };
      
      features.push({
        type: 'Feature',
        geometry: gapGeometry,
        properties: {
          id: `gap_${index}`,
          name: `Gap: ${gap.trail1_name} → ${gap.trail2_name}`,
          gap_distance_meters: gap.gap_distance_meters,
          confidence_score: gap.confidence_score,
          trail1_name: gap.trail1_name,
          trail2_name: gap.trail2_name,
          type: 'gap',
          color: '#FF6B6B', // Red for gaps
          weight: 2,
          opacity: 0.6,
          dashArray: '5,5' // Dashed line
        }
      });
      
      // Add gap endpoint markers
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: gap.trail1_coords
        },
        properties: {
          id: `gap_endpoint_${index}_1`,
          name: `${gap.trail1_name} (${gap.trail1_endpoint})`,
          type: 'gap_endpoint',
          color: '#FF4500', // Orange red
          radius: 8
        }
      });
      
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: gap.trail2_coords
        },
        properties: {
          id: `gap_endpoint_${index}_2`,
          name: `${gap.trail2_name} (${gap.trail2_endpoint})`,
          type: 'gap_endpoint',
          color: '#FF4500', // Orange red
          radius: 8
        }
      });
    });
  }
  
  // Add candidate trails
  if (vizConfig.exportCandidates) {
    console.log('🔍 Adding candidate trails to visualization...');
    
    for (const gap of gaps) {
      try {
        const candidates = await queryOverpassForTrails(gap.bbox, config.bboxExpansionMeters);
        const validCandidates = candidates.filter(candidate => 
          candidate.length_meters >= config.minCandidateLengthMeters &&
          candidate.length_meters <= config.maxCandidateLengthMeters
        );
        
        validCandidates.forEach((candidate, candidateIndex) => {
          const confidence = candidate.confidence;
          const score = selectBestCandidate(gap, [candidate], config) ? 'selected' : 'rejected';
          
          // Determine color based on confidence and selection
          let color = '#FFD700'; // Gold for candidates
          let weight = 2;
          let opacity = 0.7;
          
          if (score === 'selected') {
            color = '#32CD32'; // Lime green for selected
            weight = 4;
            opacity = 0.9;
          } else if (confidence < config.confidenceThreshold) {
            color = '#FFB6C1'; // Light pink for low confidence
            opacity = 0.4;
          }
          
          features.push({
            type: 'Feature',
            geometry: candidate.geometry,
            properties: {
              id: `candidate_${gap.id}_${candidateIndex}`,
              name: candidate.name,
              length_meters: candidate.length_meters,
              source: candidate.source,
              confidence: confidence,
              score: score,
              gap_id: gap.id,
              gap_trail1: gap.trail1_name,
              gap_trail2: gap.trail2_name,
              gap_distance: gap.gap_distance_meters,
              type: 'candidate',
              color: color,
              weight: weight,
              opacity: opacity,
              dashArray: score === 'selected' ? null : '3,3' // Dashed for non-selected
            }
          });
        });
      } catch (error) {
        console.warn(`⚠️ Error querying candidates for gap ${gap.id}:`, error);
      }
    }
  }
  
  // Add connectivity analysis if requested
  let connectivityAnalysis = null;
  if (vizConfig.includeConnectivityAnalysis) {
    console.log('🔗 Including connectivity analysis in visualization...');
    connectivityAnalysis = await analyzeConnectivityImpact(pgClient, schema, gaps, config);
  }
  
  // Create GeoJSON structure
  const geojson = {
    type: 'FeatureCollection',
    features: features,
    properties: {
      generated_at: new Date().toISOString(),
      total_features: features.length,
      gaps_count: gaps.length,
      config: {
        maxGapDistanceMeters: config.maxGapDistanceMeters,
        confidenceThreshold: config.confidenceThreshold,
        bboxExpansionMeters: config.bboxExpansionMeters
      },
      connectivity_analysis: connectivityAnalysis,
      legend: {
        existing_trail: { color: '#2E8B57', description: 'Existing trails' },
        gap: { color: '#FF6B6B', description: 'Gap connections (dashed)' },
        gap_endpoint: { color: '#FF4500', description: 'Gap endpoints' },
        candidate_selected: { color: '#32CD32', description: 'Selected candidates' },
        candidate_rejected: { color: '#FFD700', description: 'Rejected candidates' },
        candidate_low_confidence: { color: '#FFB6C1', description: 'Low confidence candidates' }
      }
    }
  };
  
  // Write to file
  const fs = require('fs');
  fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
  
  console.log(`✅ Visualization exported to: ${outputPath}`);
  console.log(`📊 Features: ${features.length} total`);
  console.log(`🔗 Gaps: ${gaps.length}`);
  
  return outputPath;
}

/**
 * Measure network connectivity using the same method as the orchestrator
 * This requires the network to be preprocessed into pgRouting format
 * to get accurate connectivity measurements that match the orchestrator
 */
async function measureTrailConnectivity(
  pgClient: Pool,
  schema: string,
  additionalTrails: Array<{ geometry: any; id: string }> = []
): Promise<{
  totalNodes: number;
  reachableNodes: number;
  connectivityPercentage: number;
  isolatedComponents: number;
}> {
  try {
    // Check if the pgRouting tables exist (ways_noded, ways_noded_vertices_pgr)
    const tablesExist = await pgClient.query(`
      SELECT 
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded') as ways_noded_exists,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ways_noded_vertices_pgr') as vertices_exists
    `, [schema]);
    
    const waysNodedExists = tablesExist.rows[0].ways_noded_exists;
    const verticesExists = tablesExist.rows[0].vertices_exists;
    
    if (!waysNodedExists || !verticesExists) {
      console.warn('⚠️ pgRouting tables not found. Using simplified connectivity analysis.');
      console.warn('   For accurate connectivity measurements, run the orchestrator first to create pgRouting network.');
      
      // Fallback to simplified analysis
      return await measureSimplifiedConnectivity(pgClient, schema, additionalTrails);
    }
    
    // Use the same connectivity measurement as the orchestrator
    // This works on the edges layer (ways_noded + ways_noded_vertices_pgr)
    const result = await pgClient.query(`
      WITH connectivity_check AS (
        SELECT 
          COUNT(DISTINCT node) as reachable_nodes,
          (SELECT COUNT(*) FROM ${schema}.ways_noded_vertices_pgr) as total_nodes
        FROM pgr_dijkstra(
          'SELECT id, source, target, length_km as cost FROM ${schema}.ways_noded',
          (SELECT id FROM ${schema}.ways_noded_vertices_pgr LIMIT 1),
          (SELECT array_agg(id) FROM ${schema}.ways_noded_vertices_pgr),
          false
        )
      )
      SELECT 
        reachable_nodes,
        total_nodes,
        CASE 
          WHEN total_nodes > 0 THEN (reachable_nodes::float / total_nodes) * 100
          ELSE 0
        END as connectivity_percentage
      FROM connectivity_check
    `);
    
    const reachableNodes = parseInt(result.rows[0].reachable_nodes);
    const totalNodes = parseInt(result.rows[0].total_nodes);
    const connectivityPercentage = parseFloat(result.rows[0].connectivity_percentage);
    
    // Get component count using pgr_connectedComponents
    const componentsResult = await pgClient.query(`
      SELECT COUNT(DISTINCT component) as component_count
      FROM pgr_connectedComponents(
        'SELECT id, source, target, length_km * 1000 as cost FROM ${schema}.ways_noded'
      )
    `);
    
    const isolatedComponents = parseInt(componentsResult.rows[0].component_count);
    
    return {
      totalNodes,
      reachableNodes,
      connectivityPercentage,
      isolatedComponents
    };
    
  } catch (error) {
    console.warn('⚠️ Failed to measure network connectivity:', error);
    return {
      totalNodes: 0,
      reachableNodes: 0,
      connectivityPercentage: 0,
      isolatedComponents: 0
    };
  }
}

/**
 * Simplified connectivity analysis for when pgRouting tables don't exist
 */
async function measureSimplifiedConnectivity(
  pgClient: Pool,
  schema: string,
  additionalTrails: Array<{ geometry: any; id: string }> = []
): Promise<{
  totalNodes: number;
  reachableNodes: number;
  connectivityPercentage: number;
  isolatedComponents: number;
}> {
  // Create a temporary table with current trails + additional trails
  const tempTableName = `temp_connectivity_${Date.now()}`;
  
  try {
    // Create temp table with existing trails
    await pgClient.query(`
      CREATE TEMP TABLE ${tempTableName} AS
      SELECT id, name, geometry, region
      FROM ${schema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    // Add additional trails if provided (for "after backfill" simulation)
    if (additionalTrails.length > 0) {
      for (const trail of additionalTrails) {
        await pgClient.query(`
          INSERT INTO ${tempTableName} (id, name, geometry, region)
          VALUES ($1, $2, ST_GeomFromGeoJSON($3), 'backfilled')
        `, [trail.id, `Backfilled_${trail.id}`, JSON.stringify(trail.geometry)]);
      }
    }
    
    // Use PostGIS spatial clustering to find connected components
    const connectivityResult = await pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          id as trail_id,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${tempTableName}
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      all_points AS (
        SELECT trail_id, start_point as point FROM trail_endpoints
        UNION ALL
        SELECT trail_id, end_point as point FROM trail_endpoints
      ),
      clustered_points AS (
        SELECT 
          point,
          ST_ClusterDBSCAN(point, 10, 1) OVER () as cluster_id
        FROM all_points
      ),
      connectivity_analysis AS (
        SELECT 
          cluster_id,
          COUNT(*) as nodes_in_cluster,
          COUNT(DISTINCT point) as unique_nodes
        FROM clustered_points
        GROUP BY cluster_id
      )
      SELECT 
        COUNT(*) as total_clusters,
        SUM(nodes_in_cluster) as total_nodes,
        COUNT(CASE WHEN nodes_in_cluster > 1 THEN 1 END) as connected_clusters,
        SUM(CASE WHEN nodes_in_cluster > 1 THEN nodes_in_cluster ELSE 0 END) as connected_nodes
      FROM connectivity_analysis
    `);
    
    const analysis = connectivityResult.rows[0];
    const totalNodes = parseInt(analysis.total_nodes);
    const connectedNodes = parseInt(analysis.connected_nodes);
    const totalClusters = parseInt(analysis.total_clusters);
    const connectedClusters = parseInt(analysis.connected_clusters);
    
    // Calculate connectivity percentage based on connected nodes
    const connectivityPercentage = totalNodes > 0 ? (connectedNodes / totalNodes) * 100 : 0;
    
    return {
      totalNodes: totalNodes,
      reachableNodes: connectedNodes,
      connectivityPercentage: connectivityPercentage,
      isolatedComponents: totalClusters - connectedClusters
    };
    
  } finally {
    // Clean up temp table
    await pgClient.query(`DROP TABLE IF EXISTS ${tempTableName} CASCADE`);
  }
}

/**
 * Analyze connectivity impact of backfill candidates
 */
export async function analyzeConnectivityImpact(
  pgClient: Pool,
  schema: string,
  gaps: TrailGap[],
  config: GapBackfillConfig
): Promise<ConnectivityAnalysis> {
  console.log('🔗 Analyzing connectivity impact of backfill candidates...');
  
  // Measure connectivity before backfill
  console.log('📊 Measuring current connectivity...');
  const beforeBackfill = await measureTrailConnectivity(pgClient, schema);
  
  // Collect all selected candidates
  const selectedCandidates: Array<{ geometry: any; id: string }> = [];
  
  for (const gap of gaps) {
    try {
      const candidates = await queryOverpassForTrails(gap.bbox, config.bboxExpansionMeters);
      const validCandidates = candidates.filter(candidate => 
        candidate.length_meters >= config.minCandidateLengthMeters &&
        candidate.length_meters <= config.maxCandidateLengthMeters
      );
      
      const bestCandidate = selectBestCandidate(gap, validCandidates, config);
      if (bestCandidate) {
        selectedCandidates.push({
          geometry: bestCandidate.geometry,
          id: bestCandidate.id
        });
      }
    } catch (error) {
      console.warn(`⚠️ Error analyzing candidates for gap ${gap.id}:`, error);
    }
  }
  
  // Measure connectivity after backfill (simulated)
  console.log(`📊 Simulating connectivity with ${selectedCandidates.length} additional trails...`);
  const afterBackfill = await measureTrailConnectivity(pgClient, schema, selectedCandidates);
  
  // Calculate improvements
  const improvement = {
    percentageIncrease: afterBackfill.connectivityPercentage - beforeBackfill.connectivityPercentage,
    additionalReachableNodes: afterBackfill.reachableNodes - beforeBackfill.reachableNodes,
    componentsReduced: beforeBackfill.isolatedComponents - afterBackfill.isolatedComponents
  };
  
  const analysis: ConnectivityAnalysis = {
    beforeBackfill,
    afterBackfill,
    improvement
  };
  
  console.log('📈 Connectivity Analysis Results:');
  console.log(`   Before: ${beforeBackfill.connectivityPercentage.toFixed(1)}% (${beforeBackfill.reachableNodes}/${beforeBackfill.totalNodes} nodes, ${beforeBackfill.isolatedComponents} components)`);
  console.log(`   After:  ${afterBackfill.connectivityPercentage.toFixed(1)}% (${afterBackfill.reachableNodes}/${afterBackfill.totalNodes} nodes, ${afterBackfill.isolatedComponents} components)`);
  console.log(`   Improvement: +${improvement.percentageIncrease.toFixed(1)}% connectivity, +${improvement.additionalReachableNodes} reachable nodes, -${improvement.componentsReduced} isolated components`);
  
  return analysis;
}

/**
 * Compare Overpass API trails with existing trails in the database
 * Identifies and adds missing trails with backfill tags
 */
export async function compareAndBackfillMissingTrails(
  pgClient: Pool,
  schema: string,
  bbox: [number, number, number, number],
  region: string,
  config: GapBackfillConfig
): Promise<{
  overpassTrails: Array<{ id: string; name: string; length_meters: number }>;
  existingTrails: Array<{ id: string; name: string; length_meters: number }>;
  addedTrails: Array<{ id: string; name: string; length_meters: number }>;
  summary: {
    totalOverpassTrails: number;
    totalExistingTrails: number;
    addedTrailsCount: number;
    coveragePercentage: number;
  };
}> {
  console.log('🔍 Starting Overpass API comparison with database...');
  console.log(`📍 Bbox: [${bbox.join(', ')}]`);
  console.log(`🌍 Region: ${region}`);
  console.log(`📏 Bbox expansion: ${config.bboxExpansionMeters}m`);
  
  // Step 1: Query Overpass API
  console.log('\n📡 Step 1: Querying Overpass API for trails...');
  console.log('   ⏳ Sending request to Overpass API...');
  const startTime = Date.now();
  const overpassTrails = await queryOverpassForTrails(bbox, config.bboxExpansionMeters);
  const apiTime = Date.now() - startTime;
  console.log(`   ✅ Overpass API response received in ${apiTime}ms`);
  console.log(`   📊 Found ${overpassTrails.length} trails from Overpass API`);
  
  if (overpassTrails.length > 0) {
    console.log('   📋 Sample trails from Overpass:');
    overpassTrails.slice(0, 3).forEach((trail, index) => {
      console.log(`      ${index + 1}. ${trail.name || trail.id} (${trail.length_meters.toFixed(1)}m)`);
    });
    if (overpassTrails.length > 3) {
      console.log(`      ... and ${overpassTrails.length - 3} more`);
    }
  }
  
  // Step 2: Query existing trails from database
  console.log('\n🗄️ Step 2: Querying existing trails from database...');
  console.log(`   🔍 Searching in schema: ${schema}`);
  console.log(`   📍 Using bbox: [${bbox.join(', ')}]`);
  
  const dbStartTime = Date.now();
  const existingTrailsResult = await pgClient.query(`
    SELECT 
      id,
      name,
      ST_Length(geometry::geography) as length_meters
    FROM ${schema}.trails
    WHERE geometry IS NOT NULL 
      AND ST_IsValid(geometry)
      AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
  `, [bbox[0], bbox[1], bbox[2], bbox[3]]);
  const dbTime = Date.now() - dbStartTime;
  
  const existingTrails = existingTrailsResult.rows.map(row => ({
    id: row.id,
    name: row.name,
    length_meters: parseFloat(row.length_meters)
  }));
  
  console.log(`   ✅ Database query completed in ${dbTime}ms`);
  console.log(`   📊 Found ${existingTrails.length} existing trails in database`);
  
  if (existingTrails.length > 0) {
    console.log('   📋 Sample existing trails:');
    existingTrails.slice(0, 3).forEach((trail, index) => {
      console.log(`      ${index + 1}. ${trail.name || trail.id} (${trail.length_meters.toFixed(1)}m)`);
    });
    if (existingTrails.length > 3) {
      console.log(`      ... and ${existingTrails.length - 3} more`);
    }
  }
  
  // Step 3: Find missing trails
  console.log('\n🔍 Step 3: Comparing trails to find missing ones...');
  const existingTrailIds = new Set(existingTrails.map(t => t.id));
  const missingTrails = overpassTrails.filter(trail => !existingTrailIds.has(trail.id));
  
  console.log(`   📊 Comparison results:`);
  console.log(`      Overpass trails: ${overpassTrails.length}`);
  console.log(`      Database trails: ${existingTrails.length}`);
  console.log(`      Missing trails: ${missingTrails.length}`);
  
  if (missingTrails.length > 0) {
    console.log('   📋 Missing trails:');
    missingTrails.forEach((trail, index) => {
      console.log(`      ${index + 1}. ${trail.name || trail.id} (${trail.length_meters.toFixed(1)}m)`);
    });
  }
  
  // Step 4: Add missing trails to database
  const addedTrails: Array<{ id: string; name: string; length_meters: number }> = [];
  
  if (missingTrails.length > 0) {
    console.log('\n💾 Step 4: Adding missing trails to database...');
    console.log(`   🚀 Starting to add ${missingTrails.length} trails...`);
    
    for (let i = 0; i < missingTrails.length; i++) {
      const trail = missingTrails[i];
      console.log(`   📝 Processing trail ${i + 1}/${missingTrails.length}: ${trail.name || trail.id}`);
      
      try {
        // Create backfill metadata
        const backfillMetadata: BackfilledTrailMetadata = {
          backfill_id: `overpass_${trail.id}_${Date.now()}`,
          backfill_timestamp: new Date().toISOString(),
          gap_trail1_id: 'overpass_comparison',
          gap_trail1_name: 'Overpass API Comparison',
          gap_trail2_id: 'database_comparison',
          gap_trail2_name: 'Database Comparison',
          gap_distance_meters: 0,
          candidate_source: 'overpass_api',
          candidate_confidence: trail.confidence || 0.8,
          backfill_version: '1.0'
        };
        
        console.log(`      📋 Creating metadata for trail ${trail.id}...`);
        
        // Add trail to database
        console.log(`      💾 Inserting into database...`);
        const insertStartTime = Date.now();
        await pgClient.query(`
          INSERT INTO ${schema}.trails (
            id, name, geometry, region, metadata, 
            length_km, elevation_gain, elevation_loss,
            created_at, updated_at
          ) VALUES (
            $1, $2, ST_GeomFromGeoJSON($3), $4, $5,
            $6, $7, $8,
            NOW(), NOW()
          )
        `, [
          trail.id,
          trail.name || `Overpass Trail ${trail.id}`,
          JSON.stringify(trail.geometry),
          region,
          JSON.stringify(backfillMetadata),
          trail.length_meters / 1000, // Convert to km
          0, // elevation_gain (not available from Overpass)
          0, // elevation_loss (not available from Overpass)
        ]);
        const insertTime = Date.now() - insertStartTime;
        
        addedTrails.push({
          id: trail.id,
          name: trail.name || `Overpass Trail ${trail.id}`,
          length_meters: trail.length_meters
        });
        
        console.log(`      ✅ Successfully added trail in ${insertTime}ms: ${trail.name || trail.id} (${trail.length_meters.toFixed(1)}m)`);
        
      } catch (error) {
        console.warn(`      ❌ Failed to add trail ${trail.id}:`, error);
      }
    }
    
    console.log(`   🎉 Database insertion completed!`);
    console.log(`   📊 Successfully added ${addedTrails.length}/${missingTrails.length} trails`);
  } else {
    console.log('\n✅ Step 4: No missing trails to add!');
  }
  
  // Step 5: Calculate and display summary
  console.log('\n📊 Step 5: Final Summary');
  const totalOverpassTrails = overpassTrails.length;
  const totalExistingTrails = existingTrails.length;
  const addedTrailsCount = addedTrails.length;
  const coveragePercentage = totalOverpassTrails > 0 ? 
    ((totalOverpassTrails - missingTrails.length) / totalOverpassTrails) * 100 : 100;
  
  console.log(`   📈 Results:`);
  console.log(`      Overpass API trails: ${totalOverpassTrails}`);
  console.log(`      Existing database trails: ${totalExistingTrails}`);
  console.log(`      Added trails: ${addedTrailsCount}`);
  console.log(`      Coverage: ${coveragePercentage.toFixed(1)}%`);
  console.log(`   ⏱️ Performance:`);
  console.log(`      API query time: ${apiTime}ms`);
  console.log(`      Database query time: ${dbTime}ms`);
  console.log(`      Total processing time: ${Date.now() - startTime}ms`);
  
  return {
    overpassTrails: overpassTrails.map(t => ({ id: t.id, name: t.name, length_meters: t.length_meters })),
    existingTrails,
    addedTrails,
    summary: {
      totalOverpassTrails,
      totalExistingTrails,
      addedTrailsCount,
      coveragePercentage
    }
  };
}
