import { Client } from 'pg';
export interface ElevationData {
    elevation_gain: number;
    elevation_loss: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
    elevations: number[];
}
export interface ElevationValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    nullElevationCount: number;
    zeroElevationCount: number;
    invalidRangeCount: number;
    missing3DElevationCount: number;
}
export interface ElevationProcessingResult {
    processed: number;
    updated: number;
    failed: number;
    errors: string[];
}
export declare class ElevationService {
    private pgClient;
    private atomicInserter?;
    constructor(pgClient: Client, enableTiffProcessing?: boolean);
    /**
     * Initialize elevation data for all trails (set to null by default)
     */
    initializeElevationData(schemaName: string): Promise<void>;
    /**
     * Process elevation data for trails that need it
     * NO FALLBACKS - if elevation data cannot be calculated, the processing fails
     */
    processMissingElevationData(schemaName: string): Promise<ElevationProcessingResult>;
    /**
     * Validate elevation data integrity
     */
    validateElevationData(schemaName: string): Promise<ElevationValidationResult>;
    /**
     * Get elevation statistics
     */
    getElevationStats(schemaName: string): Promise<{
        total_trails: number;
        trails_with_elevation: number;
        trails_missing_elevation: number;
    }>;
}
//# sourceMappingURL=elevation-service.d.ts.map