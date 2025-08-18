import { Pool } from 'pg';

interface UnifiedNetworkConfig {
  stagingSchema: string;
  tolerance: number; // in meters
  maxEndpointDistance: number; // in meters for virtual connections
}

export class UnifiedPgRoutingNetworkGenerator {
  private pgClient: Pool;
  private config: UnifiedNetworkConfig;

  constructor(pgClient: Pool, config: UnifiedNetworkConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  async generateUnifiedNetwork(): Promise<{ success: boolean; message: string }> {
    console.log('🔄 Generating unified routing network using pgRouting native functions...');
    
    try {
      // Step 1: Create the base ways table from trails
      await this.createBaseWaysTable();
      
      // Step 2: Create vertices table first
      await this.createVerticesTable();
      
      // Step 3: Create the noded network with source/target assignment
      await this.createNodedNetwork();
      
      // Step 4: Analyze the graph
      await this.analyzeGraph();
      
      // Step 5: Create virtual connections for dead ends
      await this.createVirtualConnections();
      
      // Step 6: Create export-ready tables
      await this.createExportTables();
      
      console.log('✅ Unified routing network generated successfully');
      return { success: true, message: 'Unified routing network generated successfully' };
      
    } catch (error) {
      console.error('❌ Error generating unified routing network:', error);
      return { success: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async createBaseWaysTable(): Promise<void> {
    console.log('📊 Creating base ways table from trails...');
    
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways
    `);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.ways AS
      SELECT 
        id,
        app_uuid as trail_uuid,
        name as trail_name,
        trail_type,
        ST_Length(geometry::geography) / 1000.0 as length_km,
        COALESCE(elevation_gain, 0) as elevation_gain,
        COALESCE(elevation_loss, 0) as elevation_loss,
        geometry as the_geom
      FROM ${this.config.stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_Length(geometry::geography) > 0
    `);
    
    // Add required columns for routing
    await this.pgClient.query(`
      ALTER TABLE ${this.config.stagingSchema}.ways 
      ADD COLUMN IF NOT EXISTS source integer,
      ADD COLUMN IF NOT EXISTS target integer,
      ADD COLUMN IF NOT EXISTS cost double precision,
      ADD COLUMN IF NOT EXISTS reverse_cost double precision
    `);
    
    // Set cost and reverse_cost
    await this.pgClient.query(`
      UPDATE ${this.config.stagingSchema}.ways 
      SET 
        cost = length_km,
        reverse_cost = length_km
    `);
    
    const count = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways
    `);
    
    console.log(`  Created ${count.rows[0].count} base ways`);
  }

  private async createNodedNetwork(): Promise<void> {
    console.log('🔗 Creating noded network manually...');
    
    // Create ways_noded table directly from ways (no splitting)
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded
    `);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.ways_noded AS
      SELECT 
        id,
        cost,
        reverse_cost,
        the_geom
      FROM ${this.config.stagingSchema}.ways
    `);
    
    // Add source and target columns
    await this.pgClient.query(`
      ALTER TABLE ${this.config.stagingSchema}.ways_noded 
      ADD COLUMN source integer,
      ADD COLUMN target integer
    `);
    
    // Assign source and target based on vertex proximity
    await this.pgClient.query(`
      UPDATE ${this.config.stagingSchema}.ways_noded 
      SET 
        source = start_vertex.start_vertex_id,
        target = end_vertex.end_vertex_id
      FROM (
        SELECT 
          wn.id as way_id,
          v.id as start_vertex_id
        FROM ${this.config.stagingSchema}.ways_noded wn
        CROSS JOIN LATERAL (
          SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
          ORDER BY ST_Distance(ST_StartPoint(wn.the_geom), the_geom)
          LIMIT 1
        ) v
      ) start_vertex,
      (
        SELECT 
          wn.id as way_id,
          v.id as end_vertex_id
        FROM ${this.config.stagingSchema}.ways_noded wn
        CROSS JOIN LATERAL (
          SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
          ORDER BY ST_Distance(ST_EndPoint(wn.the_geom), the_geom)
          LIMIT 1
        ) v
      ) end_vertex
      WHERE ways_noded.id = start_vertex.way_id AND ways_noded.id = end_vertex.way_id
    `);
    
    // Create vertices table from trail endpoints
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.ways_noded_vertices_pgr AS
      WITH all_vertices AS (
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(ST_StartPoint(the_geom)), ST_Y(ST_StartPoint(the_geom))) as id,
          ST_StartPoint(the_geom) as the_geom,
          'start' as vertex_type
        FROM ${this.config.stagingSchema}.ways
        WHERE the_geom IS NOT NULL
        UNION ALL
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(ST_EndPoint(the_geom)), ST_Y(ST_EndPoint(the_geom))) as id,
          ST_EndPoint(the_geom) as the_geom,
          'end' as vertex_type
        FROM ${this.config.stagingSchema}.ways
        WHERE the_geom IS NOT NULL
      ),
      unique_vertices AS (
        SELECT DISTINCT ON (ST_AsText(the_geom))
          id,
          the_geom,
          vertex_type
        FROM all_vertices
        ORDER BY ST_AsText(the_geom), id
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY ST_X(the_geom), ST_Y(the_geom)) as id,
        the_geom,
        0 as cnt,
        0 as chk,
        0 as ein,
        0 as eout
      FROM unique_vertices
      ORDER BY ST_X(the_geom), ST_Y(the_geom)
    `);
    
    const edgeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded
    `);
    
    const vertexCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);
    
    console.log(`  Created ${edgeCount.rows[0].count} noded edges and ${vertexCount.rows[0].count} vertices`);
  }

  private async createVerticesTable(): Promise<void> {
    console.log('📍 Creating vertices table...');
    
    // Create vertices table from trail endpoints
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.ways_noded_vertices_pgr AS
      WITH all_vertices AS (
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(ST_StartPoint(the_geom)), ST_Y(ST_StartPoint(the_geom))) as id,
          ST_StartPoint(the_geom) as the_geom,
          'start' as vertex_type
        FROM ${this.config.stagingSchema}.ways
        WHERE the_geom IS NOT NULL
        UNION ALL
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(ST_EndPoint(the_geom)), ST_Y(ST_EndPoint(the_geom))) as id,
          ST_EndPoint(the_geom) as the_geom,
          'end' as vertex_type
        FROM ${this.config.stagingSchema}.ways
        WHERE the_geom IS NOT NULL
      ),
      unique_vertices AS (
        SELECT DISTINCT ON (ST_AsText(the_geom))
          id,
          the_geom,
          vertex_type
        FROM all_vertices
        ORDER BY ST_AsText(the_geom), id
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY ST_X(the_geom), ST_Y(the_geom)) as id,
        the_geom,
        0 as cnt,
        0 as chk,
        0 as ein,
        0 as eout,
        'node-' || ROW_NUMBER() OVER (ORDER BY ST_X(the_geom), ST_Y(the_geom))::text as node_uuid,
        'unknown' as node_type,
        0 as degree
      FROM unique_vertices
      ORDER BY ST_X(the_geom), ST_Y(the_geom)
    `);
    
    // Update node types based on degree (will be calculated later)
    await this.pgClient.query(`
      UPDATE ${this.config.stagingSchema}.ways_noded_vertices_pgr 
      SET 
        node_type = CASE 
          WHEN degree >= 3 THEN 'intersection'
          WHEN degree = 2 THEN 'connector'
          WHEN degree = 1 THEN 'endpoint'
          ELSE 'unknown'
        END
    `);
  }

