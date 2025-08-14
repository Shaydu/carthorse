import { Pool } from 'pg';
import { RoutePattern } from '../ksp-route-generator';
export declare class RoutePatternSqlHelpers {
    private pgClient;
    private configLoader;
    constructor(pgClient: Pool);
    /**
     * Load out-and-back route patterns
     */
    loadOutAndBackPatterns(): Promise<RoutePattern[]>;
    /**
     * Load loop route patterns
     */
    loadLoopPatterns(): Promise<RoutePattern[]>;
    /**
     * Load point-to-point route patterns
     */
    loadPointToPointPatterns(): Promise<RoutePattern[]>;
    /**
     * Generate loop routes using pgRouting's hawickcircuits with improved tolerance handling
     * This finds all cycles in the graph that meet distance/elevation criteria
     */
    generateLoopRoutes(stagingSchema: string, targetDistance: number, targetElevation: number, tolerancePercent?: number): Promise<any[]>;
    /**
     * Generate large out-and-back routes (10+km) by finding paths that can form long routes
     */
    private generateLargeLoops;
    /**
   * Find potential large out-and-back paths from an anchor node with 100m tolerance
   */
    private findLargeLoopPaths;
    /**
     * Group cycle edges into distinct cycles
     */
    private groupCycles;
    /**
     * Filter cycles by distance and elevation criteria
     */
    private filterCyclesByCriteria;
    /**
     * Calculate metrics for a cycle
     */
    private calculateCycleMetrics;
    /**
     * Validate that a route only uses actual trail edges
     * This prevents artificial connections between distant nodes
     */
    validateRouteEdges(stagingSchema: string, edgeIds: number[]): Promise<{
        isValid: boolean;
        reason?: string;
    }>;
    /**
     * Execute KSP routing between two nodes with enhanced diversity
     */
    executeKspRouting(stagingSchema: string, startNode: number, endNode: number, kValue?: number): Promise<any[]>;
    /**
     * Execute A* routing for more efficient pathfinding
     */
    executeAstarRouting(stagingSchema: string, startNode: number, endNode: number): Promise<any[]>;
    /**
     * Execute bidirectional Dijkstra for better performance on large networks
     */
    executeBidirectionalDijkstra(stagingSchema: string, startNode: number, endNode: number): Promise<any[]>;
    /**
     * Execute Chinese Postman for optimal trail coverage
     * This finds the shortest route that covers all edges at least once
     */
    executeChinesePostman(stagingSchema: string): Promise<any[]>;
    /**
     * Execute Hawick Circuits for finding all cycles in the network
     * This is excellent for loop route generation
     */
    executeHawickCircuits(stagingSchema: string): Promise<any[]>;
    /**
     * Execute withPointsKSP for routes that can start/end at any point along trails
     * This allows for more flexible route generation
     */
    executeWithPointsKsp(stagingSchema: string, startNode: number, endNode: number): Promise<any[]>;
    /**
     * Get route edges by IDs with split trail metadata
     */
    getRouteEdges(stagingSchema: string, edgeIds: number[]): Promise<any[]>;
    /**
     * Store a route recommendation in the staging schema
     */
    storeRouteRecommendation(stagingSchema: string, recommendation: any): Promise<void>;
    /**
     * Get network entry points for route generation
     * @param stagingSchema The staging schema name
     * @param useTrailheadsOnly If true, only return trailhead nodes. If false, use default logic.
     * @param maxEntryPoints Maximum number of entry points to return
     * @param trailheadLocations Optional array of trailhead coordinate locations
     */
    getNetworkEntryPoints(stagingSchema: string, useTrailheadsOnly?: boolean, maxEntryPoints?: number, trailheadLocations?: Array<{
        lat: number;
        lng: number;
        tolerance_meters?: number;
    }>): Promise<any[]>;
    /**
     * Get default network entry points (all available nodes)
     */
    private getDefaultNetworkEntryPoints;
    /**
     * Find nearest edge endpoints to trailhead coordinates
     */
    private findNearestEdgeEndpointsToTrailheads;
    /**
     * Find nodes reachable from a starting node within a maximum distance
     */
    findReachableNodes(stagingSchema: string, startNode: number, maxDistance: number): Promise<any[]>;
}
//# sourceMappingURL=route-pattern-sql-helpers.d.ts.map