import { Client } from 'pg';

/**
 * LoopProcessor - Handles detection and processing of loop trails
 * 
 * Loops are trails that begin and end at the same point. This processor:
 * 1. Identifies loop segments in trail data
 * 2. Splits loops into manageable segments
 * 3. Creates nodes and edges for routing
 * 4. Integrates loops with the main routing network
 */
export class LoopProcessor {
  private pgClient: Client;
  private stagingSchema: string;

  constructor(pgClient: Client, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Detect and process loops in the trail network
   * Loops are trails that begin and end at the same point
   */
  async detectAndProcessLoops(nodeToleranceMeters: number, edgeToleranceMeters: number): Promise<void> {
    console.log(`🔄 Detecting and processing loops with tolerances: ${nodeToleranceMeters}m (nodes), ${edgeToleranceMeters}m (edges)`);
    
    const nodeToleranceDegrees = nodeToleranceMeters / 111000.0;
    const edgeToleranceDegrees = edgeToleranceMeters / 111000.0;
    
    // Step 1: Identify loop segments
    console.log('🔄 Step 1: Identifying loop segments...');
    const loopSegmentsResult = await this.pgClient.query(`
      SELECT COUNT(*) as loop_count
      FROM ${this.stagingSchema}.trails
      WHERE ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))
    `);
    const loopCount = parseInt(loopSegmentsResult.rows[0].loop_count);
    console.log(`🔄 Found ${loopCount} loop segments`);
    
    if (loopCount === 0) {
      console.log('🔄 No loops detected, skipping loop processing');
      return;
    }
    
    // Step 2: Split loop geometries into segments
    console.log('🔄 Step 2: Splitting loop geometries into segments...');
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.stagingSchema}.loop_edges;
      CREATE TEMP TABLE ${this.stagingSchema}.loop_edges AS
      SELECT
        l.app_uuid as loop_id,
        l.name as loop_name,
        l.length_km,
        l.elevation_gain,
        l.elevation_loss,
        (ST_Dump(ST_Segmentize(l.geometry, 1.0))).geom AS geometry
      FROM ${this.stagingSchema}.trails l
      WHERE ST_Equals(ST_StartPoint(l.geometry), ST_EndPoint(l.geometry))
    `);
    
    const loopEdgesResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.loop_edges`);
    const loopEdgeCount = parseInt(loopEdgesResult.rows[0].count);
    console.log(`🔄 Created ${loopEdgeCount} loop edge segments`);
    
