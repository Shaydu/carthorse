import { RoutingService } from '../services/RoutingService';
import { DatabaseService } from '../services/DatabaseService';
export interface RoutingConfig {
    nodeTolerance: number;
    edgeTolerance: number;
    minTrailLengthMeters: number;
    enableIntersectionDetection: boolean;
    enableNodeGeneration: boolean;
    enableEdgeGeneration: boolean;
    enableNetworkValidation: boolean;
}
export interface GraphResult {
    success: boolean;
    nodeCount: number;
    edgeCount: number;
    intersectionCount: number;
    orphanedNodesRemoved: number;
    orphanedEdgesRemoved: number;
    isConnected: boolean;
    isolatedNodes: number;
    orphanedEdges: number;
    connectivityStats: {
        totalNodes: number;
        connectedNodes: number;
        leafNodes: number;
        avgDegree: number;
    };
    errors: string[];
    warnings: string[];
}
export interface OptimizationConfig {
    removeIsolatedNodes: boolean;
    removeOrphanedEdges: boolean;
    mergeCloseNodes: boolean;
    nodeMergeTolerance: number;
}
export interface OptimizationResult {
    success: boolean;
    nodesRemoved: number;
    edgesRemoved: number;
    nodesMerged: number;
    errors: string[];
    warnings: string[];
}
export interface RoutingGraphProcessor {
    buildRoutingGraph(schemaName: string, config: RoutingConfig): Promise<GraphResult>;
    optimizeRoutingGraph(schemaName: string, config: OptimizationConfig): Promise<OptimizationResult>;
    validateRoutingGraph(schemaName: string): Promise<GraphResult>;
}
export declare class PostgresRoutingGraphProcessor implements RoutingGraphProcessor {
    private routingService;
    private databaseService;
    constructor(routingService: RoutingService, databaseService: DatabaseService);
    buildRoutingGraph(schemaName: string, config: RoutingConfig): Promise<GraphResult>;
    optimizeRoutingGraph(schemaName: string, config: OptimizationConfig): Promise<OptimizationResult>;
    validateRoutingGraph(schemaName: string): Promise<GraphResult>;
}
//# sourceMappingURL=RoutingGraphProcessor.d.ts.map