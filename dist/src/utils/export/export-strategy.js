"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportStrategyFactory = void 0;
class ExportStrategyFactory {
    static createStrategy(format, config) {
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
    static detectFormatFromFilename(filename) {
        if (filename.endsWith('.geojson') || filename.endsWith('.json')) {
            return 'geojson';
        }
        else if (filename.endsWith('.db')) {
            return 'sqlite';
        }
        else {
            // Default to SQLite for unknown extensions
            return 'sqlite';
        }
    }
}
exports.ExportStrategyFactory = ExportStrategyFactory;
//# sourceMappingURL=export-strategy.js.map