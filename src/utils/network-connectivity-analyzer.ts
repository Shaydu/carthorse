import { Pool } from 'pg';

export interface ConnectivityAnalysis {
  missingConnections: MissingConnection[];
  disconnectedComponents: DisconnectedComponent[];
  connectivityScore: number;
  networkMetrics: NetworkMetrics;
  recommendations: string[];
  missingTrailSegments?: MissingTrailSegment[]; // Added
}

export interface MissingConnection {
  trail1_id: string;
  trail1_name: string;
  trail1_endpoint: [number, number];
  trail2_id: string;
  trail2_name: string;
  trail2_endpoint: [number, number];
  distance_meters: number;
  connection_type: 'endpoint-to-endpoint' | 'endpoint-to-trail' | 'trail-to-trail';
  recommended_tolerance: number;
  has_original_trail?: boolean;
  original_trail_name?: string;
}

export interface DisconnectedComponent {
  component_id: number;
  trail_count: number;
  trails: string[];
  total_length_km: number;
  bounding_box: [number, number, number, number];
}

export interface NetworkMetrics {
  total_nodes: number;
  total_edges: number;
  isolated_nodes: number;
  articulation_points: number;
  bridges: number;
  average_degree: number;
  network_density: number;
  largest_component_size: number;
  component_count: number;
  average_path_length: number;
  network_diameter: number;
}

// Added new interfaces for missing trail analysis
export interface MissingTrailSegment {
  app_uuid: string;
  name: string;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  geometry: string; // WKT format
  reason_lost: 'invalid_geometry' | 'too_short' | 'topology_error' | 'node_network_error' | 'unknown';
  original_trail_id?: number;
  region: string;
  trail_type?: string;
  surface?: string;
  difficulty?: string;
}

export interface TrailSegmentAnalysis {
  original_trails_count: number;
  processed_trails_count: number;
  lost_trails_count: number;
  missing_segments: MissingTrailSegment[];
  restoration_recommendations: string[];
}

// Added new interfaces for dry-run analysis
export interface PotentialConnectorNode {
  id: string;
  position: [number, number]; // [lon, lat]
  connection_type: 'endpoint-to-endpoint' | 'endpoint-to-trail' | 'trail-to-trail';
  connected_trails: string[];
  distance_meters: number;
  impact_score: number; // 0-100, higher = more beneficial
  benefits: string[];
  estimated_route_improvement: number; // estimated % improvement in route diversity
}

export interface DryRunAnalysis {
  potential_connectors: PotentialConnectorNode[];
  estimated_network_improvements: {
    connectivity_score_increase: number;
    component_reduction: number;
    average_path_length_decrease: number;
    network_density_increase: number;
    route_diversity_improvement: number;
  };
  recommended_connectors: PotentialConnectorNode[];
  visualization_data: {
    connector_nodes: any[]; // GeoJSON features for visualization
    connection_lines: any[]; // GeoJSON features for connection lines
    impact_heatmap: any[]; // GeoJSON features for impact visualization
  };
}

export interface NetworkConnectivityAnalyzerConfig {
  stagingSchema: string;
  intersectionTolerance: number; // meters
  endpointTolerance: number; // meters
  maxConnectionDistance: number; // meters
  minTrailLength: number; // meters
  analyzeMissingTrails?: boolean; // Added: enable missing trail analysis
  productionSchema?: string; // Added: production schema name (default: 'public')
  dryRunMode?: boolean; // Added: enable dry-run analysis mode
  maxConnectorsToAnalyze?: number; // Added: limit number of connectors to analyze
  minImpactScore?: number; // Added: minimum impact score to consider
  fastAnalysis?: boolean; // Added: use fast custom analysis instead of pgr_analyzeGraph
  quickCheck?: boolean; // Added: use ultra-fast connectivity check only
}

export class NetworkConnectivityAnalyzer {
  constructor(
    private pgClient: Pool,
    private config: NetworkConnectivityAnalyzerConfig
  ) {}

  /**
   * Analyze network connectivity and identify missing connections
   */
  async analyzeConnectivity(): Promise<ConnectivityAnalysis> {
    console.log('🔍 Analyzing network connectivity...');
    
    const missingConnections = await this.findMissingConnections();
    const disconnectedComponents = await this.findDisconnectedComponents();
    const connectivityScore = await this.calculateConnectivityScore();
    const networkMetrics = await this.calculateNetworkMetrics();
    
    // Added: Analyze missing trail segments if enabled
    let missingTrailSegments: MissingTrailSegment[] = [];
    if (this.config.analyzeMissingTrails) {
      const trailAnalysis = await this.analyzeMissingTrailSegments();
      missingTrailSegments = trailAnalysis.missing_segments;
      console.log(`🔍 Missing trail analysis: ${trailAnalysis.lost_trails_count} trails lost during processing`);
    }
    
    const recommendations = this.generateRecommendations(
      missingConnections, 
      disconnectedComponents, 
      networkMetrics,
      missingTrailSegments
    );
    
    console.log(`✅ Connectivity analysis complete:`);
    console.log(`   🔗 Missing connections: ${missingConnections.length}`);
    console.log(`   🧩 Disconnected components: ${disconnectedComponents.length}`);
    console.log(`   📊 Connectivity score: ${connectivityScore.toFixed(2)}%`);
    console.log(`   📈 Network metrics calculated`);
    if (this.config.analyzeMissingTrails) {
      console.log(`   🚫 Missing trail segments: ${missingTrailSegments.length}`);
    }
    
    return {
      missingConnections,
      disconnectedComponents,
      connectivityScore,
      networkMetrics,
      recommendations,
      missingTrailSegments
    };
  }

