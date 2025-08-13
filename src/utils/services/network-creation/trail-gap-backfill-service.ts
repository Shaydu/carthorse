import { Pool, PoolClient } from 'pg';
import axios from 'axios';
import { OverpassBbox } from '../../../types';

export interface OverpassTrail {
  type: string;
  properties: {
    name?: string;
    highway?: string;
    surface?: string;
    [key: string]: any;
  };
  geometry: {
    type: string;
    coordinates: number[][];
  };
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

export interface TrailGap {
  id: string;
  trail1_id: string;
  trail1_name: string;
  trail1_endpoint: string;
  trail1_coords: [number, number];
  trail2_id: string;
  trail2_name: string;
  trail2_endpoint: string;
  trail2_coords: [number, number];
  gap_distance_meters: number;
  confidence_score: number;
  bbox: [number, number, number, number];
}

export interface VisualizationConfig {
  exportCandidates?: boolean;
  outputPath?: string;
  includeGaps?: boolean;
  includeExistingTrails?: boolean;
  includeConnectivityAnalysis?: boolean;
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

export interface TrailEndpoint {
  lng: number;
  lat: number;
  app_uuid: string;
  name: string;
  endpoint_type: string;
  length_meters: number;
}

export class TrailGapBackfillService {
  constructor(
    private pgClient: Pool | PoolClient,
    private stagingSchema: string
  ) {}

