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
    console.log('🔄 Generating unified routing network using existing layer 2 network...');
    
    try {
      // Use existing layer 2 network instead of creating a new one
      await this.useExistingLayer2Network();
      
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

  private async useExistingLayer2Network(): Promise<void> {
    console.log('📊 Using existing layer 2 network...');
    
    // Check if layer 2 network exists
    const networkExists = await this.pgClient.query(`
      SELECT EXISTS(
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = 'ways_noded'
      ) as exists
    `, [this.config.stagingSchema]);
    
    if (!networkExists.rows[0].exists) {
      throw new Error('Layer 2 network (ways_noded) does not exist. Please run Layer 2 first.');
    }
    
    // Use the existing layer 2 network directly (no copying needed)
    console.log('  Using existing ways_noded as ways...');
    
    // Check if ways table exists and drop it if it does
    const waysExists = await this.pgClient.query(`
      SELECT EXISTS(
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = 'ways'
      ) as exists
    `, [this.config.stagingSchema]);
    
    if (waysExists.rows[0].exists) {
      console.log('  Dropping existing ways table...');
      await this.pgClient.query(`
        DROP TABLE ${this.config.stagingSchema}.ways
      `);
    }
    
    // Create a view that points to the existing ways_noded table
    await this.pgClient.query(`
      CREATE VIEW ${this.config.stagingSchema}.ways AS
      SELECT 
        id,
        app_uuid as trail_uuid,
        name as trail_name,
        'trail' as trail_type,
        length_km,
        elevation_gain,
        elevation_loss,
        the_geom,
        source,
        target,
        length_km as cost,
        length_km as reverse_cost
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE the_geom IS NOT NULL AND ST_IsValid(the_geom)
    `);
    
    // The vertices table already exists and has proper connectivity counts
    console.log('  Using existing ways_noded_vertices_pgr...');
    
    // Verify and fix connectivity counts if needed
    console.log('  Verifying connectivity counts...');
    const initialConnectivityCheck = await this.pgClient.query(`
      SELECT COUNT(*) as total_vertices, 
             COUNT(CASE WHEN cnt > 0 THEN 1 END) as connected_vertices,
             MIN(cnt) as min_degree, 
             MAX(cnt) as max_degree
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);
    
    const initialStats = initialConnectivityCheck.rows[0];
    console.log(`  ✅ Using existing network: ${initialStats.total_vertices} total vertices, ${initialStats.connected_vertices} connected, degree range ${initialStats.min_degree}-${initialStats.max_degree}`);
    
    // If connectivity counts are all 0, recalculate them
    if (initialStats.connected_vertices === 0) {
      console.log('  ⚠️ Connectivity counts are all 0, recalculating...');
      await this.pgClient.query(`
        UPDATE ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded e
          WHERE (e.source = v.id OR e.target = v.id)
            AND e.source IS NOT NULL AND e.target IS NOT NULL
        )
      `);
      
      // Verify the fix
      const finalConnectivityCheck = await this.pgClient.query(`
        SELECT COUNT(*) as total_vertices, 
               COUNT(CASE WHEN cnt > 0 THEN 1 END) as connected_vertices,
               MIN(cnt) as min_degree, 
               MAX(cnt) as max_degree
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      `);
      
      const finalStats = finalConnectivityCheck.rows[0];
      console.log(`  ✅ Fixed connectivity: ${finalStats.total_vertices} total vertices, ${finalStats.connected_vertices} connected, degree range ${finalStats.min_degree}-${finalStats.max_degree}`);
    } else {
      console.log(`  ✅ Using Layer 2 connectivity: ${initialStats.total_vertices} total vertices, ${initialStats.connected_vertices} connected, degree range ${initialStats.min_degree}-${initialStats.max_degree}`);
    }
    
    // Add missing cost and reverse_cost columns to ways_noded for pgRouting compatibility
    console.log('  Adding cost and reverse_cost columns to ways_noded...');
    await this.pgClient.query(`
      ALTER TABLE ${this.config.stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS cost double precision,
      ADD COLUMN IF NOT EXISTS reverse_cost double precision
    `);
    
    // Set cost and reverse_cost to length_km
    await this.pgClient.query(`
      UPDATE ${this.config.stagingSchema}.ways_noded 
      SET cost = length_km, reverse_cost = length_km
      WHERE cost IS NULL OR reverse_cost IS NULL
    `);
    
    // Add trail_uuid column for compatibility with route generation services
    console.log('  Adding trail_uuid column to ways_noded...');
    await this.pgClient.query(`
      ALTER TABLE ${this.config.stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS trail_uuid uuid
    `);
    
    // Set trail_uuid to app_uuid
    await this.pgClient.query(`
      UPDATE ${this.config.stagingSchema}.ways_noded 
      SET trail_uuid = app_uuid
      WHERE trail_uuid IS NULL
    `);
    
    // Add trail_name column for compatibility with export services
    console.log('  Adding trail_name column to ways_noded...');
    await this.pgClient.query(`
      ALTER TABLE ${this.config.stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS trail_name text
    `);
    
    // Set trail_name to name
    await this.pgClient.query(`
      UPDATE ${this.config.stagingSchema}.ways_noded 
      SET trail_name = name
      WHERE trail_name IS NULL
    `);
    
    // Verify connectivity counts are properly set
    const connectivityCheck = await this.pgClient.query(`
      SELECT COUNT(*) as total_vertices, 
             COUNT(CASE WHEN cnt > 0 THEN 1 END) as connected_vertices,
             MIN(cnt) as min_degree, 
             MAX(cnt) as max_degree
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
    `);
    
    const stats = connectivityCheck.rows[0];
    console.log(`  ✅ Using existing network: ${stats.total_vertices} total vertices, ${stats.connected_vertices} connected, degree range ${stats.min_degree}-${stats.max_degree}`);
    
    if (stats.connected_vertices === 0) {
      console.warn('⚠️ No connected vertices found in existing network! Recalculating connectivity...');
      // Force recalculation of connectivity counts
      await this.pgClient.query(`
        UPDATE ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways e
          WHERE e.source = v.id OR e.target = v.id
        )
      `);
      
      // Check again
      const recheck = await this.pgClient.query(`
        SELECT COUNT(*) as connected_vertices
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
        WHERE cnt > 0
      `);
      console.log(`  ✅ After recalculation: ${recheck.rows[0].connected_vertices} connected vertices`);
    }
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
        trail_uuid,
        trail_name,
        trail_type,
        cost,
        reverse_cost,
        elevation_gain,
        elevation_loss,
        the_geom
      FROM ${this.config.stagingSchema}.ways
    `);
    
    // Add source and target columns
    await this.pgClient.query(`
      ALTER TABLE ${this.config.stagingSchema}.ways_noded 
      ADD COLUMN source integer,
      ADD COLUMN target integer
    `);
    
    // Use pgr_createTopology to properly assign source/target and create vertices
    console.log('  Using pgr_createTopology for proper vertex assignment...');
    
    // First, let's check if the table has the right structure
    const columnsCheck = await this.pgClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'ways_noded'
      ORDER BY ordinal_position
    `, [this.config.stagingSchema]);
    
    console.log(`  ways_noded columns: ${columnsCheck.rows.map(r => r.column_name).join(', ')}`);
    
    // Try pgr_createTopology with explicit schema qualification
    const topologyResult = await this.pgClient.query(`
      SELECT pgr_createTopology(
        '${this.config.stagingSchema}.ways_noded', 
        0.000001, 
        'the_geom', 
        'id', 
        'source', 
        'target', 
        '${this.config.stagingSchema}.ways_noded_vertices_pgr'
      )
    `);
    
    console.log(`  pgr_createTopology result: ${JSON.stringify(topologyResult.rows[0])}`);
    
    // If pgr_createTopology failed, try a different approach
    if (!topologyResult.rows[0] || topologyResult.rows[0].pgr_createtopology !== 'OK') {
      console.log(`  ⚠️ pgr_createTopology failed, trying manual approach...`);
      
      // Manually create vertices and assign source/target
      await this.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.ways_noded_vertices_pgr (id, the_geom, cnt)
        WITH all_points AS (
          SELECT ST_StartPoint(the_geom) as point FROM ${this.config.stagingSchema}.ways_noded
          UNION ALL
          SELECT ST_EndPoint(the_geom) as point FROM ${this.config.stagingSchema}.ways_noded
        ),
        unique_points AS (
          SELECT DISTINCT ON (ST_AsText(point)) point FROM all_points
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ST_X(point), ST_Y(point)) as id,
          point as the_geom,
          0 as cnt
        FROM unique_points
      `);
      
      // Update source/target based on nearest vertices
      await this.pgClient.query(`
        UPDATE ${this.config.stagingSchema}.ways_noded 
        SET 
          source = (
            SELECT v.id 
            FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v 
            ORDER BY ST_Distance(ST_StartPoint(wn.the_geom), v.the_geom) 
            LIMIT 1
          ),
          target = (
            SELECT v.id 
            FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v 
            ORDER BY ST_Distance(ST_EndPoint(wn.the_geom), v.the_geom) 
            LIMIT 1
          )
        FROM ${this.config.stagingSchema}.ways_noded wn
        WHERE wn.id = ways_noded.id
      `);
    }
    
    // Verify that source/target were populated
    const nullCheck = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN source IS NOT NULL THEN 1 END) as edges_with_source,
        COUNT(CASE WHEN target IS NOT NULL THEN 1 END) as edges_with_target
      FROM ${this.config.stagingSchema}.ways_noded
    `);
    
    const stats = nullCheck.rows[0];
    console.log(`  Topology check: ${stats.total_edges} total edges, ${stats.edges_with_source} with source, ${stats.edges_with_target} with target`);
    
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
        COALESCE(w.trail_uuid::text, 'edge-' || wn.id::text) as trail_id,
        COALESCE(w.trail_name, 'Unnamed Trail') as trail_name,
        wn.length_km as length_km,
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
    
    // Debug: Check what's in ways_noded
    const waysNodedCheck = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN source IS NOT NULL THEN 1 END) as with_source,
        COUNT(CASE WHEN target IS NOT NULL THEN 1 END) as with_target,
        COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as with_both
      FROM ${this.config.stagingSchema}.ways_noded
    `);
    
    console.log(`  ways_noded debug: ${waysNodedCheck.rows[0].total} total, ${waysNodedCheck.rows[0].with_source} with source, ${waysNodedCheck.rows[0].with_target} with target, ${waysNodedCheck.rows[0].with_both} with both`);
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
