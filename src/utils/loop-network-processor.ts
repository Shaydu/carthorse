import { Client } from 'pg';

export interface LoopNetworkProcessorConfig {
  stagingSchema: string;
  pgClient: Client;
}

export class LoopNetworkProcessor {
  private stagingSchema: string;
  private pgClient: Client;

  constructor(config: LoopNetworkProcessorConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
  }

  /**
   * Process loop trails and integrate them into the existing network
   * This is called after all regular trail splitting and node/edge generation
   */
  async processLoopTrails(): Promise<void> {
    console.log('🔄 Processing loop trails with unified network approach...');
    
    try {
      // Step 1: Identify and process loop trails
      const loopProcessingSql = `
        -- STEP 1: Explode all loop geometries to linestrings
        WITH exploded AS (
          SELECT 
            app_uuid,
            name,
            trail_type,
            surface,
            difficulty,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            (ST_Dump(geometry)).geom::geometry(LineString, 4326) AS geometry
          FROM ${this.stagingSchema}.trails 
          WHERE ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))
        ),

        -- STEP 2: Extract start and end points
        edge_points AS (
          SELECT 
            app_uuid,
            name,
            trail_type,
            surface,
            difficulty,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            geometry,
            ST_StartPoint(geometry) AS start_pt,
            ST_EndPoint(geometry) AS end_pt
          FROM exploded
        ),

        -- STEP 3: Deduplicate nodes (including shared ones with existing network)
        loop_nodes AS (
          SELECT DISTINCT ON (round(ST_X(pt)::numeric, 6), round(ST_Y(pt)::numeric, 6))
            gen_random_uuid() as node_uuid,
            ST_SetSRID(pt, 4326) AS geometry,
            ST_Y(pt) as lat,
            ST_X(pt) as lng
          FROM (
            SELECT start_pt AS pt FROM edge_points
            UNION ALL
            SELECT end_pt AS pt FROM edge_points
            UNION ALL
            SELECT ST_StartPoint(geometry) FROM ${this.stagingSchema}.trails WHERE NOT ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))
            UNION ALL
            SELECT ST_EndPoint(geometry) FROM ${this.stagingSchema}.trails WHERE NOT ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))
          ) AS all_pts
        ),

        -- STEP 4: Assign unique node IDs
        indexed_nodes AS (
          SELECT row_number() OVER () AS node_id, node_uuid, geometry, lat, lng FROM loop_nodes
        ),

        -- STEP 5: Reconnect edges with node IDs
        reconnected AS (
          SELECT 
            e.app_uuid AS trail_id,
            e.name AS trail_name,
            e.trail_type,
            e.surface,
            e.difficulty,
            e.length_km,
            e.elevation_gain,
            e.elevation_loss,
            e.max_elevation,
            e.min_elevation,
            e.avg_elevation,
            n1.node_uuid AS source,
            n2.node_uuid AS target,
            e.geometry
          FROM edge_points e
          JOIN indexed_nodes n1 ON ST_DWithin(e.start_pt, n1.geometry, 0.00001)
          JOIN indexed_nodes n2 ON ST_DWithin(e.end_pt, n2.geometry, 0.00001)
        )

        -- STEP 6: Insert into routing nodes and edges
        INSERT INTO ${this.stagingSchema}.routing_nodes (node_uuid, lat, lng, node_type, connected_trails)
        SELECT 
          node_uuid,
          lat,
          lng,
          'loop_node' as node_type,
          'Loop Trail' as connected_trails
        FROM indexed_nodes
        ON CONFLICT (node_uuid) DO NOTHING;

        INSERT INTO ${this.stagingSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry)
        SELECT 
          source,
          target,
          trail_id,
          trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_Force2D(geometry) as geometry
        FROM reconnected
        ON CONFLICT DO NOTHING;
      `;

      const result = await this.pgClient.query(loopProcessingSql);
      
      // Get statistics
      const statsResult = await this.pgClient.query(`
        SELECT 
          COUNT(*) as loop_trails_processed,
          COUNT(DISTINCT app_uuid) as unique_loop_trails
        FROM ${this.stagingSchema}.trails 
        WHERE ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))
      `);
      
      const stats = statsResult.rows[0];
      console.log(`✅ Loop processing complete: ${stats.loop_trails_processed} segments from ${stats.unique_loop_trails} loop trails`);
      
    } catch (error) {
      console.error('❌ Error processing loop trails:', error);
      throw error;
    }
  }

  /**
   * Get statistics about loop trails in the staging database
   */
  async getLoopStatistics(): Promise<{
    totalLoopTrails: number;
    totalLoopSegments: number;
    loopTrailNames: string[];
  }> {
    const result = await this.pgClient.query(`
      SELECT 
        COUNT(DISTINCT app_uuid) as total_loop_trails,
        COUNT(*) as total_loop_segments,
        array_agg(DISTINCT name) as loop_trail_names
      FROM ${this.stagingSchema}.trails 
      WHERE ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))
    `);
    
    const row = result.rows[0];
    return {
      totalLoopTrails: parseInt(row.total_loop_trails) || 0,
      totalLoopSegments: parseInt(row.total_loop_segments) || 0,
      loopTrailNames: row.loop_trail_names || []
    };
  }

  /**
   * Validate that loop processing was successful
   */
  async validateLoopProcessing(): Promise<boolean> {
    try {
      // Check that loop trails were processed
      const loopStats = await this.getLoopStatistics();
      
      if (loopStats.totalLoopTrails === 0) {
        console.log('ℹ️ No loop trails found - skipping validation');
        return true;
      }

      // Check that loop nodes were created
      const nodeResult = await this.pgClient.query(`
        SELECT COUNT(*) as loop_nodes
        FROM ${this.stagingSchema}.routing_nodes 
        WHERE node_type = 'loop_node'
      `);
      
      const loopNodes = parseInt(nodeResult.rows[0].loop_nodes) || 0;
      
      // Check that loop edges were created
      const edgeResult = await this.pgClient.query(`
        SELECT COUNT(*) as loop_edges
        FROM ${this.stagingSchema}.routing_edges re
        JOIN ${this.stagingSchema}.routing_nodes rn1 ON re.source = rn1.node_uuid
        JOIN ${this.stagingSchema}.routing_nodes rn2 ON re.target = rn2.node_uuid
        WHERE rn1.node_type = 'loop_node' OR rn2.node_type = 'loop_node'
      `);
      
      const loopEdges = parseInt(edgeResult.rows[0].loop_edges) || 0;
      
      console.log(`✅ Loop validation: ${loopNodes} loop nodes, ${loopEdges} loop edges created`);
      
      return loopNodes > 0 && loopEdges > 0;
      
    } catch (error) {
      console.error('❌ Loop validation failed:', error);
      return false;
    }
  }
} 