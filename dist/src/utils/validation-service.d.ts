import { Client } from 'pg';
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    summary: {
        totalTrails: number;
        validTrails: number;
        invalidTrails: number;
    };
}
export interface BboxValidationResult {
    isValid: boolean;
    errors: string[];
    missingBboxCount: number;
    invalidBboxCount: number;
    shortTrailsWithInvalidBbox: Array<{
        name: string;
        app_uuid: string;
        length_meters: number;
        bbox_min_lng: number;
        bbox_max_lng: number;
        bbox_min_lat: number;
        bbox_max_lat: number;
    }>;
}
export interface GeometryValidationResult {
    isValid: boolean;
    errors: string[];
    invalidGeometryCount: number;
    emptyGeometryCount: number;
}
export interface TrailLengthValidationResult {
    isValid: boolean;
    errors: string[];
    shortTrailsCount: number;
    shortTrails: Array<{
        name: string;
        app_uuid: string;
        length_meters: number;
        region: string;
    }>;
}
export declare class ValidationService {
    private pgClient;
    constructor(pgClient: Client);
    /**
     * Validate bbox data for all trails
     */
    validateBboxData(schemaName: string): Promise<BboxValidationResult>;
    /**
     * Validate geometry data for all trails
     */
    validateGeometryData(schemaName: string): Promise<GeometryValidationResult>;
    /**
     * Validate trail lengths - fail export if any trails are under minimum length
     */
    validateTrailLengths(schemaName: string, minLengthMeters?: number): Promise<TrailLengthValidationResult>;
    /**
     * Comprehensive validation of all trail data
     */
    validateAllTrailData(schemaName: string): Promise<ValidationResult>;
    /**
     * Validate routing graph data
     */
    validateRoutingGraph(schemaName: string): Promise<{
        isValid: boolean;
        errors: string[];
        nodeCount: number;
        edgeCount: number;
        orphanedNodes: number;
        selfLoops: number;
    }>;
}
//# sourceMappingURL=validation-service.d.ts.map