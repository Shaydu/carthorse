import { DatabaseService } from '../services/DatabaseService';
export interface ProcessingResult {
    success: boolean;
    trailsProcessed: number;
    validTrails: number;
    invalidTrails: number;
    errors: string[];
    warnings: string[];
}
export interface TrailStats {
    totalTrails: number;
    validTrails: number;
    invalidTrails: number;
    nullGeometry: number;
    invalidGeometry: number;
    zeroOrNullLength: number;
    selfLoops: number;
    zeroLengthGeometry: number;
    singlePointGeometry: number;
    avgLength: number;
    avgElevationGain: number;
    avgElevationLoss: number;
}
export interface TrailValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    stats: TrailStats;
}
export interface TrailProcessor {
    processTrails(schemaName: string, region: string, bbox?: [number, number, number, number]): Promise<ProcessingResult>;
    validateTrailsForRouting(schemaName: string): Promise<TrailValidationResult>;
    calculateTrailStats(schemaName: string): Promise<TrailStats>;
    getTrailDetails(schemaName: string, limit?: number): Promise<any[]>;
}
export declare class PostgresTrailProcessor implements TrailProcessor {
    private databaseService;
    constructor(databaseService: DatabaseService);
    processTrails(schemaName: string, region: string, bbox?: [number, number, number, number]): Promise<ProcessingResult>;
    validateTrailsForRouting(schemaName: string): Promise<TrailValidationResult>;
    calculateTrailStats(schemaName: string): Promise<TrailStats>;
    getTrailDetails(schemaName: string, limit?: number): Promise<any[]>;
}
//# sourceMappingURL=TrailProcessor.d.ts.map