  private async analyzeGraph(): Promise<void> {
    console.log('🔍 Analyzing graph topology...');
    
    // Analyze the graph for issues
    await this.pgClient.query(`
      SELECT pgr_analyzeGraph('${this.config.stagingSchema}.ways_noded', 0.000001, 'the_geom', 'id', 'source', 'target', '${this.config.stagingSchema}.ways_noded_vertices_pgr')
    `);
    
    // Check for isolated nodes
    const isolatedNodes = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE chk = 1
    `);
    
    console.log(`  Found ${isolatedNodes.rows[0].count} isolated nodes`);
  }

  private async createVirtualConnections(): Promise<void> {
    console.log('🔗 Creating virtual connections for dead ends...');
    
    // Find dead-end nodes (nodes with only incoming edges)
    const deadEndNodes = await this.pgClient.query(`
      WITH node_degrees AS (
        SELECT 
          node_id,
          in_degree,
          out_degree
        FROM (
          SELECT source as node_id, COUNT(*) as out_degree FROM ${this.config.stagingSchema}.ways_noded GROUP BY source
        ) out_edges
        FULL OUTER JOIN (
          SELECT target as node_id, COUNT(*) as in_degree FROM ${this.config.stagingSchema}.ways_noded GROUP BY target
        ) in_edges USING (node_id)
      )
      SELECT node_id, in_degree, out_degree
      FROM node_degrees
      WHERE out_degree = 0 AND in_degree > 0
      ORDER BY node_id
    `);
    
    console.log(`  Found ${deadEndNodes.rows.length} dead-end nodes`);
    
    if (deadEndNodes.rows.length > 0) {
      for (const deadEnd of deadEndNodes.rows) {
        const deadEndNodeId = deadEnd.node_id;
        
        // Find nearby nodes that could complete loops
        const nearbyNodes = await this.pgClient.query(`
          WITH dead_end_location AS (
            SELECT the_geom as dead_end_point
            FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
            WHERE id = $1
          ),
          nearby_nodes AS (
            SELECT 
              v.id as node_id,
              ST_Distance(v.the_geom, dead_end_location.dead_end_point) as distance_meters
            FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
            CROSS JOIN dead_end_location
            WHERE v.id != $1
              AND ST_Distance(v.the_geom, dead_end_location.dead_end_point) <= $2
            ORDER BY distance_meters
            LIMIT 3
          )
          SELECT * FROM nearby_nodes
        `, [deadEndNodeId, this.config.maxEndpointDistance]);
        
        // Create virtual connections for the closest nodes
        for (const nearby of nearbyNodes.rows) {
          const virtualEdgeId = `virtual_${deadEndNodeId}_${nearby.node_id}`;
          const virtualCost = nearby.distance_meters / 1000; // Convert to km
          
          await this.pgClient.query(`
            INSERT INTO ${this.config.stagingSchema}.ways_noded (id, source, target, cost, reverse_cost, the_geom)
            VALUES ($1, $2, $3, $4, $4, 
              ST_MakeLine(
                (SELECT the_geom FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE id = $2),
                (SELECT the_geom FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE id = $3)
              )
            )
          `, [virtualEdgeId, deadEndNodeId, nearby.node_id, virtualCost]);
          
          console.log(`    Created virtual connection: ${deadEndNodeId} → ${nearby.node_id} (${virtualCost.toFixed(3)}km)`);
        }
      }
    }
  }

  private async createExportTables(): Promise<void> {
    console.log('📤 Creating export-ready tables...');
    
    // Create export_nodes table
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.export_nodes
    `);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.export_nodes AS
      SELECT 
        id,
        'node-' || id::text as node_uuid,
        ST_Y(the_geom) as lat,
        ST_X(the_geom) as lng,
        COALESCE(ST_Z(the_geom), 0) as elevation,
        CASE 
          WHEN cnt >= 3 THEN 'intersection'
          WHEN cnt = 2 THEN 'connector'
          WHEN cnt = 1 THEN 'endpoint'
          ELSE 'unknown'
        END as node_type,
        cnt as degree,
        ST_AsGeoJSON(the_geom, 6, 0) as geojson
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      ORDER BY id
    `);
    
    // Create export_edges table
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.config.stagingSchema}.export_edges
    `);
    
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.export_edges AS
      SELECT 
        wn.id,
        wn.source,
        wn.target,
        COALESCE(w.trail_uuid, 'edge-' || wn.id) as trail_id,
        COALESCE(w.trail_name, 'Unnamed Trail') as trail_name,
        wn.cost as length_km,
        COALESCE(w.elevation_gain, 0) as elevation_gain,
        COALESCE(w.elevation_loss, 0) as elevation_loss,
        ST_AsGeoJSON(wn.the_geom, 6, 0) as geojson
      FROM ${this.config.stagingSchema}.ways_noded wn
      LEFT JOIN ${this.config.stagingSchema}.ways w ON wn.id = w.id
      WHERE wn.source IS NOT NULL AND wn.target IS NOT NULL
      ORDER BY wn.id
    `);
    
    const nodeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.export_nodes
    `);
    
    const edgeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.export_edges
    `);
    
    console.log(`  Created export tables with ${nodeCount.rows[0].count} nodes and ${edgeCount.rows[0].count} edges`);
  }

  async getNetworkStats(): Promise<{ nodes: number; edges: number; isolatedNodes: number }> {
    const nodeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.export_nodes
    `);
    
    const edgeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.export_edges
    `);
    
    const isolatedCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE chk = 1
    `);
    
    return {
      nodes: parseInt(nodeCount.rows[0].count),
      edges: parseInt(edgeCount.rows[0].count),
      isolatedNodes: parseInt(isolatedCount.rows[0].count)
    };
  }

  async findBearPeakLoop(): Promise<any[]> {
    console.log('🔍 Looking for Bear Peak loop in unified network...');
    
    // Find edges that contain Bear Peak related trails
    const bearPeakEdges = await this.pgClient.query(`
      SELECT id, source, target, trail_name, length_km
      FROM ${this.config.stagingSchema}.export_edges
      WHERE trail_name ILIKE '%bear%' 
         OR trail_name ILIKE '%fern%' 
         OR trail_name ILIKE '%mesa%'
      ORDER BY trail_name
    `);
    
    console.log(`Found ${bearPeakEdges.rows.length} Bear Peak related edges`);
    
    // Try to find loops using pgr_hawickCircuits
    try {
      const loops = await this.pgClient.query(`
        SELECT * FROM pgr_hawickCircuits(
          'SELECT id, source, target, cost, reverse_cost FROM ${this.config.stagingSchema}.ways_noded'
        )
        WHERE cost BETWEEN 5 AND 15
        ORDER BY cost
        LIMIT 5
      `);
      
      console.log(`Found ${loops.rows.length} potential loops`);
      
      return loops.rows;
      
    } catch (error) {
      console.error('Error finding loops:', error);
      return [];
    }
  }
}
