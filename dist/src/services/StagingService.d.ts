import { Client } from 'pg';
import { DatabaseService } from './DatabaseService';
export interface CopyResult {
    trailsCopied: number;
    nodesCopied: number;
    edgesCopied: number;
    bbox: {
        minLng: number;
        minLat: number;
        maxLng: number;
        maxLat: number;
    } | null;
}
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    stats: {
        totalTrails: number;
        nullGeometry: number;
        invalidGeometry: number;
        zeroOrNullLength: number;
        selfLoops: number;
        zeroLengthGeometry: number;
        singlePointGeometry: number;
    };
}
export interface StagingService {
    createStagingEnvironment(schemaName: string): Promise<void>;
    copyRegionData(region: string, bbox?: [number, number, number, number]): Promise<CopyResult>;
    validateStagingData(schemaName: string): Promise<ValidationResult>;
    cleanupStaging(schemaName: string): Promise<void>;
    cleanupAllStagingSchemas(): Promise<void>;
}
export declare class PostgresStagingService implements StagingService {
    private client;
    private databaseService;
    constructor(client: Client, databaseService: DatabaseService);
    createStagingEnvironment(schemaName: string, applySpatialOptimizations?: boolean): Promise<void>;
    copyRegionData(region: string, bbox?: [number, number, number, number]): Promise<CopyResult>;
    validateStagingData(schemaName: string): Promise<ValidationResult>;
    cleanupStaging(schemaName: string): Promise<void>;
    cleanupAllStagingSchemas(): Promise<void>;
}
//# sourceMappingURL=StagingService.d.ts.map