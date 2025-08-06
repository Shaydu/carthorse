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

export class ExportStrategyFactory {
  static createStrategy(format: 'geojson' | 'sqlite' | 'trails-only', config: ExportStrategyConfig): ExportStrategy {
    switch (format) {
      case 'geojson':
        return new GeoJSONExportStrategy(config);
      case 'sqlite':
        return new SQLiteExportStrategy(config);
      case 'trails-only':
        return new TrailsOnlyExportStrategy(config);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  static detectFormatFromFilename(filename: string): 'geojson' | 'sqlite' | 'trails-only' {
    if (filename.endsWith('.geojson') || filename.endsWith('.json')) {
      return 'geojson';
    } else if (filename.endsWith('.db')) {
      return 'sqlite';
    } else {
      // Default to SQLite for unknown extensions
      return 'sqlite';
    }
  }
} 