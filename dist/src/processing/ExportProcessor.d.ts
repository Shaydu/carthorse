import { DatabaseService } from '../services/DatabaseService';
export interface ExportConfig {
    region: string;
    bbox?: [number, number, number, number];
    simplifyTolerance: number;
    targetSizeMB?: number;
    maxSqliteDbSizeMB: number;
    skipIncompleteTrails: boolean;
}
export interface ExportResult {
    success: boolean;
    trailCount: number;
    nodeCount: number;
    edgeCount: number;
    recommendationCount: number;
    fileSize: number;
    schemaVersion: number;
    errors: string[];
    warnings: string[];
}
export interface ExportStats {
    trailCount: number;
    nodeCount: number;
    edgeCount: number;
    recommendationCount: number;
    fileSize: number;
    schemaVersion: number;
}
export interface ExportProcessor {
    processSqliteExport(schemaName: string, config: ExportConfig): Promise<ExportResult>;
    processGeoJSONExport(schemaName: string, config: ExportConfig): Promise<ExportResult>;
    validateExport(outputPath: string): Promise<ExportResult>;
    getExportStats(schemaName: string): Promise<ExportStats>;
}
export declare class PostgresExportProcessor implements ExportProcessor {
    private databaseService;
    constructor(databaseService: DatabaseService);
    processSqliteExport(schemaName: string, config: ExportConfig): Promise<ExportResult>;
    processGeoJSONExport(schemaName: string, config: ExportConfig): Promise<ExportResult>;
    validateExport(outputPath: string): Promise<ExportResult>;
    getExportStats(schemaName: string): Promise<ExportStats>;
}
//# sourceMappingURL=ExportProcessor.d.ts.map