  /**
   * Perform dry-run analysis to visualize potential connector nodes
   */
  async performDryRunAnalysis(): Promise<DryRunAnalysis> {
    console.log('🔍 Performing dry-run analysis of potential connector nodes...');
    
    // Get missing connections
    const missingConnections = await this.findMissingConnections();
    
    // Limit the number of connections to analyze
    const maxConnectors = this.config.maxConnectorsToAnalyze || 50;
    const connectionsToAnalyze = missingConnections.slice(0, maxConnectors);
    
    console.log(`📊 Analyzing ${connectionsToAnalyze.length} potential connections...`);
    
    // Generate potential connector nodes
    const potentialConnectors: PotentialConnectorNode[] = [];
    
    for (const connection of connectionsToAnalyze) {
      const connector = await this.analyzePotentialConnector(connection);
      if (connector.impact_score >= (this.config.minImpactScore || 0)) {
        potentialConnectors.push(connector);
      }
    }
    
    // Sort by impact score (highest first)
    potentialConnectors.sort((a, b) => b.impact_score - a.impact_score);
    
    // Calculate estimated network improvements
    const estimatedImprovements = await this.calculateEstimatedNetworkImprovements(potentialConnectors);
    
    // Generate visualization data
    const visualizationData = await this.generateVisualizationData(potentialConnectors);
    
    // Get recommended connectors (top 20% by impact score)
    const recommendedCount = Math.min(20, Math.ceil(potentialConnectors.length * 0.2));
    const recommendedConnectors = potentialConnectors.slice(0, recommendedCount);
    
    const analysis: DryRunAnalysis = {
      potential_connectors: potentialConnectors,
      estimated_network_improvements: estimatedImprovements,
      recommended_connectors: recommendedConnectors,
      visualization_data: visualizationData
    };
    
    console.log(`✅ Dry-run analysis complete:`);
    console.log(`   🔗 Potential connectors: ${potentialConnectors.length}`);
    console.log(`   ⭐ Recommended connectors: ${recommendedConnectors.length}`);
    console.log(`   📈 Estimated connectivity improvement: ${estimatedImprovements.connectivity_score_increase.toFixed(2)}%`);
    
    return analysis;
  }

  /**
   * Analyze a single potential connector and calculate its impact
   */
  private async analyzePotentialConnector(connection: MissingConnection): Promise<PotentialConnectorNode> {
    // Calculate midpoint position
    const midpoint: [number, number] = [
      (connection.trail1_endpoint[0] + connection.trail2_endpoint[0]) / 2,
      (connection.trail1_endpoint[1] + connection.trail2_endpoint[1]) / 2
    ];
    
    // Calculate impact score based on multiple factors
    let impactScore = 0;
    const benefits: string[] = [];
    
    // Factor 1: Distance (closer is better)
    const distanceScore = Math.max(0, 100 - (connection.distance_meters / this.config.maxConnectionDistance) * 100);
    impactScore += distanceScore * 0.3;
    
    // Factor 2: Trail length (longer trails are more valuable)
    const trail1Length = await this.getTrailLength(connection.trail1_id);
    const trail2Length = await this.getTrailLength(connection.trail2_id);
    const lengthScore = Math.min(100, (trail1Length + trail2Length) / 10); // Normalize to 0-100
    impactScore += lengthScore * 0.2;
    
    // Factor 3: Elevation gain (more challenging trails are valuable)
    const trail1Elevation = await this.getTrailElevation(connection.trail1_id);
    const trail2Elevation = await this.getTrailElevation(connection.trail2_id);
    const elevationScore = Math.min(100, (trail1Elevation + trail2Elevation) / 20); // Normalize to 0-100
    impactScore += elevationScore * 0.2;
    
    // Factor 4: Network position (connecting isolated areas is valuable)
    const networkPositionScore = await this.calculateNetworkPositionScore(connection);
    impactScore += networkPositionScore * 0.3;
    
    // Determine benefits
    if (connection.distance_meters <= this.config.intersectionTolerance) {
      benefits.push('High-priority connection (within intersection tolerance)');
    }
    
    if (trail1Length + trail2Length > 10) {
      benefits.push('Connects long trails (>10km combined)');
    }
    
    if (trail1Elevation + trail2Elevation > 1000) {
      benefits.push('Connects challenging trails (>1000m combined elevation)');
    }
    
    if (networkPositionScore > 70) {
      benefits.push('Improves network connectivity significantly');
    }
    
    // Estimate route diversity improvement
    const estimatedRouteImprovement = Math.min(50, impactScore * 0.5);
    
    return {
      id: `connector-${connection.trail1_id}-${connection.trail2_id}`,
      position: midpoint,
      connection_type: connection.connection_type,
      connected_trails: [connection.trail1_name, connection.trail2_name],
      distance_meters: connection.distance_meters,
      impact_score: Math.round(impactScore),
      benefits,
      estimated_route_improvement: estimatedRouteImprovement
    };
  }

  /**
   * Calculate network position score for a connection
   */
  private async calculateNetworkPositionScore(connection: MissingConnection): Promise<number> {
    // Check if this connection would bridge disconnected components
    const component1 = await this.getTrailComponent(connection.trail1_id);
    const component2 = await this.getTrailComponent(connection.trail2_id);
    
    if (component1 !== component2) {
      return 90; // High score for bridging components
    }
    
    // Check if it connects to isolated trails
    const trail1Isolation = await this.getTrailIsolationScore(connection.trail1_id);
    const trail2Isolation = await this.getTrailIsolationScore(connection.trail2_id);
    
    return Math.max(trail1Isolation, trail2Isolation);
  }