    // Step 3: Create loop nodes from segments
    console.log('🔄 Step 3: Creating loop nodes from segments...');
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.stagingSchema}.loop_nodes_raw;
      CREATE TEMP TABLE ${this.stagingSchema}.loop_nodes_raw AS
      SELECT ST_StartPoint(geometry) AS geometry FROM ${this.stagingSchema}.loop_edges
      UNION
      SELECT ST_EndPoint(geometry) FROM ${this.stagingSchema}.loop_edges
    `);
    
    // Step 4: Dedupe nodes and snap to grid
    console.log('🔄 Step 4: Deduplicating and snapping loop nodes...');
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.stagingSchema}.loop_nodes;
      CREATE TEMP TABLE ${this.stagingSchema}.loop_nodes AS
      SELECT 
        ROW_NUMBER() OVER (ORDER BY ST_X(ST_SnapToGrid(geometry, ${nodeToleranceDegrees}))) as node_id,
        ST_SnapToGrid(geometry, ${nodeToleranceDegrees}) AS geometry
      FROM ${this.stagingSchema}.loop_nodes_raw
      GROUP BY ST_SnapToGrid(geometry, ${nodeToleranceDegrees})
    `);
    
    const loopNodesResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.loop_nodes`);
    const loopNodeCount = parseInt(loopNodesResult.rows[0].count);
    console.log(`🔄 Created ${loopNodeCount} unique loop nodes`);
    
    // Step 5: Build edges by joining start/end to nodes
    console.log('🔄 Step 5: Building loop edges by joining start/end to nodes...');
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${this.stagingSchema}.loop_edge_network;
      CREATE TEMP TABLE ${this.stagingSchema}.loop_edge_network AS
      SELECT
        e.geometry,
        e.loop_id,
        e.loop_name,
        e.length_km,
        e.elevation_gain,
        e.elevation_loss,
        n1.node_id AS source,
        n2.node_id AS target
      FROM ${this.stagingSchema}.loop_edges e
      JOIN ${this.stagingSchema}.loop_nodes n1 ON ST_DWithin(ST_StartPoint(e.geometry), n1.geometry, ${nodeToleranceDegrees})
      JOIN ${this.stagingSchema}.loop_nodes n2 ON ST_DWithin(ST_EndPoint(e.geometry), n2.geometry, ${nodeToleranceDegrees})
    `);
    
    const loopNetworkResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.loop_edge_network`);
    const loopNetworkCount = parseInt(loopNetworkResult.rows[0].count);
    console.log(`🔄 Created ${loopNetworkCount} loop network edges`);
    
    // Step 6: Add loop nodes to main routing nodes
    console.log('🔄 Step 6: Adding loop nodes to main routing network...');
    const addLoopNodesResult = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.routing_nodes (id, node_uuid, lat, lng, elevation, node_type, connected_trails, trail_ids, created_at)
      SELECT 
        (SELECT COALESCE(MAX(id), 0) FROM ${this.stagingSchema}.routing_nodes) + ln.node_id as id,
        gen_random_uuid() as node_uuid,
        ST_Y(ln.geometry) as lat,
        ST_X(ln.geometry) as lng,
        COALESCE(ST_Z(ln.geometry), 0) as elevation,
        'loop_node' as node_type,
        'loop_segment' as connected_trails,
        ARRAY[]::uuid[] as trail_ids,
        NOW() as created_at
      FROM ${this.stagingSchema}.loop_nodes ln
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.routing_nodes rn 
        WHERE ST_DWithin(
          ST_SetSRID(ST_MakePoint(rn.lng, rn.lat), 4326),
          ln.geometry,
          ${nodeToleranceDegrees}
        )
      )
    `);
    const addedLoopNodesCount = addLoopNodesResult.rowCount;
    console.log(`🔄 Added ${addedLoopNodesCount} new loop nodes to routing network`);
    
    // Step 7: Add loop edges to main routing edges
    console.log('🔄 Step 7: Adding loop edges to main routing network...');
    const addLoopEdgesResult = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
      SELECT 
        rn1.id as source,
        rn2.id as target,
        len.loop_id as trail_id,
        len.loop_name as trail_name,
        len.length_km,
        len.elevation_gain,
        len.elevation_loss,
        ST_Force2D(len.geometry) as geometry,
        ST_AsGeoJSON(ST_Force2D(len.geometry), 6, 0) as geojson
      FROM ${this.stagingSchema}.loop_edge_network len
      JOIN ${this.stagingSchema}.routing_nodes rn1 ON ST_DWithin(
        ST_SetSRID(ST_MakePoint(rn1.lng, rn1.lat), 4326),
        ST_StartPoint(len.geometry),
        ${nodeToleranceDegrees}
      )
      JOIN ${this.stagingSchema}.routing_nodes rn2 ON ST_DWithin(
        ST_SetSRID(ST_MakePoint(rn2.lng, rn2.lat), 4326),
        ST_EndPoint(len.geometry),
        ${nodeToleranceDegrees}
      )
      WHERE rn1.id <> rn2.id
      AND NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.routing_edges re
        WHERE (re.source = rn1.id AND re.target = rn2.id)
        OR (re.source = rn2.id AND re.target = rn1.id)
      )
    `);
    const addedLoopEdgesCount = addLoopEdgesResult.rowCount;
    console.log(`🔄 Added ${addedLoopEdgesCount} new loop edges to routing network`);
    
    // Clean up temporary tables
    console.log('🔄 Cleaning up temporary loop tables...');
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.loop_edges`);
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.loop_nodes_raw`);
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.loop_nodes`);
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.loop_edge_network`);
    
    // Final loop processing summary
    const finalLoopNodesResult = await this.pgClient.query(`
      SELECT COUNT(*) as loop_node_count 
      FROM ${this.stagingSchema}.routing_nodes 
      WHERE node_type = 'loop_node'
    `);
    const finalLoopEdgesResult = await this.pgClient.query(`
      SELECT COUNT(*) as loop_edge_count 
      FROM ${this.stagingSchema}.routing_edges re
      JOIN ${this.stagingSchema}.routing_nodes rn1 ON re.source = rn1.id
      JOIN ${this.stagingSchema}.routing_nodes rn2 ON re.target = rn2.id
      WHERE rn1.node_type = 'loop_node' OR rn2.node_type = 'loop_node'
    `);
    
    const finalLoopNodes = parseInt(finalLoopNodesResult.rows[0].loop_node_count);
    const finalLoopEdges = parseInt(finalLoopEdgesResult.rows[0].loop_edge_count);
    
    console.log(`✅ Loop processing complete:`);
    console.log(`   - Original loops: ${loopCount}`);
    console.log(`   - Loop nodes added: ${finalLoopNodes}`);
    console.log(`   - Loop edges added: ${finalLoopEdges}`);
  }

  /**
   * Get loop statistics for the current staging schema
   */
  async getLoopStatistics(): Promise<{
    totalLoops: number;
    loopNodes: number;
    loopEdges: number;
  }> {
    const loopCountResult = await this.pgClient.query(`
      SELECT COUNT(*) as loop_count
      FROM ${this.stagingSchema}.trails
      WHERE ST_Equals(ST_StartPoint(geometry), ST_EndPoint(geometry))
    `);
    
    const loopNodesResult = await this.pgClient.query(`
      SELECT COUNT(*) as loop_node_count 
      FROM ${this.stagingSchema}.routing_nodes 
      WHERE node_type = 'loop_node'
    `);
    
    const loopEdgesResult = await this.pgClient.query(`
      SELECT COUNT(*) as loop_edge_count 
      FROM ${this.stagingSchema}.routing_edges re
      JOIN ${this.stagingSchema}.routing_nodes rn1 ON re.source = rn1.id
      JOIN ${this.stagingSchema}.routing_nodes rn2 ON re.target = rn2.id
      WHERE rn1.node_type = 'loop_node' OR rn2.node_type = 'loop_node'
    `);
    
    return {
      totalLoops: parseInt(loopCountResult.rows[0].loop_count),
      loopNodes: parseInt(loopNodesResult.rows[0].loop_node_count),
      loopEdges: parseInt(loopEdgesResult.rows[0].loop_edge_count)
    };
  }
} 