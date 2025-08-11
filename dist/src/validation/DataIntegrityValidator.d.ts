import type { ValidationResult } from '../types';
export declare class DataIntegrityValidator {
    private client;
    constructor(databaseConfig: any);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    /**
     * Comprehensive validation for a specific region with enhanced spatial checks
     */
    validateRegion(region: string): Promise<ValidationResult>;
    /**
     * Enhanced spatial validation using PostGIS functions
     */
    validateSpatialIntegrity(region: string): Promise<ValidationResult>;
    /**
     * Print validation results in a formatted way
     */
    printResults(result: ValidationResult, region: string): void;
}
//# sourceMappingURL=DataIntegrityValidator.d.ts.map