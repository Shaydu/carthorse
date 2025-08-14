import { Client } from 'pg';
import { DatabaseService } from './DatabaseService';
export interface IntersectionResult {
    intersectionCount: number;
    intersections: any[];
}
export interface NodeGenerationResult {
    nodeCount: number;
    nodeTypes: {
        endpoint: number;
        intersection: number;
    };
}
export interface EdgeGenerationResult {
    edgeCount: number;
    orphanedNodesRemoved: number;
    orphanedEdgesRemoved: number;
    bridgeConnectorCleanupCount: number;
}
export interface NetworkValidationResult {
    isConnected: boolean;
    isolatedNodes: number;
    orphanedEdges: number;
    connectivityStats: {
        totalNodes: number;
        connectedNodes: number;
        leafNodes: number;
        avgDegree: number;
    };
}
export interface RoutingService {
    detectIntersections(schemaName: string, tolerance: number): Promise<IntersectionResult>;
    generateRoutingNodes(schemaName: string, tolerance: number): Promise<NodeGenerationResult>;
    generateRoutingEdges(schemaName: string, tolerance: number): Promise<EdgeGenerationResult>;
    validateRoutingNetwork(schemaName: string): Promise<NetworkValidationResult>;
    cleanupOrphanedNodes(schemaName: string): Promise<number>;
}
export declare class PostgresRoutingService implements RoutingService {
    private client;
    private databaseService;
    constructor(client: Client, databaseService: DatabaseService);
    detectIntersections(schemaName: string, tolerance: number): Promise<IntersectionResult>;
    generateRoutingNodes(schemaName: string, tolerance: number): Promise<NodeGenerationResult>;
    generateRoutingEdges(schemaName: string, tolerance: number): Promise<EdgeGenerationResult>;
    validateRoutingNetwork(schemaName: string): Promise<NetworkValidationResult>;
    cleanupOrphanedNodes(schemaName: string): Promise<number>;
}
//# sourceMappingURL=RoutingService.d.ts.map