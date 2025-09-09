import { Pool } from 'pg';
import { YIntersectionSplittingService } from '../layer1/YIntersectionSplittingService';
import { PointSnapAndSplitService } from '../layer1/PointSnapAndSplitService';

export interface GraphSAGEDrivenCleaningConfig {
  stagingSchema: string;
  confidence_threshold: number;
  dry_run: boolean;
  snapToleranceMeters?: number;
  minSplitDistanceMeters?: number;
}

export interface GraphSAGEDrivenCleaningResult {
  nodes_processed: number;
  nodes_split: number;
  edges_created: number;
  edges_removed: number;
  cleaning_summary: string[];
  errors: string[];
}

export class GraphSAGEDrivenNetworkCleaningService {
  private pgClient: Pool;
  private config: GraphSAGEDrivenCleaningConfig;
  private yIntersectionSplitter: YIntersectionSplittingService;
  private pointSnapSplitter: PointSnapAndSplitService;

  constructor(pgClient: Pool, config: GraphSAGEDrivenCleaningConfig) {
    this.pgClient = pgClient;
    this.config = config;
    this.yIntersectionSplitter = new YIntersectionSplittingService(pgClient, config.stagingSchema, {
      toleranceMeters: config.snapToleranceMeters || 10,
      minTrailLengthMeters: 5,
      minSnapDistanceMeters: config.minSplitDistanceMeters || 1.0,
      maxIterations: 1 // Only one iteration since we're targeting specific nodes
    });
    this.pointSnapSplitter = new PointSnapAndSplitService({
      stagingSchema: config.stagingSchema,
      pgClient: pgClient,
      snapToleranceMeters: config.snapToleranceMeters || 10,
      verbose: true
    });
  }

  /**
   * Load GraphSAGE predictions from JSON file
   */
  async loadPredictionsFromFile(predictionsPath: string): Promise<any[]> {
    console.log('🔍 Loading GraphSAGE predictions from file...');
    
    const fs = require('fs');
    const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf8'));
    
    // Filter by confidence threshold
    const filteredPredictions = predictions.predictions
      .map((prediction: number, nodeId: number) => ({
        node_id: nodeId,
        prediction: prediction,
        confidence: 1.0 // We don't have confidence scores in the current predictions
      }))
      .filter((p: any) => p.prediction === 2 && p.confidence >= this.config.confidence_threshold);
    
    console.log(`✅ Loaded ${filteredPredictions.length} split predictions (confidence >= ${this.config.confidence_threshold})`);
    
    return filteredPredictions;
  }

  /**
   * Get node coordinates and connected trails for a specific node
   */
  async getNodeDetails(nodeId: number): Promise<any> {
    const query = `
      SELECT 
        v.id,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        ST_Z(v.the_geom) as elevation,
        v.the_geom,
        COUNT(e.id) as degree,
        ARRAY_AGG(DISTINCT e.id) as edge_ids,
        ARRAY_AGG(DISTINCT t.name) as trail_names
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      LEFT JOIN ${this.config.stagingSchema}.ways_noded e 
        ON (e.source = v.id OR e.target = v.id)
      LEFT JOIN ${this.config.stagingSchema}.trails t
        ON t.geometry && v.the_geom
      WHERE v.id = $1
      GROUP BY v.id, v.the_geom
    `;
    
    const result = await this.pgClient.query(query, [nodeId]);
    return result.rows[0] || null;
  }

  /**
   * Find nearby trails that could be split at this node
   */
  async findNearbyTrailsForSplitting(nodeId: number): Promise<any[]> {
    const nodeDetails = await this.getNodeDetails(nodeId);
    if (!nodeDetails) {
      return [];
    }

    const query = `
      SELECT 
        t.app_uuid,
        t.name,
        t.geometry,
        ST_Distance(t.geometry, $1::geometry) as distance_meters
      FROM ${this.config.stagingSchema}.trails t
      WHERE ST_DWithin(t.geometry, $1::geometry, $2)
        AND ST_GeometryType(t.geometry) = 'ST_LineString'
        AND ST_Length(t.geometry::geography) > $3
      ORDER BY ST_Distance(t.geometry, $1::geometry)
    `;
    
    const result = await this.pgClient.query(query, [
      nodeDetails.the_geom,
      this.config.snapToleranceMeters || 10,
      this.config.minSplitDistanceMeters || 1.0
    ]);
    
    return result.rows;
  }