  /**
   * Find isolated trail endpoints that might need connections
   */
  async findIsolatedEndpoints(): Promise<TrailEndpoint[]> {
    const result = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          id,
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          ST_Length(geometry::geography) as length_meters
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      all_endpoints AS (
        SELECT id, app_uuid, name, start_point as point, 'start' as endpoint_type, length_meters
        FROM trail_endpoints
        UNION ALL
        SELECT id, app_uuid, name, end_point as point, 'end' as endpoint_type, length_meters
        FROM trail_endpoints
      ),
      isolated_endpoints AS (
        SELECT 
          ae1.point,
          ae1.app_uuid,
          ae1.name,
          ae1.endpoint_type,
          ae1.length_meters,
          COUNT(ae2.point) as nearby_endpoints
        FROM all_endpoints ae1
        LEFT JOIN all_endpoints ae2 ON 
          ae1.point != ae2.point 
          AND ST_DWithin(ae1.point, ae2.point, 0.001) -- Within ~100m
        GROUP BY ae1.point, ae1.app_uuid, ae1.name, ae1.endpoint_type, ae1.length_meters
        HAVING COUNT(ae2.point) = 0
      )
      SELECT 
        ST_X(point) as lng,
        ST_Y(point) as lat,
        app_uuid,
        name,
        endpoint_type,
        length_meters
      FROM isolated_endpoints
      ORDER BY length_meters DESC
      LIMIT 10
    `);

    return result.rows;
  }

  /**
   * Query Overpass API for trails in the specified bbox
   */
  async queryOverpassForTrails(minLng: number, minLat: number, maxLng: number, maxLat: number): Promise<OverpassTrail[]> {
    // Check if Overpass backfill is enabled
    const { GLOBAL_CONFIG } = await import('../../../config/carthorse.global.config');
    const config = GLOBAL_CONFIG.overpassBackfill;
    
    if (!config.enabled) {
      console.log('   ⏭️ Overpass backfill is disabled in configuration');
      return [];
    }

    // Build dynamic query based on configuration
    // Convert to Overpass bbox format [south, west, north, east]
    const overpassBbox = toOverpassBbox([minLng, minLat, maxLng, maxLat]);
    const [south, west, north, east] = overpassBbox;
    
    const trailTypeQueries = config.trailTypes.map(trailType => {
      const surfaceExclusions = config.excludeSurfaces.map(surface => `["surface"!="${surface}"]`).join('');
      return `way["highway"="${trailType}"]${surfaceExclusions}(${south},${west},${north},${east});`;
    }).join('\n        ');

    const overpassQuery = `
      [out:json][timeout:${config.timeoutSeconds}];
      (
        ${trailTypeQueries}
      );
      out body;
      >;
      out skel qt;
    `;

    try {
      console.log(`   🌐 Querying Overpass API for bbox: [${minLng}, ${minLat}, ${maxLng}, ${maxLat}]`);
      console.log(`   📋 Trail types: ${config.trailTypes.join(', ')}`);
      console.log(`   🚫 Excluding surfaces: ${config.excludeSurfaces.join(', ')}`);
      
      const response = await axios.get('https://overpass-api.de/api/interpreter', {
        params: { data: overpassQuery },
        timeout: config.timeoutSeconds * 1000
      });

      if (response.data && (response.data as any).elements) {
        const trails: OverpassTrail[] = [];
        
        // Process ways and their nodes
        const ways = (response.data as any).elements.filter((el: any) => el.type === 'way');
        const nodes = (response.data as any).elements.filter((el: any) => el.type === 'node');
        const nodeMap = new Map(nodes.map((node: any) => [node.id, node]));

        for (const way of ways) {
          if (way.nodes && way.nodes.length >= 2) {
                      const coordinates = way.nodes.map((nodeId: number) => {
            const node = nodeMap.get(nodeId) as any;
            return node ? [node.lon, node.lat] : null;
          }).filter(Boolean);

            if (coordinates.length >= 2) {
              trails.push({
                type: 'Feature',
                properties: {
                  name: way.tags?.name || way.tags?.ref || 'Unnamed Trail',
                  highway: way.tags?.highway,
                  surface: way.tags?.surface,
                  ...way.tags
                },
                geometry: {
                  type: 'LineString',
                  coordinates
                }
              });
            }
          }
        }

        return trails;
      }

      return [];
    } catch (error) {
      console.error('   ❌ Error querying Overpass API:', error);
      return [];
    }
  }

  /**
   * Insert a trail from Overpass data into the staging schema
   */
  async insertTrailFromOverpass(trail: OverpassTrail): Promise<void> {
    if (!trail.geometry || !trail.geometry.coordinates || trail.geometry.coordinates.length < 2) {
      throw new Error('Invalid trail geometry');
    }

    // Convert coordinates to 3D if needed and ensure consistent dimensionality
    const coordinates3D = trail.geometry.coordinates.map(coord => {
      if (coord.length === 2) {
        return [...coord, 0]; // Add Z=0 for 2D coordinates
      } else if (coord.length === 3) {
        return coord; // Keep 3D coordinates as-is
      } else {
        throw new Error(`Invalid coordinate dimension: ${coord.length}`);
      }
    });

    const geometryWkt = `LINESTRING Z (${coordinates3D.map(coord => coord.join(' ')).join(', ')})`;

    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid,
        name,
        region,
        geometry,
        length_km,
        elevation_gain,
        elevation_loss,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        'boulder',
        ST_GeomFromText($2, 4326),
        ST_Length(ST_GeomFromText($2, 4326)::geography) / 1000,
        0,
        0,
        NOW(),
        NOW()
      )
    `, [
      trail.properties.name || 'Unnamed Trail',
      geometryWkt
    ]);
  }

  /**
   * Comprehensive trail backfill: Add all missing trails from Overpass API
   */
  async fillTrailGaps(bbox: number[]): Promise<number> {
    if (!bbox || bbox.length !== 4) {
      console.log('   ⚠️ No bbox specified, skipping trail backfill');
      return 0;
    }

    // Check if Overpass backfill is enabled
    const { GLOBAL_CONFIG } = await import('../../../config/carthorse.global.config');
    const config = GLOBAL_CONFIG.overpassBackfill;
    
    if (!config.enabled) {
      console.log('   ⏭️ Overpass backfill is disabled in configuration');
      return 0;
    }

    // bbox format is [minLng, minLat, maxLng, maxLat]
    const [minLng, minLat, maxLng, maxLat] = bbox;
    console.log(`   🗺️ Bbox: [${minLng}, ${minLat}, ${maxLng}, ${maxLat}]`);

    try {
      // Step 1: Query Overpass API for ALL trails in the bbox
      console.log('   🌐 Querying Overpass API for all trails in bbox...');
      // Overpass API expects (south, west, north, east) format
      const overpassTrails = await this.queryOverpassForTrails(minLng, minLat, maxLng, maxLat);
      console.log(`   📊 Found ${overpassTrails.length} trails from Overpass API`);

      if (overpassTrails.length === 0) {
        console.log('   ⚠️ No trails found in Overpass API for this bbox');
        return 0;
      }

      // Step 2: Get existing trails in the bbox
      const existingTrailsResult = await this.pgClient.query(`
        SELECT 
          id,
          name,
          ST_AsGeoJSON(geometry) as geometry,
          ST_Length(geometry::geography) as length_meters
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      `, [minLng, minLat, maxLng, maxLat]);

      const existingTrails = existingTrailsResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        geometry: JSON.parse(row.geometry),
        length_meters: parseFloat(row.length_meters)
      }));

