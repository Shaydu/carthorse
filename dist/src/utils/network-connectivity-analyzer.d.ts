import { Pool } from 'pg';
export interface ConnectivityAnalysis {
    missingConnections: MissingConnection[];
    disconnectedComponents: DisconnectedComponent[];
    connectivityScore: number;
    networkMetrics: NetworkMetrics;
    recommendations: string[];
    missingTrailSegments?: MissingTrailSegment[];
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
export interface MissingTrailSegment {
    app_uuid: string;
    name: string;
    length_km: number;
    elevation_gain: number;
    elevation_loss: number;
    geometry: string;
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
export interface PotentialConnectorNode {
    id: string;
    position: [number, number];
    connection_type: 'endpoint-to-endpoint' | 'endpoint-to-trail' | 'trail-to-trail';
    connected_trails: string[];
    distance_meters: number;
    impact_score: number;
    benefits: string[];
    estimated_route_improvement: number;
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
        connector_nodes: any[];
        connection_lines: any[];
        impact_heatmap: any[];
    };
}
export interface NetworkConnectivityAnalyzerConfig {
    stagingSchema: string;
    intersectionTolerance: number;
    endpointTolerance: number;
    maxConnectionDistance: number;
    minTrailLength: number;
    analyzeMissingTrails?: boolean;
    productionSchema?: string;
    dryRunMode?: boolean;
    maxConnectorsToAnalyze?: number;
    minImpactScore?: number;
}
export declare class NetworkConnectivityAnalyzer {
    private pgClient;
    private config;
    constructor(pgClient: Pool, config: NetworkConnectivityAnalyzerConfig);
    /**
     * Analyze network connectivity and identify missing connections
     */
    analyzeConnectivity(): Promise<ConnectivityAnalysis>;
    /**
     * Perform dry-run analysis to visualize potential connector nodes
     */
    performDryRunAnalysis(): Promise<DryRunAnalysis>;
    /**
     * Analyze a single potential connector and calculate its impact
     */
    private analyzePotentialConnector;
    /**
     * Calculate network position score for a connection
     */
    private calculateNetworkPositionScore;
    /**
     * Get the component ID for a trail
     */
    private getTrailComponent;
    /**
     * Calculate isolation score for a trail (0-100, higher = more isolated)
     */
    private getTrailIsolationScore;
    /**
     * Get trail length
     */
    private getTrailLength;
    /**
     * Get trail elevation gain
     */
    private getTrailElevation;
    /**
     * Calculate estimated network improvements from adding connectors
     */
    private calculateEstimatedNetworkImprovements;
    /**
     * Generate visualization data for potential connectors
     */
    private generateVisualizationData;
    /**
     * Find missing connections between trails within tolerance using PostGIS spatial functions
     * Enhanced to verify against original trail_master_db.trails table
     */
    private findMissingConnections;
    /**
     * Find disconnected components using pgRouting's strongly connected components
     */
    private findDisconnectedComponents;
    /**
     * Calculate comprehensive network metrics using pgRouting and PostGIS
     */
    private calculateNetworkMetrics;
    /**
     * Calculate overall network connectivity score
     */
    private calculateConnectivityScore;
    /**
     * Analyze missing trail segments that exist in production but not in routing network
     */
    analyzeMissingTrailSegments(): Promise<TrailSegmentAnalysis>;
    /**
     * Generate recommendations for restoring missing trail segments
     */
    private generateTrailRestorationRecommendations;
    /**
     * Generate SQL to restore missing trail segments to the routing network
     */
    generateTrailRestorationSQL(missingSegments: MissingTrailSegment[]): Promise<string>;
    /**
     * Generate recommendations for improving connectivity
     */
    private generateRecommendations;
    /**
     * Generate SQL to add missing connections to the routing network
     */
    generateConnectionSQL(missingConnections: MissingConnection[]): Promise<string>;
}
//# sourceMappingURL=network-connectivity-analyzer.d.ts.map