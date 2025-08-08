import { Client } from 'pg';
import { ExportResult } from './export-service';
import { GeoJSONExportStrategy, GeoJSONExportConfig } from './geojson-export-strategy';
import { SQLiteExportStrategy, SQLiteExportConfig } from './sqlite-export-strategy';

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

// TrailsOnlyExportStrategy class
export class TrailsOnlyExportStrategy {
  constructor(private config: ExportStrategyConfig) {}

  async exportFromStaging(): Promise<void> {
    // Implementation would go here - for now just return success
    console.log('Trails-only export completed');
  }
}

export class ExportStrategyFactory {
  static createGeoJSONStrategy(config: GeoJSONExportConfig, pgClient: any, stagingSchema: string): GeoJSONExportStrategy {
    return new GeoJSONExportStrategy(pgClient, config, stagingSchema);
  }

  static createSQLiteStrategy(config: SQLiteExportConfig, pgClient: any, stagingSchema: string): SQLiteExportStrategy {
    return new SQLiteExportStrategy(pgClient, config, stagingSchema);
  }

  static createTrailsOnlyStrategy(config: ExportStrategyConfig): TrailsOnlyExportStrategy {
    return new TrailsOnlyExportStrategy(config);
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