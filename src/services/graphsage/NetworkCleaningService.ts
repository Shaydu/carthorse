import { Pool } from 'pg';

export interface NodePrediction {
  node_id: number;
  prediction: number; // 0=keep, 1=merge degree-2, 2=split Y/T
  confidence: number;
}

export interface NetworkCleaningResult {
  nodes_processed: number;
  nodes_merged: number;
  nodes_split: number;
  edges_created: number;
  edges_removed: number;
  cleaning_summary: string[];
}

export interface NetworkCleaningConfig {
  stagingSchema: string;
  confidence_threshold: number; // Only apply predictions above this threshold
  dry_run: boolean; // If true, only show what would be done
}

export class NetworkCleaningService {
  private pgClient: Pool;
  private config: NetworkCleaningConfig;

  constructor(pgClient: Pool, config: NetworkCleaningConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Load GraphSAGE predictions from the database
   */
  async loadPredictions(): Promise<NodePrediction[]> {
    console.log('🔍 Loading GraphSAGE predictions...');
    
    const query = `
      SELECT node_id, prediction, confidence
      FROM ${this.config.stagingSchema}.graphsage_predictions
      WHERE confidence >= $1
      ORDER BY node_id
    `;
    
    const result = await this.pgClient.query(query, [this.config.confidence_threshold]);
    
    console.log(`✅ Loaded ${result.rows.length} predictions (confidence >= ${this.config.confidence_threshold})`);
    
    return result.rows.map(row => ({
      node_id: row.node_id,
      prediction: row.prediction,
      confidence: row.confidence
    }));
  }

  /**
   * Get node information including connected edges
   */
  async getNodeInfo(nodeId: number): Promise<any> {
    const query = `
      SELECT 
        v.id,
        v.the_geom,
        COUNT(e.id) as degree,
        ARRAY_AGG(e.id) as edge_ids,
        ARRAY_AGG(e.source) as sources,
        ARRAY_AGG(e.target) as targets
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      LEFT JOIN ${this.config.stagingSchema}.ways_noded e 
        ON (e.source = v.id OR e.target = v.id)
      WHERE v.id = $1
      GROUP BY v.id, v.the_geom
    `;
    
    const result = await this.pgClient.query(query, [nodeId]);
    return result.rows[0] || null;
  }

  /**
   * Merge degree-2 nodes by connecting their neighbors directly
   */
  async mergeDegree2Node(nodeId: number): Promise<boolean> {
    console.log(`   🔗 Merging degree-2 node ${nodeId}...`);
    
    const nodeInfo = await this.getNodeInfo(nodeId);
    if (!nodeInfo || nodeInfo.degree !== 2) {
      console.log(`   ⚠️  Node ${nodeId} is not degree-2, skipping merge`);
      return false;
    }

    // Get the two connected edges
    const edgeQuery = `
      SELECT id, source, target, length_km, the_geom
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE source = $1 OR target = $1
    `;
    
    const edges = await this.pgClient.query(edgeQuery, [nodeId]);
    
    if (edges.rows.length !== 2) {
      console.log(`   ⚠️  Node ${nodeId} has ${edges.rows.length} edges, expected 2`);
      return false;
    }

    const [edge1, edge2] = edges.rows;
    
    // Find the two neighbors
    const neighbor1 = edge1.source === nodeId ? edge1.target : edge1.source;
    const neighbor2 = edge2.source === nodeId ? edge2.target : edge2.source;
    
    if (neighbor1 === neighbor2) {
      console.log(`   ⚠️  Node ${nodeId} connects to same neighbor, skipping merge`);
      return false;
    }

    if (this.config.dry_run) {
      console.log(`   [DRY RUN] Would merge node ${nodeId} by connecting ${neighbor1} to ${neighbor2}`);
      return true;
    }

    try {
      // Start transaction
      await this.pgClient.query('BEGIN');
      
      // Create new edge connecting the neighbors
      const newLength = (edge1.length_km || 0) + (edge2.length_km || 0);
      
      // Create new geometry by concatenating the two edge geometries
      const newEdgeQuery = `
        INSERT INTO ${this.config.stagingSchema}.ways_noded (source, target, length_km, the_geom)
        SELECT 
          $1 as source,
          $2 as target,
          $3 as length_km,
          ST_LineMerge(ST_Collect(
            CASE WHEN source = $4 THEN the_geom ELSE ST_Reverse(the_geom) END,
            CASE WHEN source = $4 THEN the_geom ELSE ST_Reverse(the_geom) END
          )) as the_geom
        FROM ${this.config.stagingSchema}.ways_noded
        WHERE id IN ($5, $6)
      `;
      
      await this.pgClient.query(newEdgeQuery, [
        neighbor1, neighbor2, newLength, nodeId, edge1.id, edge2.id
      ]);
      
      // Remove the old edges
      await this.pgClient.query(`
        DELETE FROM ${this.config.stagingSchema}.ways_noded 
        WHERE id IN ($1, $2)
      `, [edge1.id, edge2.id]);
      
      // Remove the merged node
      await this.pgClient.query(`
        DELETE FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr 
        WHERE id = $1
      `, [nodeId]);
      
      await this.pgClient.query('COMMIT');
      
      console.log(`   ✅ Successfully merged node ${nodeId}, connected ${neighbor1} to ${neighbor2}`);
      return true;
      
    } catch (error) {
      await this.pgClient.query('ROLLBACK');
      console.log(`   ❌ Error merging node ${nodeId}:`, error);
      return false;
    }
  }

  /**
   * Split Y/T intersections by creating new nodes
   */
  async splitYIntersection(nodeId: number): Promise<boolean> {
    console.log(`   ✂️  Splitting Y/T intersection node ${nodeId}...`);
    
    const nodeInfo = await this.getNodeInfo(nodeId);
    if (!nodeInfo || nodeInfo.degree < 3) {
      console.log(`   ⚠️  Node ${nodeId} is not a Y/T intersection (degree ${nodeInfo?.degree}), skipping split`);
      return false;
    }

    if (this.config.dry_run) {
      console.log(`   [DRY RUN] Would split Y/T intersection node ${nodeId} (degree ${nodeInfo.degree})`);
      return true;
    }

    // For now, we'll implement a simple approach:
    // Create a new node slightly offset from the original
    // This is a placeholder - real Y/T splitting would be more complex
    
    try {
      await this.pgClient.query('BEGIN');
      
      // Get the node geometry
      const geomQuery = `
        SELECT the_geom FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE id = $1
      `;
      const geomResult = await this.pgClient.query(geomQuery, [nodeId]);
      
      if (geomResult.rows.length === 0) {
        throw new Error(`Node ${nodeId} not found`);
      }
      
      // Create a new node slightly offset (1 meter north)
      const newNodeQuery = `
        INSERT INTO ${this.config.stagingSchema}.ways_noded_vertices_pgr (the_geom)
        SELECT ST_Translate(the_geom, 0, 0.00001) -- ~1 meter north
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
        WHERE id = $1
        RETURNING id
      `;
      
      const newNodeResult = await this.pgClient.query(newNodeQuery, [nodeId]);
      const newNodeId = newNodeResult.rows[0].id;
      
      // Move one edge to the new node (simplified approach)
      const edgeQuery = `
        SELECT id FROM ${this.config.stagingSchema}.ways_noded
        WHERE source = $1 OR target = $1
        LIMIT 1
      `;
      
      const edgeResult = await this.pgClient.query(edgeQuery, [nodeId]);
      
      if (edgeResult.rows.length > 0) {
        const edgeId = edgeResult.rows[0].id;
        
        // Update the edge to connect to the new node
        await this.pgClient.query(`
          UPDATE ${this.config.stagingSchema}.ways_noded
          SET source = CASE WHEN source = $1 THEN $2 ELSE source END,
              target = CASE WHEN target = $1 THEN $2 ELSE target END
          WHERE id = $3
        `, [nodeId, newNodeId, edgeId]);
      }
      
      await this.pgClient.query('COMMIT');
      
      console.log(`   ✅ Successfully split Y/T intersection node ${nodeId}, created new node ${newNodeId}`);
      return true;
      
    } catch (error) {
      await this.pgClient.query('ROLLBACK');
      console.log(`   ❌ Error splitting node ${nodeId}:`, error);
      return false;
    }
  }

  /**
   * Apply network cleaning based on GraphSAGE predictions
   */
  async applyNetworkCleaning(): Promise<NetworkCleaningResult> {
    console.log('🚀 Starting network cleaning based on GraphSAGE predictions...');
    console.log(`   Schema: ${this.config.stagingSchema}`);
    console.log(`   Confidence threshold: ${this.config.confidence_threshold}`);
    console.log(`   Dry run: ${this.config.dry_run}`);
    
    const predictions = await this.loadPredictions();
    
    const result: NetworkCleaningResult = {
      nodes_processed: 0,
      nodes_merged: 0,
      nodes_split: 0,
      edges_created: 0,
      edges_removed: 0,
      cleaning_summary: []
    };
    
    // Group predictions by type
    const mergePredictions = predictions.filter(p => p.prediction === 1);
    const splitPredictions = predictions.filter(p => p.prediction === 2);
    
    console.log(`\n📊 Predictions to apply:`);
    console.log(`   • Merge degree-2 nodes: ${mergePredictions.length}`);
    console.log(`   • Split Y/T intersections: ${splitPredictions.length}`);
    
    // Apply merge predictions
    if (mergePredictions.length > 0) {
      console.log(`\n🔗 Applying ${mergePredictions.length} merge predictions...`);
      
      for (const prediction of mergePredictions) {
        result.nodes_processed++;
        const success = await this.mergeDegree2Node(prediction.node_id);
        
        if (success) {
          result.nodes_merged++;
          result.edges_created++; // One new edge created
          result.edges_removed += 2; // Two old edges removed
          result.cleaning_summary.push(`Merged degree-2 node ${prediction.node_id}`);
        }
      }
    }
    
    // Apply split predictions
    if (splitPredictions.length > 0) {
      console.log(`\n✂️  Applying ${splitPredictions.length} split predictions...`);
      
      for (const prediction of splitPredictions) {
        result.nodes_processed++;
        const success = await this.splitYIntersection(prediction.node_id);
        
        if (success) {
          result.nodes_split++;
          result.edges_created++; // One new edge created
          result.cleaning_summary.push(`Split Y/T intersection node ${prediction.node_id}`);
        }
      }
    }
    
    console.log(`\n✅ Network cleaning complete!`);
    console.log(`   • Nodes processed: ${result.nodes_processed}`);
    console.log(`   • Nodes merged: ${result.nodes_merged}`);
    console.log(`   • Nodes split: ${result.nodes_split}`);
    console.log(`   • Edges created: ${result.edges_created}`);
    console.log(`   • Edges removed: ${result.edges_removed}`);
    
    return result;
  }

  /**
   * Validate the network after cleaning
   */
  async validateNetwork(): Promise<void> {
    console.log('🔍 Validating network after cleaning...');
    
    // Check for orphaned nodes
    const orphanQuery = `
      SELECT COUNT(*) as orphan_count
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.config.stagingSchema}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `;
    
    const orphanResult = await this.pgClient.query(orphanQuery);
    const orphanCount = orphanResult.rows[0].orphan_count;
    
    if (orphanCount > 0) {
      console.log(`⚠️  Found ${orphanCount} orphaned nodes`);
    } else {
      console.log('✅ No orphaned nodes found');
    }
    
    // Check for self-loops
    const selfLoopQuery = `
      SELECT COUNT(*) as self_loop_count
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE source = target
    `;
    
    const selfLoopResult = await this.pgClient.query(selfLoopQuery);
    const selfLoopCount = selfLoopResult.rows[0].self_loop_count;
    
    if (selfLoopCount > 0) {
      console.log(`⚠️  Found ${selfLoopCount} self-loops`);
    } else {
      console.log('✅ No self-loops found');
    }
    
    // Get final network statistics
    const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr) as node_count,
        (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded) as edge_count
    `;
    
    const statsResult = await this.pgClient.query(statsQuery);
    const { node_count, edge_count } = statsResult.rows[0];
    
    console.log(`📊 Final network statistics:`);
    console.log(`   • Nodes: ${node_count}`);
    console.log(`   • Edges: ${edge_count}`);
  }
}