      console.log(`   📊 Found ${existingTrails.length} existing trails in database`);

      // Step 3: Find missing trails by comparing geometries
      const missingTrails = await this.findMissingTrails(overpassTrails, existingTrails);
      console.log(`   🔍 Found ${missingTrails.length} missing trails from Overpass API`);

      // Step 4: Add all missing trails
      let trailsAdded = 0;
      for (const trail of missingTrails) {
        try {
          await this.insertTrailFromOverpass(trail);
          trailsAdded++;
          console.log(`   ✅ Added missing trail: ${trail.properties.name || 'Unnamed'} (${trail.geometry.coordinates.length} points)`);
        } catch (error) {
          console.log(`   ⚠️ Failed to add trail: ${error instanceof Error ? error.message : 'Unknown error'}`);
          if (error instanceof Error && error.message.includes('dimensionality')) {
            console.log(`   🔍 Debug: Trail coordinates: ${JSON.stringify(trail.geometry.coordinates.slice(0, 3))}...`);
          }
        }
      }

      // Step 5: Find and fill any remaining gaps
      const gapsFilled = await this.fillRemainingGaps();
      const totalAdded = trailsAdded + gapsFilled;

      console.log(`   📊 Trail backfill complete: ${trailsAdded} missing trails + ${gapsFilled} gap fillers = ${totalAdded} total added`);
      return totalAdded;

    } catch (error) {
      console.error('   ❌ Error during trail backfill:', error);
      return 0;
    }
  }

  /**
   * Find trails that exist in Overpass but not in our database
   */
  private async findMissingTrails(overpassTrails: OverpassTrail[], existingTrails: any[]): Promise<OverpassTrail[]> {
    const missingTrails: OverpassTrail[] = [];

    for (const overpassTrail of overpassTrails) {
      // Skip trails that are too short or invalid
      if (!overpassTrail.geometry || overpassTrail.geometry.coordinates.length < 2) {
        continue;
      }

      // Check if this trail already exists in our database
      const isDuplicate = existingTrails.some(existingTrail => {
        // Simple geometric similarity check
        const overpassWkt = `LINESTRING Z (${overpassTrail.geometry.coordinates.map(coord => coord.join(' ')).join(', ')})`;
        const existingWkt = `LINESTRING Z (${existingTrail.geometry.coordinates.map((coord: any) => coord.join(' ')).join(', ')})`;
        
        // Check if geometries are very similar (within 10m)
        return this.pgClient.query(`
          SELECT ST_DWithin(
            ST_GeomFromText($1, 4326),
            ST_GeomFromText($2, 4326),
            0.0001
          ) as is_similar
        `, [overpassWkt, existingWkt]).then(result => result.rows[0]?.is_similar);
      });

      if (!isDuplicate) {
        missingTrails.push(overpassTrail);
      }
    }

    return missingTrails;
  }

  /**
   * Fill remaining gaps after adding missing trails
   */
  private async fillRemainingGaps(): Promise<number> {
    console.log('   🔗 Checking for remaining gaps...');
    
    // Find isolated endpoints
    const isolatedEndpoints = await this.findIsolatedEndpoints();
    console.log(`   📍 Found ${isolatedEndpoints.length} isolated endpoints after adding missing trails`);

    if (isolatedEndpoints.length === 0) {
      console.log('   ✅ No remaining gaps found');
      return 0;
    }

    // For now, we'll just log the isolated endpoints
    // In a more sophisticated implementation, we could:
    // 1. Query Overpass again for specific areas around isolated endpoints
    // 2. Generate synthetic connector trails
    // 3. Use other data sources

    console.log('   📋 Isolated endpoints that may need manual attention:');
    isolatedEndpoints.forEach((endpoint, index) => {
      console.log(`      ${index + 1}. ${endpoint.name} (${endpoint.endpoint_type}) at [${endpoint.lng.toFixed(6)}, ${endpoint.lat.toFixed(6)}]`);
    });

    return 0; // No automatic gap filling for now
  }
}

