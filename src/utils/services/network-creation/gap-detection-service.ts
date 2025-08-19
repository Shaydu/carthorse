import { Pool } from 'pg';

export interface GapDetectionResult {
  gapsFound: number;
  bridgesCreated: number;
  details: Array<{
    node1_id: number;
    node2_id: number;
    distance_meters: number;
    bridge_geom: any;
  }>;
}

export interface GapDetectionConfig {
  toleranceMeters: number;
  maxBridgesToCreate: number;
}

/**
 * Detects gaps in the trail network and creates bridge connectors
 * 
 * A gap is defined as:
 * - A degree-1 vertex (endpoint) that is within tolerance distance of
 * - A degree-2+ vertex (connector or intersection) 
 * - Where no edge currently exists between them
 */
export async function detectAndFixGaps(
  pgClient: Pool, 
  schema: string, 
  config: GapDetectionConfig
): Promise<GapDetectionResult> {
  console.log('🔍 Detecting gaps in trail network...');
  
  const toleranceDegrees = config.toleranceMeters / 111320; // Convert meters to degrees
  
  // Find endpoint pairs that should be connected
  const gapDetectionResult = await pgClient.query(`
    WITH endpoint_pairs AS (
      SELECT 
        v1.id as node1_id,
        v2.id as node2_id,
        ST_Distance(v1.the_geom, v2.the_geom) * 111320 as distance_meters,
        v1.the_geom as geom1,
        v2.the_geom as geom2
      FROM ${schema}.ways_noded_vertices_pgr v1
      CROSS JOIN ${schema}.ways_noded_vertices_pgr v2
      WHERE v1.id < v2.id
        AND v1.cnt = 1  -- First vertex is an endpoint
        AND v2.cnt >= 2  -- Second vertex is a connector or intersection
        AND ST_DWithin(v1.the_geom, v2.the_geom, $1)
        AND NOT EXISTS (
          SELECT 1 FROM ${schema}.ways_noded e 
          WHERE (e.source = v1.id AND e.target = v2.id) 
             OR (e.source = v2.id AND e.target = v1.id)
        )
    )
    SELECT 
      node1_id,
      node2_id,
      distance_meters,
      ST_MakeLine(geom1, geom2) as bridge_geom
    FROM endpoint_pairs
    WHERE distance_meters <= $2
    ORDER BY distance_meters
    LIMIT $3
  `, [toleranceDegrees, config.toleranceMeters, config.maxBridgesToCreate]);
  
  const gapsFound = gapDetectionResult.rows.length;
  console.log(`🔍 Found ${gapsFound} gaps to fix`);
  
  if (gapsFound === 0) {
    return {
      gapsFound: 0,
      bridgesCreated: 0,
      details: []
    };
  }
  
  // Create bridge edges for each detected gap
  let bridgesCreated = 0;
  const details: GapDetectionResult['details'] = [];
  
  for (const gap of gapDetectionResult.rows) {
    try {
      // Insert bridge edge
      await pgClient.query(`
        INSERT INTO ${schema}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, elevation_loss, name, app_uuid, original_trail_id)
        VALUES (
          (SELECT COALESCE(MAX(id), 0) + 1 FROM ${schema}.ways_noded),
          $1, $2, $3, $4, 0, 0, 'Bridge Connector', 'bridge-connector-' || $1 || '-' || $2, NULL
        )
      `, [
        gap.node1_id, 
        gap.node2_id, 
        gap.bridge_geom, 
        gap.distance_meters / 1000 // Convert meters to km
      ]);
      
      bridgesCreated++;
      details.push({
        node1_id: gap.node1_id,
        node2_id: gap.node2_id,
        distance_meters: gap.distance_meters,
        bridge_geom: gap.bridge_geom
      });
      
      console.log(`🔗 Created bridge: Vertex ${gap.node1_id} → Vertex ${gap.node2_id} (${gap.distance_meters.toFixed(2)}m)`);
      
    } catch (error) {
      console.error(`❌ Failed to create bridge between vertices ${gap.node1_id} and ${gap.node2_id}:`, error);
    }
  }
  
  if (bridgesCreated > 0) {
    // Recalculate node connectivity after adding bridges
    await pgClient.query(`
      UPDATE ${schema}.ways_noded_vertices_pgr 
      SET cnt = (
        SELECT COUNT(*) 
        FROM ${schema}.ways_noded e 
        WHERE e.source = ways_noded_vertices_pgr.id OR e.target = ways_noded_vertices_pgr.id
      )
    `);
    
    console.log(`✅ Recalculated node connectivity after creating ${bridgesCreated} bridges`);
  }
  
  return {
    gapsFound,
    bridgesCreated,
    details
  };
}

/**
 * Validates that gap detection is working correctly
 */
export async function validateGapDetection(
  pgClient: Pool, 
  schema: string, 
  config: GapDetectionConfig
): Promise<{
  totalVertices: number;
  degree1Vertices: number;
  degree2PlusVertices: number;
  potentialGaps: number;
}> {
  const stats = await pgClient.query(`
    SELECT 
      COUNT(*) as total_vertices,
      COUNT(CASE WHEN cnt = 1 THEN 1 END) as degree1_vertices,
      COUNT(CASE WHEN cnt >= 2 THEN 1 END) as degree2_plus_vertices
    FROM ${schema}.ways_noded_vertices_pgr
  `);
  
  const toleranceDegrees = config.toleranceMeters / 111320;
  
  const potentialGaps = await pgClient.query(`
    SELECT COUNT(*) as count
    FROM ${schema}.ways_noded_vertices_pgr v1
    CROSS JOIN ${schema}.ways_noded_vertices_pgr v2
    WHERE v1.id < v2.id
      AND v1.cnt = 1
      AND v2.cnt >= 2
      AND ST_DWithin(v1.the_geom, v2.the_geom, $1)
      AND NOT EXISTS (
        SELECT 1 FROM ${schema}.ways_noded e 
        WHERE (e.source = v1.id AND e.target = v2.id) 
           OR (e.source = v2.id AND e.target = v1.id)
      )
  `, [toleranceDegrees]);
  
  return {
    totalVertices: stats.rows[0].total_vertices,
    degree1Vertices: stats.rows[0].degree1_vertices,
    degree2PlusVertices: stats.rows[0].degree2_plus_vertices,
    potentialGaps: potentialGaps.rows[0].count
  };
}
