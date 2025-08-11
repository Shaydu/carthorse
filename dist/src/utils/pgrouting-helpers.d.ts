import { Pool } from 'pg';
export interface PgRoutingConfig {
    stagingSchema: string;
    pgClient: Pool;
}
export interface PgRoutingResult {
    success: boolean;
    error?: string;
    analysis?: any;
    routes?: any[];
}
export declare class PgRoutingHelpers {
    private stagingSchema;
    private pgClient;
    constructor(config: PgRoutingConfig);
    createPgRoutingViews(): Promise<boolean>;
    analyzeGraph(): Promise<PgRoutingResult>;
    private _findKShortestPaths;
    findKShortestPaths(startNodeUuid: string, endNodeUuid: string, k?: number, directed?: boolean): Promise<PgRoutingResult>;
    findKShortestPathsById(startNodeId: number, endNodeId: number, k?: number, directed?: boolean): Promise<PgRoutingResult>;
    private _findShortestPath;
    findShortestPath(startNodeUuid: string, endNodeUuid: string, directed?: boolean): Promise<PgRoutingResult>;
    findRoutesWithinDistance(startNode: number, distance: number): Promise<PgRoutingResult>;
    generateRouteRecommendations(targetDistance: number, targetElevation: number, maxRoutes?: number): Promise<PgRoutingResult>;
    validateNetwork(): Promise<PgRoutingResult>;
    cleanupViews(): Promise<void>;
}
export declare function createPgRoutingHelpers(stagingSchema: string, pgClient: Pool): PgRoutingHelpers;
//# sourceMappingURL=pgrouting-helpers.d.ts.map