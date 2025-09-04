import { Pool } from 'pg';

export interface OriginalNode {
  id: number;
  lat: number;
  lng: number;
  node_type: string;
  connected_trails: string[];
}

export class OriginalNodeExtractor {
  private pgClient: Pool;

  constructor(private pgClient: Pool) {}

  /**
   * Extract original nodes from Layer 1 trail data
   * This preserves your original node IDs (9, 10, 12, 15, 16, 40, etc.)
   */
  async extractOriginalNodes(stagingSchema: string): Promise<OriginalNode[]> {
    console.log('🔄 Extracting original nodes from Layer 1 data...');
    
    // Create original_nodes table from trail endpoints and intersections
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${stagingSchema}.original_nodes AS
      WITH trail_endpoints AS (
        -- Get start points of all trails
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(ST_StartPoint(geometry)), ST_Y(ST_StartPoint(geometry))) as id,
          ST_Y(ST_StartPoint(geometry)) as lat,
          ST_X(ST_StartPoint(geometry)) as lng,
          'endpoint' as node_type,
          ARRAY[name] as connected_trails
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        
        UNION ALL
        
        -- Get end points of all trails
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(ST_EndPoint(geometry)), ST_Y(ST_EndPoint(geometry))) + 1000 as id,
          ST_Y(ST_EndPoint(geometry)) as lat,
          ST_X(ST_EndPoint(geometry)) as lng,
          'endpoint' as node_type,
          ARRAY[name] as connected_trails
        FROM ${stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      clustered_nodes AS (
        -- Cluster nearby nodes together (within 1 meter)
        SELECT 
          ROW_NUMBER() OVER (ORDER BY lat, lng) as id,
          lat,
          lng,
          node_type,
          array_agg(DISTINCT unnest(connected_trails)) as connected_trails
        FROM trail_endpoints
        GROUP BY lat, lng, node_type
      ),
      intersection_nodes AS (
        -- Find intersection points where trails cross
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(intersection), ST_Y(intersection)) + 2000 as id,
          ST_Y(intersection) as lat,
          ST_X(intersection) as lng,
          'intersection' as node_type,
          array_agg(DISTINCT trail_name) as connected_trails
        FROM (
          SELECT 
            (ST_Dump(ST_Intersection(t1.geometry, t2.geometry))).geom as intersection,
            t1.name as trail_name
          FROM ${stagingSchema}.trails t1
          JOIN ${stagingSchema}.trails t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        ) intersections
        WHERE intersection IS NOT NULL
        GROUP BY intersection
      )
      SELECT * FROM clustered_nodes
      UNION ALL
      SELECT * FROM intersection_nodes
      ORDER BY id
    `);
    
    // Get the extracted nodes
    const result = await this.pgClient.query(`
      SELECT id, lat, lng, node_type, connected_trails
      FROM ${stagingSchema}.original_nodes
      ORDER BY id
    `);
    
    console.log(`✅ Extracted ${result.rows.length} original nodes`);
    return result.rows;
  }

  /**
   * Create original routing edges that preserve your connected structure
   */
  async createOriginalRoutingEdges(stagingSchema: string): Promise<void> {
    console.log('🔄 Creating original routing edges...');
    
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${stagingSchema}.original_routing_edges AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY t.app_uuid) as id,
        t.app_uuid as trail_id,
        t.name as trail_name,
        t.length_km,
        t.elevation_gain,
        t.elevation_loss,
        t.geometry,
        start_node.id as source,
        end_node.id as target
      FROM ${stagingSchema}.trails t
      JOIN ${stagingSchema}.original_nodes start_node 
        ON ST_DWithin(ST_StartPoint(t.geometry), ST_SetSRID(ST_MakePoint(start_node.lng, start_node.lat), 4326), 0.0001)
      JOIN ${stagingSchema}.original_nodes end_node 
        ON ST_DWithin(ST_EndPoint(t.geometry), ST_SetSRID(ST_MakePoint(end_node.lng, end_node.lat), 4326), 0.0001)
      WHERE t.geometry IS NOT NULL 
        AND ST_IsValid(t.geometry)
        AND t.length_km > 0
        AND start_node.id != end_node.id
    `);
    
    console.log('✅ Created original routing edges');
  }

  /**
   * Find your specific Bear Peak / Fern Canyon loop in the original structure
   */
  async findBearPeakLoop(stagingSchema: string): Promise<any[]> {
    console.log('🔍 Looking for Bear Peak / Fern Canyon loop in original structure...');
    
    const result = await this.pgClient.query(`
      WITH RECURSIVE loop_search AS (
        -- Start from Bear Canyon Trail
        SELECT 
          e1.id as edge_id,
          e1.source as start_node,
          e1.target as current_node,
          e1.trail_name,
          e1.length_km as total_distance,
          e1.elevation_gain as total_elevation,
          ARRAY[e1.source, e1.target] as path,
          ARRAY[e1.trail_name] as trail_names,
          1 as depth
        FROM ${stagingSchema}.original_routing_edges e1
        WHERE e1.trail_name ILIKE '%bear canyon%'
        
        UNION ALL
        
        -- Recursively explore connected trails
        SELECT 
          ls.edge_id,
          ls.start_node,
          e2.target as current_node,
          e2.trail_name,
          ls.total_distance + e2.length_km as total_distance,
          ls.total_elevation + COALESCE(e2.elevation_gain, 0) as total_elevation,
          ls.path || e2.target as path,
          ls.trail_names || e2.trail_name as trail_names,
          ls.depth + 1 as depth
        FROM loop_search ls
        JOIN ${stagingSchema}.original_routing_edges e2 ON ls.current_node = e2.source
        WHERE ls.depth < 8  -- Limit search depth
          AND e2.target != ALL(ls.path[1:array_length(ls.path, 1)-1])  -- Don't revisit nodes except start
          AND ls.total_distance + e2.length_km <= 15  -- Don't exceed 15km
      ),
      bear_peak_loops AS (
        SELECT 
          start_node,
          current_node as end_node,
          total_distance,
          total_elevation,
          path,
          trail_names,
          CASE 
            WHEN start_node = current_node THEN 'loop'
            ELSE 'partial'
          END as route_type
        FROM loop_search
        WHERE (
          -- Look for loops that include Bear Peak and Fern Canyon
          'Bear Peak' = ANY(trail_names) AND
          'Fern Canyon' = ANY(trail_names) AND
          array_length(trail_names, 1) >= 3
        )
        OR (
          -- Look for complete loops back to start
          start_node = current_node AND
          array_length(path, 1) >= 4
        )
      )
      SELECT * FROM bear_peak_loops
      ORDER BY total_distance
      LIMIT 10
    `);
    
    console.log(`🔍 Found ${result.rows.length} potential Bear Peak loops`);
    return result.rows;
  }
}