/**
 * Convert standard bbox [minLng, minLat, maxLng, maxLat] to Overpass bbox [south, west, north, east]
 */
function toOverpassBbox(bbox: [number, number, number, number]): OverpassBbox {
  // The bbox is being passed with coordinates in wrong positions
  // Input: [val1, val2, val3, val4] where coordinates are mixed up
  const [val1, val2, val3, val4] = bbox;
  
  // Find the actual min/max values by checking which are longitudes vs latitudes
  const longitudes = [val1, val2, val3, val4].filter(val => val < -100); // Longitudes are around -105
  const latitudes = [val1, val2, val3, val4].filter(val => val > 30 && val < 50); // Latitudes are around 39
  
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  
  const result: OverpassBbox = [minLat, minLng, maxLat, maxLng]; // [south, west, north, east]
  console.log(`🔍 toOverpassBbox: [${val1}, ${val2}, ${val3}, ${val4}] → [${result.join(', ')}] (extracted: minLng=${minLng}, minLat=${minLat}, maxLng=${maxLng}, maxLat=${maxLat})`);
  return result;
}

/**
 * Standalone function to query Overpass API for trails
 */
async function queryOverpassForTrails(bbox: [number, number, number, number], expansionMeters: number = 0): Promise<Array<{ id: string; name: string; length_meters: number; geometry: any; confidence: number; source: string }>> {
  console.log('🔍 Starting queryOverpassForTrails function...');
  
  // Check if Overpass API is enabled
  if (!process.env.ENABLE_OVERPASS_API) {
    console.warn('⚠️ Overpass API disabled by environment variable ENABLE_OVERPASS_API');
    console.log('   💡 To enable, run: export ENABLE_OVERPASS_API=true');
    return [];
  }

  console.log('✅ Overpass API is enabled, proceeding with query...');
  
  const [minLng, minLat, maxLng, maxLat] = bbox;
  console.log(`📍 Original bbox: [${bbox.join(', ')}]`);
  
  // Expand bbox if specified
  const expansionDegrees = expansionMeters / 111320; // Approximate meters to degrees
  const expandedBbox: [number, number, number, number] = [
    minLng - expansionDegrees,
    minLat - expansionDegrees,
    maxLng + expansionDegrees,
    maxLat + expansionDegrees
  ];
  console.log(`📏 Expansion: ${expansionMeters}m (${expansionDegrees.toFixed(6)} degrees)`);
  console.log(`📍 Expanded bbox: [${expandedBbox.join(', ')}]`);

  // Convert to Overpass bbox format [south, west, north, east]
  const overpassBbox = toOverpassBbox(expandedBbox);
  const [south, west, north, east] = overpassBbox;

  const overpassQuery = `
    [out:json][timeout:25];
    (
      way["highway"="path"](${south},${west},${north},${east});
      way["highway"="footway"](${south},${west},${north},${east});
      way["highway"="bridleway"](${south},${west},${north},${east});
      way["highway"="cycleway"](${south},${west},${north},${east});
    );
    out body;
    >;
    out skel qt;
  `;

  console.log('📋 Overpass query:');
  console.log(overpassQuery);

  try {
    console.log('🌐 Sending HTTP request to Overpass API...');
    console.log('   URL: https://overpass-api.de/api/interpreter');
    console.log('   Timeout: 30 seconds');
    
    const startTime = Date.now();
    const response = await axios.get('https://overpass-api.de/api/interpreter', {
      params: { data: overpassQuery },
      timeout: 30000
    });
    const requestTime = Date.now() - startTime;
    
    console.log(`✅ Overpass API response received in ${requestTime}ms`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Data size: ${JSON.stringify(response.data).length} characters`);

    const data = response.data as any;
    const trails: Array<{ id: string; name: string; length_meters: number; geometry: any; confidence: number; source: string }> = [];

    if (data && data.elements) {
      console.log(`📊 Processing ${data.elements.length} elements from Overpass API...`);
      
      // Process ways and their nodes
      const ways = data.elements.filter((el: any) => el.type === 'way');
      const nodes = data.elements.filter((el: any) => el.type === 'node');
      const nodeMap = new Map(nodes.map((node: any) => [node.id, node]));
      
      console.log(`   Ways: ${ways.length}`);
      console.log(`   Nodes: ${nodes.length}`);

      for (const way of ways) {
        if (way.nodes && way.nodes.length >= 2) {
          const coordinates = way.nodes.map((nodeId: number) => {
            const node = nodeMap.get(nodeId) as any;
            return node ? [node.lon, node.lat] : null;
          }).filter(Boolean);

          if (coordinates.length >= 2) {
            // Calculate length
            let length = 0;
            for (let i = 1; i < coordinates.length; i++) {
              const [lon1, lat1] = coordinates[i - 1];
              const [lon2, lat2] = coordinates[i];
              length += Math.sqrt(Math.pow(lon2 - lon1, 2) + Math.pow(lat2 - lat1, 2)) * 111320; // Rough conversion to meters
            }

            trails.push({
              id: way.id.toString(),
              name: way.tags?.name || way.tags?.ref || `Trail ${way.id}`,
              length_meters: length,
              geometry: {
                type: 'LineString',
                coordinates
              },
              confidence: 0.8, // Default confidence
              source: 'overpass_api'
            });
          }
        }
      }
      
      console.log(`✅ Processed ${trails.length} valid trails from Overpass API`);
    } else {
      console.log('⚠️ No elements found in Overpass API response');
    }

    return trails;
  } catch (error) {
    console.error('❌ Error querying Overpass API:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
    }
    return [];
  }
}

// Export the standalone function
export { queryOverpassForTrails };

// Note: compareAndBackfillMissingTrails is already exported above

// Placeholder functions for compatibility
export async function backfillTrailGaps(pgClient: Pool, schema: string, config: GapBackfillConfig): Promise<any> {
  console.log('⚠️ backfillTrailGaps function not implemented yet');
  return { gapsIdentified: 0, candidatesFound: 0, trailsAdded: 0, details: [] };
}

export async function identifyTrailGaps(pgClient: Pool, schema: string, config: GapBackfillConfig, regionFilter?: string): Promise<TrailGap[]> {
  console.log('⚠️ identifyTrailGaps function not implemented yet');
  return [];
}

export async function exportBackfillVisualization(pgClient: Pool, schema: string, gaps: TrailGap[], config: GapBackfillConfig, vizConfig: VisualizationConfig): Promise<string> {
  console.log('⚠️ exportBackfillVisualization function not implemented yet');
  return './placeholder-visualization.geojson';
}

export async function analyzeConnectivityImpact(pgClient: Pool, schema: string, gaps: TrailGap[], config: GapBackfillConfig): Promise<any> {
  console.log('⚠️ analyzeConnectivityImpact function not implemented yet');
  return {
    beforeBackfill: { connectivityPercentage: 0, reachableNodes: 0, totalNodes: 0, isolatedComponents: 0 },
    afterBackfill: { connectivityPercentage: 0, reachableNodes: 0, totalNodes: 0, isolatedComponents: 0 },
    improvement: { percentageIncrease: 0, additionalReachableNodes: 0, componentsReduced: 0 }
  };
}
