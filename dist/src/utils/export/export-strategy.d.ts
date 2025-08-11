import { Client } from 'pg';
import { ExportResult } from '../export-service';
export interface ExportStrategy {
    export(stagingSchema: string, outputPath: string, region: string, pgClient: Client): Promise<ExportResult>;
    getFormatName(): string;
}
export interface ExportStrategyConfig {
    region: string;
    outputPath: string;
    stagingSchema: string;
    includeTrails?: boolean;
    includeNodes?: boolean;
    includeEdges?: boolean;
    includeRoutes?: boolean;
    validate?: boolean;
}
export declare class ExportStrategyFactory {
    static createStrategy(format: 'geojson' | 'sqlite' | 'trails-only', config: ExportStrategyConfig): ExportStrategy;
    static detectFormatFromFilename(filename: string): 'geojson' | 'sqlite' | 'trails-only';
}
//# sourceMappingURL=export-strategy.d.ts.map