  /**
   * Apply proper Y/T intersection splitting for a specific node
   */
  async splitNodeAtIntersection(nodeId: number): Promise<boolean> {
    console.log(`   ✂️  Processing Y/T intersection node ${nodeId}...`);
    
    const nodeDetails = await this.getNodeDetails(nodeId);
    if (!nodeDetails) {
      console.log(`   ⚠️  Node ${nodeId} not found`);
      return false;
    }

    if (nodeDetails.degree < 3) {
      console.log(`   ⚠️  Node ${nodeId} is not a Y/T intersection (degree ${nodeDetails.degree}), skipping`);
      return false;
    }

    console.log(`   📍 Node ${nodeId} at (${nodeDetails.lat.toFixed(6)}, ${nodeDetails.lng.toFixed(6)}) with degree ${nodeDetails.degree}`);

    if (this.config.dry_run) {
      console.log(`   [DRY RUN] Would split Y/T intersection node ${nodeId}`);
      return true;
    }

    try {
      // Find nearby trails that could be split
      const nearbyTrails = await this.findNearbyTrailsForSplitting(nodeId);
      
      if (nearbyTrails.length === 0) {
        console.log(`   ⚠️  No nearby trails found for splitting at node ${nodeId}`);
        return false;
      }

      console.log(`   🔍 Found ${nearbyTrails.length} nearby trails for potential splitting`);

      // Use the PointSnapAndSplitService to snap and split
      let successCount = 0;
      
      // Add the point to be snapped and split
      this.pointSnapSplitter.addPoint({
        lng: nodeDetails.lng,
        lat: nodeDetails.lat,
        elevation: nodeDetails.elevation,
        description: `GraphSAGE node ${nodeId} (degree ${nodeDetails.degree})`,
        preferredTrailName: nearbyTrails[0]?.name // Use the closest trail as preferred
      });
      
      // Execute the snap and split operation
      const splitResult = await this.pointSnapSplitter.execute();
      
      if (splitResult.success && splitResult.trailsSplit > 0) {
        console.log(`   ✅ Successfully split ${splitResult.trailsSplit} trail(s) at node ${nodeId}`);
        successCount = splitResult.trailsSplit;
      } else if (splitResult.success) {
        console.log(`   ℹ️  Node ${nodeId} processed but no trails were split`);
      } else {
        console.log(`   ⚠️  Failed to process node ${nodeId}: ${splitResult.error}`);
      }

      return successCount > 0;
      
    } catch (error) {
      console.log(`   ❌ Error processing node ${nodeId}:`, error);
      return false;
    }
  }

  /**
   * Apply GraphSAGE-driven network cleaning
   */
  async applyGraphSAGEDrivenCleaning(predictionsPath: string): Promise<GraphSAGEDrivenCleaningResult> {
    console.log('🚀 Starting GraphSAGE-driven network cleaning...');
    console.log(`   Schema: ${this.config.stagingSchema}`);
    console.log(`   Confidence threshold: ${this.config.confidence_threshold}`);
    console.log(`   Dry run: ${this.config.dry_run}`);
    console.log(`   Snap tolerance: ${this.config.snapToleranceMeters || 10}m`);
    console.log(`   Min split distance: ${this.config.minSplitDistanceMeters || 1.0}m`);
    
    const predictions = await this.loadPredictionsFromFile(predictionsPath);
    
    const result: GraphSAGEDrivenCleaningResult = {
      nodes_processed: 0,
      nodes_split: 0,
      edges_created: 0,
      edges_removed: 0,
      cleaning_summary: [],
      errors: []
    };
    
    if (predictions.length === 0) {
      console.log('   ℹ️  No split predictions to apply');
      return result;
    }

    console.log(`\n📊 Applying ${predictions.length} split predictions...`);
    
    for (const prediction of predictions) {
      result.nodes_processed++;
      
      try {
        const success = await this.splitNodeAtIntersection(prediction.node_id);
        
        if (success) {
          result.nodes_split++;
          result.edges_created += 2; // Splitting typically creates 2 new edges
          result.cleaning_summary.push(`Split Y/T intersection node ${prediction.node_id}`);
        } else {
          result.errors.push(`Failed to split node ${prediction.node_id}`);
        }
      } catch (error) {
        result.errors.push(`Error processing node ${prediction.node_id}: ${error}`);
      }
    }
    
    console.log(`\n✅ GraphSAGE-driven network cleaning complete!`);
    console.log(`   • Nodes processed: ${result.nodes_processed}`);
    console.log(`   • Nodes split: ${result.nodes_split}`);
    console.log(`   • Edges created: ${result.edges_created}`);
    console.log(`   • Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered:`);
      result.errors.forEach(error => console.log(`   • ${error}`));
    }
    
    return result;
  }
}