  /**
   * Get the component ID for a trail
   */
  private async getTrailComponent(trailId: string): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT component 
      FROM pgr_strongComponents(
        'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
      ) sc
      JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v ON sc.node = v.id
      JOIN ${this.config.stagingSchema}.node_mapping nm ON v.id = nm.pg_id
      JOIN ${this.config.stagingSchema}.edge_mapping em ON nm.pg_id = em.pg_id
      WHERE em.app_uuid = $1
      LIMIT 1
    `, [trailId]);
    
    return result.rows[0]?.component || -1;
  }

  /**
   * Calculate isolation score for a trail (0-100, higher = more isolated)
   */
  private async getTrailIsolationScore(trailId: string): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT COUNT(DISTINCT em2.app_uuid) as connection_count
      FROM ${this.config.stagingSchema}.edge_mapping em1
      JOIN ${this.config.stagingSchema}.routing_edges re1 ON em1.pg_id = re1.id
      JOIN ${this.config.stagingSchema}.routing_edges re2 ON re1.source = re2.source OR re1.target = re2.target
      JOIN ${this.config.stagingSchema}.edge_mapping em2 ON re2.id = em2.pg_id
      WHERE em1.app_uuid = $1 AND em2.app_uuid != $1
    `, [trailId]);
    
    const connectionCount = parseInt(result.rows[0]?.connection_count || '0');
    return Math.max(0, 100 - connectionCount * 10); // Higher score for fewer connections
  }

  /**
   * Get trail length
   */
  private async getTrailLength(trailId: string): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT length_km FROM ${this.config.stagingSchema}.edge_mapping 
      WHERE app_uuid = $1 LIMIT 1
    `, [trailId]);
    
    return parseFloat(result.rows[0]?.length_km || '0');
  }

  /**
   * Get trail elevation gain
   */
  private async getTrailElevation(trailId: string): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT elevation_gain FROM ${this.config.stagingSchema}.edge_mapping 
      WHERE app_uuid = $1 LIMIT 1
    `, [trailId]);
    
    return parseFloat(result.rows[0]?.elevation_gain || '0');
  }

  /**
   * Calculate estimated network improvements from adding connectors
   */
  private async calculateEstimatedNetworkImprovements(connectors: PotentialConnectorNode[]): Promise<DryRunAnalysis['estimated_network_improvements']> {
    // Simple estimation based on connector count and impact scores
    const totalImpact = connectors.reduce((sum, c) => sum + c.impact_score, 0);
    const avgImpact = totalImpact / Math.max(1, connectors.length);
    
    // Estimate improvements based on impact scores
    const connectivityScoreIncrease = Math.min(20, avgImpact * 0.2);
    const componentReduction = Math.min(connectors.length * 0.1, 5);
    const averagePathLengthDecrease = Math.min(2, avgImpact * 0.02);
    const networkDensityIncrease = Math.min(10, avgImpact * 0.1);
    const routeDiversityImprovement = Math.min(30, avgImpact * 0.3);
    
    return {
      connectivity_score_increase: connectivityScoreIncrease,
      component_reduction: componentReduction,
      average_path_length_decrease: averagePathLengthDecrease,
      network_density_increase: networkDensityIncrease,
      route_diversity_improvement: routeDiversityImprovement
    };
  }

  /**
   * Generate visualization data for potential connectors
   */
  private async generateVisualizationData(connectors: PotentialConnectorNode[]): Promise<DryRunAnalysis['visualization_data']> {
    const connectorNodes = connectors.map(connector => ({
      type: 'Feature',
      properties: {
        id: connector.id,
        impact_score: connector.impact_score,
        connection_type: connector.connection_type,
        connected_trails: connector.connected_trails,
        distance_meters: connector.distance_meters,
        benefits: connector.benefits,
        estimated_route_improvement: connector.estimated_route_improvement,
        // Styling properties
        markerSize: Math.max(2, connector.impact_score / 20),
        markerColor: connector.impact_score > 80 ? '#ff0000' : 
                    connector.impact_score > 60 ? '#ff6600' : 
                    connector.impact_score > 40 ? '#ffcc00' : '#00ff00',
        markerSymbol: 'circle',
        opacity: 0.8
      },
      geometry: {
        type: 'Point',
        coordinates: connector.position
      }
    }));
    
    const connectionLines = connectors.map(connector => {
      // Get the actual trail endpoints for visualization
      const trail1Endpoint = connector.connected_trails[0] ? [connector.position[0] - 0.001, connector.position[1] - 0.001] : connector.position;
      const trail2Endpoint = connector.connected_trails[1] ? [connector.position[0] + 0.001, connector.position[1] + 0.001] : connector.position;
      
      return {
        type: 'Feature',
        properties: {
          id: connector.id,
          impact_score: connector.impact_score,
          distance_meters: connector.distance_meters,
          // Styling properties
          strokeColor: connector.impact_score > 80 ? '#ff0000' : 
                      connector.impact_score > 60 ? '#ff6600' : 
                      connector.impact_score > 40 ? '#ffcc00' : '#00ff00',
          strokeWidth: Math.max(1, connector.impact_score / 20),
          strokeOpacity: 0.6,
          strokeDashArray: connector.impact_score > 80 ? 'none' : '5,5' // Dashed for lower priority
        },
        geometry: {
          type: 'LineString',
          coordinates: [trail1Endpoint, trail2Endpoint]
        }
      };
    });
    
    const impactHeatmap = connectors.map(connector => ({
      type: 'Feature',
      properties: {
        id: connector.id,
        impact_score: connector.impact_score,
        weight: connector.impact_score / 100 // Normalize to 0-1 for heatmap
      },
      geometry: {
        type: 'Point',
        coordinates: connector.position
      }
    }));
    
    return {
      connector_nodes: connectorNodes,
      connection_lines: connectionLines,
      impact_heatmap: impactHeatmap
    };
  }

  /**
   * Find missing connections between trails within tolerance using PostGIS spatial functions
   * Enhanced to verify against original trail_master_db.trails table
   */
  private async findMissingConnections(): Promise<MissingConnection[]> {
    console.log('🔍 Finding missing trail connections...');
    
    const result = await this.pgClient.query(`
      WITH trail_endpoints AS (
        -- Get all trail endpoints with their coordinates using PostGIS
        SELECT 
          t.app_uuid as trail_id,
          t.name as trail_name,
          ST_StartPoint(t.geometry) as start_point,
          ST_EndPoint(t.geometry) as end_point,
          ST_X(ST_StartPoint(t.geometry)) as start_lon,
          ST_Y(ST_StartPoint(t.geometry)) as start_lat,
          ST_X(ST_EndPoint(t.geometry)) as end_lon,
          ST_Y(ST_EndPoint(t.geometry)) as end_lat,
          ST_Length(t.geometry) as trail_length
        FROM ${this.config.stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL
          AND ST_Length(t.geometry) >= $1
      ),
      potential_connections AS (
        -- Find all potential connections using PostGIS spatial functions
        -- Focus on actual trail intersections within tolerance
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.start_lon as trail1_lon,
          t1.start_lat as trail1_lat,
          t1.start_point as trail1_point,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.start_lon as trail2_lon,
          t2.start_lat as trail2_lat,
          t2.start_point as trail2_point,
          ST_Distance(t1.start_point, t2.start_point) as distance_meters,
          'endpoint-to-endpoint' as connection_type
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id -- Avoid duplicates
          AND ST_DWithin(t1.start_point, t2.start_point, $2) -- Use precise tolerance
          AND ST_Distance(t1.start_point, t2.start_point) > 0
          
        UNION ALL
        
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.end_lon as trail1_lon,
          t1.end_lat as trail1_lat,
          t1.end_point as trail1_point,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.start_lon as trail2_lon,
          t2.start_lat as trail2_lat,
          t2.start_point as trail2_point,
          ST_Distance(t1.end_point, t2.start_point) as distance_meters,
          'endpoint-to-endpoint' as connection_type
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id != t2.trail_id
          AND ST_DWithin(t1.end_point, t2.start_point, $2) -- Use precise tolerance
          AND ST_Distance(t1.end_point, t2.start_point) > 0
          
        UNION ALL
        
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.end_lon as trail1_lon,
          t1.end_lat as trail1_lat,
          t1.end_point as trail1_point,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.end_lon as trail2_lon,
          t2.end_lat as trail2_lat,
          t2.end_point as trail2_point,
          ST_Distance(t1.end_point, t2.end_point) as distance_meters,
          'endpoint-to-endpoint' as connection_type
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id
          AND ST_DWithin(t1.end_point, t2.end_point, $2) -- Use precise tolerance
          AND ST_Distance(t1.end_point, t2.end_point) > 0
      ),
      existing_connections AS (
        -- Get existing connections from routing edges using pgRouting
        SELECT DISTINCT
          em1.app_uuid as trail1_id,
          em2.app_uuid as trail2_id
        FROM ${this.config.stagingSchema}.routing_edges re1
        JOIN ${this.config.stagingSchema}.edge_mapping em1 ON re1.id = em1.pg_id
        JOIN ${this.config.stagingSchema}.routing_edges re2 ON re1.source = re2.source OR re1.target = re2.target
        JOIN ${this.config.stagingSchema}.edge_mapping em2 ON re2.id = em2.pg_id
        WHERE em1.app_uuid != em2.app_uuid
      ),
      missing_connections AS (
        -- Find connections that don't exist in routing_edges
        SELECT 
          pc.trail1_id,
          pc.trail1_name,
          ARRAY[pc.trail1_lon, pc.trail1_lat] as trail1_endpoint,
          pc.trail2_id,
          pc.trail2_name,
          ARRAY[pc.trail2_lon, pc.trail2_lat] as trail2_endpoint,
          pc.distance_meters,
          pc.connection_type,
          CASE 
            WHEN pc.distance_meters <= $3 THEN $3
            WHEN pc.distance_meters <= $4 THEN $4
            ELSE $5
          END as recommended_tolerance
        FROM potential_connections pc
        LEFT JOIN existing_connections ec ON 
          (pc.trail1_id = ec.trail1_id AND pc.trail2_id = ec.trail2_id) OR
          (pc.trail1_id = ec.trail2_id AND pc.trail2_id = ec.trail1_id)
        WHERE ec.trail1_id IS NULL -- Only missing connections
      ),
      verified_missing_connections AS (
        -- Verify that missing connections correspond to actual trails in trail_master_db
        SELECT 
          mc.*,
          -- Check if there's an actual trail in trail_master_db that could connect these points
          EXISTS (
            SELECT 1 FROM public.trails t
            WHERE ST_DWithin(
              ST_StartPoint(t.geometry), 
              ST_MakePoint(mc.trail1_endpoint[1], mc.trail1_endpoint[2]), 
              $6
            )
            AND ST_DWithin(
              ST_EndPoint(t.geometry), 
              ST_MakePoint(mc.trail2_endpoint[1], mc.trail2_endpoint[2]), 
              $6
            )
            AND t.geometry IS NOT NULL
          ) as has_original_trail,
          -- Find the actual trail name if it exists
          (
            SELECT t.name 
            FROM public.trails t
            WHERE ST_DWithin(
              ST_StartPoint(t.geometry), 
              ST_MakePoint(mc.trail1_endpoint[1], mc.trail1_endpoint[2]), 
              $6
            )
            AND ST_DWithin(
              ST_EndPoint(t.geometry), 
              ST_MakePoint(mc.trail2_endpoint[1], mc.trail2_endpoint[2]), 
              $6
            )
            AND t.geometry IS NOT NULL
            LIMIT 1
          ) as original_trail_name
        FROM missing_connections mc
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail1_endpoint,
        trail2_id,
        trail2_name,
        trail2_endpoint,
        distance_meters,
        connection_type,
        recommended_tolerance,
        has_original_trail,
        original_trail_name
      FROM verified_missing_connections
      WHERE has_original_trail = true -- Only include connections with actual trails
      ORDER BY distance_meters ASC
      LIMIT 100
    `, [
      this.config.minTrailLength,
      this.config.maxConnectionDistance, // Now 50m for broader detection
      this.config.intersectionTolerance,
      this.config.endpointTolerance,
      this.config.maxConnectionDistance,
      50 // Verification tolerance for checking against original trails
    ]);

    const missingConnections: MissingConnection[] = result.rows.map(row => ({
      trail1_id: row.trail1_id,
      trail1_name: row.trail1_name,
      trail1_endpoint: row.trail1_endpoint,
      trail2_id: row.trail2_id,
      trail2_name: row.trail2_name,
      trail2_endpoint: row.trail2_endpoint,
      distance_meters: row.distance_meters,
      connection_type: row.connection_type,
      recommended_tolerance: row.recommended_tolerance,
      has_original_trail: row.has_original_trail,
      original_trail_name: row.original_trail_name
    }));

    console.log(`✅ Found ${missingConnections.length} missing connections within ${this.config.maxConnectionDistance}m tolerance (verified against original trails)`);
    
    if (missingConnections.length > 0) {
      console.log('🔍 Verified missing connections:');
      missingConnections.slice(0, 5).forEach(conn => {
        console.log(`  • ${conn.trail1_name} ↔ ${conn.trail2_name} (${conn.distance_meters.toFixed(1)}m) - Original trail: ${conn.original_trail_name || 'Unknown'}`);
      });
    }
    
    return missingConnections;
  }

  /**
   * Find disconnected components using pgRouting's strongly connected components
   */
  private async findDisconnectedComponents(): Promise<DisconnectedComponent[]> {
    console.log('🔍 Finding disconnected trail components...');
    
    const result = await this.pgClient.query(`
      WITH strongly_connected_components AS (
        -- Use pgRouting's strongly connected components analysis
        SELECT 
          component,
          COUNT(*) as node_count
        FROM pgr_strongComponents(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
        )
        GROUP BY component
        ORDER BY node_count DESC
      ),
      component_trails AS (
        -- Map components to trails
        SELECT 
          scc.component,
          scc.node_count,
          ARRAY_AGG(DISTINCT t.name) as trails,
          SUM(ST_Length(t.geometry)) as total_length_km,
          ARRAY[
            ST_XMin(ST_Collect(t.geometry)),
            ST_YMin(ST_Collect(t.geometry)),
            ST_XMax(ST_Collect(t.geometry)),
            ST_YMax(ST_Collect(t.geometry))
          ] as bounding_box
        FROM strongly_connected_components scc
        JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v ON v.id IN (
          SELECT node FROM pgr_strongComponents(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
          ) WHERE component = scc.component
        )
        JOIN ${this.config.stagingSchema}.node_mapping nm ON v.id = nm.pg_id
        JOIN ${this.config.stagingSchema}.edge_mapping em ON nm.pg_id = em.pg_id
        JOIN ${this.config.stagingSchema}.trails t ON em.app_uuid = t.app_uuid
        GROUP BY scc.component, scc.node_count
      )
      SELECT 
        component,
        node_count as trail_count,
        trails,
        total_length_km,
        bounding_box
      FROM component_trails
      ORDER BY trail_count DESC
    `);

    const disconnectedComponents: DisconnectedComponent[] = result.rows.map(row => ({
      component_id: parseInt(row.component),
      trail_count: parseInt(row.trail_count),
      trails: row.trails,
      total_length_km: parseFloat(row.total_length_km),
      bounding_box: row.bounding_box
    }));

    console.log(`✅ Found ${disconnectedComponents.length} disconnected components`);
    return disconnectedComponents;
  }

  /**
   * Calculate comprehensive network metrics using pgRouting and PostGIS
   */
  private async calculateNetworkMetrics(): Promise<NetworkMetrics> {
    console.log('📊 Calculating network metrics...');
    
    const result = await this.pgClient.query(`
      WITH network_stats AS (
        -- Basic network statistics
        SELECT 
          COUNT(DISTINCT v.id) as total_nodes,
          COUNT(DISTINCT e.id) as total_edges,
          AVG(degree) as average_degree
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        CROSS JOIN ${this.config.stagingSchema}.ways_noded e
        CROSS JOIN LATERAL (
          SELECT COUNT(*) as degree
          FROM ${this.config.stagingSchema}.ways_noded
          WHERE source = v.id OR target = v.id
        ) deg
      ),
      isolated_nodes AS (
        -- Find isolated nodes (degree = 0)
        SELECT COUNT(*) as isolated_count
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        WHERE NOT EXISTS (
          SELECT 1 FROM ${this.config.stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      ),
      articulation_points AS (
        -- Find articulation points using pgRouting
        SELECT COUNT(DISTINCT node) as articulation_count
        FROM pgr_articulationPoints(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
        )
      ),
      bridges AS (
        -- Find bridges using pgRouting
        SELECT COUNT(*) as bridge_count
        FROM pgr_bridges(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
        )
      ),
      component_analysis AS (
        -- Analyze strongly connected components
        SELECT 
          COUNT(*) as component_count,
          MAX(node_count) as largest_component_size
        FROM (
          SELECT component, COUNT(*) as node_count
          FROM pgr_strongComponents(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
          )
          GROUP BY component
        ) comp
      ),
      path_analysis AS (
        -- Calculate average path length and network diameter
        SELECT 
          AVG(agg_cost) as avg_path_length,
          MAX(agg_cost) as network_diameter
        FROM (
          SELECT DISTINCT agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded',
            (SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr LIMIT 1),
            (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr),
            false
          )
          WHERE agg_cost > 0 AND agg_cost < 1000 -- Filter out unreachable nodes
        ) paths
      )
      SELECT 
        ns.total_nodes,
        ns.total_edges,
        iso.isolated_count as isolated_nodes,
        ap.articulation_count as articulation_points,
        b.bridge_count as bridges,
        ns.average_degree,
        CASE 
          WHEN ns.total_nodes > 1 THEN 
            (ns.total_edges::float / (ns.total_nodes * (ns.total_nodes - 1) / 2)) * 100
          ELSE 0 
        END as network_density,
        ca.largest_component_size,
        ca.component_count,
        COALESCE(pa.avg_path_length, 0) as average_path_length,
        COALESCE(pa.network_diameter, 0) as network_diameter
      FROM network_stats ns
      CROSS JOIN isolated_nodes iso
      CROSS JOIN articulation_points ap
      CROSS JOIN bridges b
      CROSS JOIN component_analysis ca
      CROSS JOIN path_analysis pa
    `);

    const metrics = result.rows[0];
    const networkMetrics: NetworkMetrics = {
      total_nodes: parseInt(metrics.total_nodes),
      total_edges: parseInt(metrics.total_edges),
      isolated_nodes: parseInt(metrics.isolated_nodes),
      articulation_points: parseInt(metrics.articulation_points),
      bridges: parseInt(metrics.bridges),
      average_degree: parseFloat(metrics.average_degree),
      network_density: parseFloat(metrics.network_density),
      largest_component_size: parseInt(metrics.largest_component_size),
      component_count: parseInt(metrics.component_count),
      average_path_length: parseFloat(metrics.average_path_length),
      network_diameter: parseFloat(metrics.network_diameter)
    };

    console.log(`✅ Network metrics calculated`);
    return networkMetrics;
  }

  /**
   * Calculate overall network connectivity score
   */
  private async calculateConnectivityScore(): Promise<number> {
    const result = await this.pgClient.query(`
      WITH trail_connections AS (
        -- Get all trail connections through routing edges
        SELECT DISTINCT
          em1.app_uuid as trail1_id,
          em2.app_uuid as trail2_id
        FROM ${this.config.stagingSchema}.routing_edges re1
        JOIN ${this.config.stagingSchema}.edge_mapping em1 ON re1.id = em1.pg_id
        JOIN ${this.config.stagingSchema}.routing_edges re2 ON re1.source = re2.source OR re1.target = re2.target
        JOIN ${this.config.stagingSchema}.edge_mapping em2 ON re2.id = em2.pg_id
        WHERE em1.app_uuid != em2.app_uuid
      ),
      connected_trails AS (
        -- Get all trails that have connections
        SELECT DISTINCT trail1_id as trail_id FROM trail_connections
        UNION
        SELECT DISTINCT trail2_id as trail_id FROM trail_connections
      ),
      trail_stats AS (
        SELECT 
          COUNT(DISTINCT app_uuid) as total_trails,
          COUNT(DISTINCT CASE WHEN app_uuid IN (SELECT trail_id FROM connected_trails) THEN app_uuid END) as connected_trails
        FROM ${this.config.stagingSchema}.edge_mapping
      )
      SELECT 
        CASE 
          WHEN total_trails = 0 THEN 0
          ELSE (connected_trails::float / total_trails::float) * 100
        END as connectivity_score
      FROM trail_stats
    `);

    return parseFloat(result.rows[0]?.connectivity_score || '0');
  }

  /**
   * Analyze missing trail segments that exist in production but not in routing network
   */
  async analyzeMissingTrailSegments(): Promise<TrailSegmentAnalysis> {
    console.log('🔍 Analyzing missing trail segments...');
    
    const productionSchema = this.config.productionSchema || 'public';
    
    // Get original trails from production
    const originalTrailsResult = await this.pgClient.query(`
      SELECT 
        app_uuid,
        name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_AsText(geometry) as geometry_wkt,
        region,
        trail_type,
        surface,
        difficulty,
        id as original_trail_id
      FROM ${productionSchema}.trails
      WHERE region = $1
        AND geometry IS NOT NULL
        AND ST_IsValid(geometry)
        AND ST_Length(geometry) >= $2
    `, [this.config.stagingSchema.split('_')[1], this.config.minTrailLength]);
    
    // Get processed trails in routing network
    const processedTrailsResult = await this.pgClient.query(`
      SELECT DISTINCT
        em.app_uuid,
        em.trail_name as name,
        em.length_km,
        em.elevation_gain,
        em.elevation_loss
      FROM ${this.config.stagingSchema}.edge_mapping em
      JOIN ${this.config.stagingSchema}.routing_edges re ON em.pg_id = re.id
    `);
    
    const originalTrails = new Set(originalTrailsResult.rows.map(row => row.app_uuid));
    const processedTrails = new Set(processedTrailsResult.rows.map(row => row.app_uuid));
    
    // Find missing trails
    const missingTrailUuids = new Set([...originalTrails].filter(uuid => !processedTrails.has(uuid)));
    
    const missingSegments: MissingTrailSegment[] = [];
    
    for (const row of originalTrailsResult.rows) {
      if (missingTrailUuids.has(row.app_uuid)) {
        // Determine why the trail was lost
        let reason: MissingTrailSegment['reason_lost'] = 'unknown';
        
        // Check if it's in ways_noded but not in routing_edges
        const inWaysNoded = await this.pgClient.query(`
          SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded 
          WHERE old_id = $1
        `, [row.original_trail_id]);
        
        if (parseInt(inWaysNoded.rows[0].count) === 0) {
          reason = 'invalid_geometry';
        } else {
          // Check if it's in ways_noded but not in routing_edges
          const inRoutingEdges = await this.pgClient.query(`
            SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.routing_edges re
            JOIN ${this.config.stagingSchema}.ways_noded wn ON re.id = wn.id
            WHERE wn.old_id = $1
          `, [row.original_trail_id]);
          
          if (parseInt(inRoutingEdges.rows[0].count) === 0) {
            reason = 'topology_error';
          } else {
            reason = 'node_network_error';
          }
        }
        
        missingSegments.push({
          app_uuid: row.app_uuid,
          name: row.name,
          length_km: row.length_km,
          elevation_gain: row.elevation_gain,
          elevation_loss: row.elevation_loss,
          geometry: row.geometry_wkt,
          reason_lost: reason,
          original_trail_id: row.original_trail_id,
          region: row.region,
          trail_type: row.trail_type,
          surface: row.surface,
          difficulty: row.difficulty
        });
      }
    }
    
    const analysis: TrailSegmentAnalysis = {
      original_trails_count: originalTrails.size,
      processed_trails_count: processedTrails.size,
      lost_trails_count: missingSegments.length,
      missing_segments: missingSegments,
      restoration_recommendations: this.generateTrailRestorationRecommendations(missingSegments)
    };
    
    console.log(`✅ Missing trail analysis complete:`);
    console.log(`   📊 Original trails: ${analysis.original_trails_count}`);
    console.log(`   ✅ Processed trails: ${analysis.processed_trails_count}`);
    console.log(`   ❌ Lost trails: ${analysis.lost_trails_count}`);
    
    return analysis;
  }

  /**
   * Generate recommendations for restoring missing trail segments
   */
  private generateTrailRestorationRecommendations(missingSegments: MissingTrailSegment[]): string[] {
    const recommendations: string[] = [];
    
    if (missingSegments.length === 0) {
      recommendations.push('All original trails were successfully processed into the routing network');
      return recommendations;
    }
    
    // Group by reason lost
    const byReason = missingSegments.reduce((acc, segment) => {
      if (!acc[segment.reason_lost]) {
        acc[segment.reason_lost] = [];
      }
      acc[segment.reason_lost].push(segment);
      return acc;
    }, {} as Record<string, MissingTrailSegment[]>);
    
    if (byReason.invalid_geometry) {
      recommendations.push(`Fix ${byReason.invalid_geometry.length} trails with invalid geometries`);
    }
    
    if (byReason.too_short) {
      recommendations.push(`Restore ${byReason.too_short.length} trails that were too short (increase minTrailLength)`);
    }
    
    if (byReason.topology_error) {
      recommendations.push(`Fix ${byReason.topology_error.length} trails with topology errors (check for self-intersections)`);
    }
    
    if (byReason.node_network_error) {
      recommendations.push(`Restore ${byReason.node_network_error.length} trails lost during node network processing`);
    }
    
    if (byReason.unknown) {
      recommendations.push(`Investigate ${byReason.unknown.length} trails lost for unknown reasons`);
    }
    
    // Add specific recommendations based on trail characteristics
    const longTrails = missingSegments.filter(s => s.length_km > 5);
    if (longTrails.length > 0) {
      recommendations.push(`Priority: Restore ${longTrails.length} long trails (>5km) for better route diversity`);
    }
    
    const highElevationTrails = missingSegments.filter(s => s.elevation_gain > 500);
    if (highElevationTrails.length > 0) {
      recommendations.push(`Priority: Restore ${highElevationTrails.length} high-elevation trails (>500m gain) for challenging routes`);
    }
    
    return recommendations;
  }

  /**
   * Generate SQL to restore missing trail segments to the routing network
   */
  async generateTrailRestorationSQL(missingSegments: MissingTrailSegment[]): Promise<string> {
    console.log('🔧 Generating SQL to restore missing trail segments...');
    
    let sql = `-- Restore missing trail segments to improve network connectivity\n`;
    sql += `-- Generated by NetworkConnectivityAnalyzer\n\n`;
    
    // Group by reason for different restoration strategies
    const byReason = missingSegments.reduce((acc, segment) => {
      if (!acc[segment.reason_lost]) {
        acc[segment.reason_lost] = [];
      }
      acc[segment.reason_lost].push(segment);
      return acc;
    }, {} as Record<string, MissingTrailSegment[]>);
    
    // Strategy 1: Restore trails with invalid geometries by fixing them
    if (byReason.invalid_geometry) {
      sql += `-- Fix and restore trails with invalid geometries\n`;
      for (const segment of byReason.invalid_geometry.slice(0, 20)) { // Limit to prevent huge SQL
        sql += `-- Restore: ${segment.name} (${segment.length_km.toFixed(2)}km)\n`;
        sql += `INSERT INTO ${this.config.stagingSchema}.ways_noded (old_id, app_uuid, name, the_geom, length_km, elevation_gain, elevation_loss)\n`;
        sql += `SELECT \n`;
        sql += `  ${segment.original_trail_id} as old_id,\n`;
        sql += `  '${segment.app_uuid}' as app_uuid,\n`;
        sql += `  '${segment.name.replace(/'/g, "''")}' as name,\n`;
        sql += `  ST_GeomFromText('${segment.geometry}', 4326) as the_geom,\n`;
        sql += `  ${segment.length_km} as length_km,\n`;
        sql += `  ${segment.elevation_gain} as elevation_gain,\n`;
        sql += `  ${segment.elevation_loss} as elevation_loss\n`;
        sql += `WHERE NOT EXISTS (\n`;
        sql += `  SELECT 1 FROM ${this.config.stagingSchema}.ways_noded WHERE old_id = ${segment.original_trail_id}\n`;
        sql += `);\n\n`;
      }
    }
    
    // Strategy 2: Restore trails lost during topology creation
    if (byReason.topology_error) {
      sql += `-- Restore trails lost during topology creation\n`;
      sql += `-- These trails exist in ways_noded but not in routing_edges\n`;
      for (const segment of byReason.topology_error.slice(0, 20)) {
        sql += `-- Restore routing edge for: ${segment.name}\n`;
        sql += `INSERT INTO ${this.config.stagingSchema}.routing_edges (id, source, target, trail_id, geometry, length_km, elevation_gain, elevation_loss)\n`;
        sql += `SELECT \n`;
        sql += `  wn.id,\n`;
        sql += `  wn.source,\n`;
        sql += `  wn.target,\n`;
        sql += `  '${segment.app_uuid}' as trail_id,\n`;
        sql += `  wn.the_geom as geometry,\n`;
        sql += `  wn.length_km,\n`;
        sql += `  wn.elevation_gain,\n`;
        sql += `  wn.elevation_loss\n`;
        sql += `FROM ${this.config.stagingSchema}.ways_noded wn\n`;
        sql += `WHERE wn.old_id = ${segment.original_trail_id}\n`;
        sql += `  AND NOT EXISTS (\n`;
        sql += `    SELECT 1 FROM ${this.config.stagingSchema}.routing_edges re WHERE re.id = wn.id\n`;
        sql += `  );\n\n`;
      }
    }
    
    // Strategy 3: Recreate edge mapping for restored trails
    sql += `-- Recreate edge mapping for restored trails\n`;
    sql += `INSERT INTO ${this.config.stagingSchema}.edge_mapping (pg_id, original_trail_id, app_uuid, trail_name, length_km, elevation_gain, elevation_loss, trail_type, surface, difficulty, max_elevation, min_elevation, avg_elevation)\n`;
    sql += `SELECT \n`;
    sql += `  wn.id as pg_id,\n`;
    sql += `  wn.old_id as original_trail_id,\n`;
    sql += `  wn.app_uuid,\n`;
    sql += `  COALESCE(wn.name, 'Restored Trail') as trail_name,\n`;
    sql += `  wn.length_km,\n`;
    sql += `  wn.elevation_gain,\n`;
    sql += `  wn.elevation_loss,\n`;
    sql += `  'hiking' as trail_type,\n`;
    sql += `  'dirt' as surface,\n`;
    sql += `  'moderate' as difficulty,\n`;
    sql += `  0 as max_elevation,\n`;
    sql += `  0 as min_elevation,\n`;
    sql += `  0 as avg_elevation\n`;
    sql += `FROM ${this.config.stagingSchema}.ways_noded wn\n`;
    sql += `WHERE wn.old_id IN (${missingSegments.map(s => s.original_trail_id).filter(id => id).join(',')})\n`;
    sql += `  AND NOT EXISTS (\n`;
    sql += `    SELECT 1 FROM ${this.config.stagingSchema}.edge_mapping em WHERE em.pg_id = wn.id\n`;
    sql += `  );\n\n`;
    
    return sql;
  }

  /**
   * Generate recommendations for improving connectivity
   */
  private generateRecommendations(
    missingConnections: MissingConnection[],
    disconnectedComponents: DisconnectedComponent[],
    networkMetrics: NetworkMetrics,
    missingTrailSegments: MissingTrailSegment[]
  ): string[] {
    const recommendations: string[] = [];
    
    if (missingConnections.length > 0) {
      recommendations.push(`Add ${missingConnections.length} missing trail connections within ${this.config.maxConnectionDistance}m tolerance`);
      
      const closeConnections = missingConnections.filter(c => c.distance_meters <= this.config.intersectionTolerance);
      if (closeConnections.length > 0) {
        recommendations.push(`${closeConnections.length} connections are within ${this.config.intersectionTolerance}m and should be high priority`);
      }
    }
    
    if (disconnectedComponents.length > 1) {
      recommendations.push(`Connect ${disconnectedComponents.length} disconnected trail components`);
      
      const largestComponent = disconnectedComponents[0];
      const otherComponents = disconnectedComponents.slice(1);
      recommendations.push(`Largest component has ${largestComponent.trail_count} trails, ${otherComponents.length} smaller components need connection`);
    }

    // Network metrics based recommendations
    if (networkMetrics.isolated_nodes > 0) {
      recommendations.push(`Remove ${networkMetrics.isolated_nodes} isolated nodes to improve connectivity`);
    }

    if (networkMetrics.articulation_points > 0) {
      recommendations.push(`Add connections around ${networkMetrics.articulation_points} articulation points to improve network resilience`);
    }

    if (networkMetrics.network_density < 10) {
      recommendations.push(`Low network density (${networkMetrics.network_density.toFixed(1)}%) - add more connections for better route diversity`);
    }

    if (networkMetrics.average_path_length > 10) {
      recommendations.push(`High average path length (${networkMetrics.average_path_length.toFixed(1)}km) - add shortcuts for better connectivity`);
    }

    if (networkMetrics.component_count > 1) {
      recommendations.push(`Network has ${networkMetrics.component_count} disconnected components - connect them for better route options`);
    }
    
    if (missingConnections.length === 0 && disconnectedComponents.length <= 1 && networkMetrics.network_density > 20) {
      recommendations.push('Network connectivity is good - focus on route generation improvements');
    }
    
    if (missingTrailSegments.length > 0) {
      recommendations.push(`${missingTrailSegments.length} trail segments were lost during processing and need restoration.`);
      recommendations.push(...this.generateTrailRestorationRecommendations(missingTrailSegments));
    }
    
    return recommendations;
  }

  /**
   * Generate SQL to add missing connections to the routing network
   */
  async generateConnectionSQL(missingConnections: MissingConnection[]): Promise<string> {
    console.log('🔧 Generating SQL to add missing connections...');
    
    let sql = `-- Add missing trail connections to improve route diversity\n`;
    sql += `-- Generated by NetworkConnectivityAnalyzer using PostGIS and pgRouting\n\n`;
    
    for (const connection of missingConnections.slice(0, 50)) { // Limit to top 50
      sql += `-- Connect ${connection.trail1_name} to ${connection.trail2_name} (${connection.distance_meters.toFixed(1)}m)\n`;
      sql += `INSERT INTO ${this.config.stagingSchema}.routing_edges (source, target, trail_id, geometry, length_km, elevation_gain, elevation_loss)\n`;
      sql += `SELECT \n`;
      sql += `  (SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE ST_DWithin(the_geom, ST_SetSRID(ST_MakePoint(${connection.trail1_endpoint[0]}, ${connection.trail1_endpoint[1]}), 4326), ${connection.recommended_tolerance})) as source,\n`;
      sql += `  (SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE ST_DWithin(the_geom, ST_SetSRID(ST_MakePoint(${connection.trail2_endpoint[0]}, ${connection.trail2_endpoint[1]}), 4326), ${connection.recommended_tolerance})) as target,\n`;
      sql += `  'connection-${connection.trail1_id}-${connection.trail2_id}' as trail_id,\n`;
      sql += `  ST_SetSRID(ST_MakeLine(ST_MakePoint(${connection.trail1_endpoint[0]}, ${connection.trail1_endpoint[1]}), ST_MakePoint(${connection.trail2_endpoint[0]}, ${connection.trail2_endpoint[1]})), 4326) as geometry,\n`;
      sql += `  ${connection.distance_meters / 1000} as length_km,\n`;
      sql += `  0 as elevation_gain,\n`;
      sql += `  0 as elevation_loss\n`;
      sql += `WHERE source IS NOT NULL AND target IS NOT NULL;\n\n`;
    }
    
    return sql;
  }
} 