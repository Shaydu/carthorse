import { Pool } from 'pg';
export interface ExportConfig {
    outputPath: string;
    stagingSchema: string;
    includeTrails?: boolean;
    includeNodes?: boolean;
    includeEdges?: boolean;
    includeRoutes?: boolean;
}
export interface ExportResult {
    success: boolean;
    message: string;
    data?: any;
}
/**
 * Base export strategy interface
 */
export interface ExportStrategy {
    export(pgClient: Pool, config: ExportConfig): Promise<ExportResult>;
}
/**
 * SQLite Export Strategy
 */
export declare class SQLiteExportStrategy implements ExportStrategy {
    export(pgClient: Pool, config: ExportConfig): Promise<ExportResult>;
}
/**
 * Trails-Only Export Strategy (subset of GeoJSON)
 */
export declare class TrailsOnlyExportStrategy implements ExportStrategy {
    export(pgClient: Pool, config: ExportConfig): Promise<ExportResult>;
}
/**
 * Main Export Service
 */
export declare class ExportService {
    private strategies;
    constructor();
    /**
     * Export data using the specified strategy
     */
    export(format: 'geojson' | 'sqlite' | 'trails-only', pgClient: Pool, config: ExportConfig): Promise<ExportResult>;
    /**
     * Register a new export strategy
     */
    registerStrategy(name: string, strategy: ExportStrategy): void;
    /**
     * Get available export formats
     */
    getAvailableFormats(): string[];
}
//# sourceMappingURL=export-service.d.ts.map