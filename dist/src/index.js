"use strict";
/**
 * CARTHORSE - Comprehensive Geospatial Trail Data Processing Pipeline
 *
 * A TypeScript library for building 3D trail databases with elevation data
 * from OpenStreetMap, GPX files, and elevation TIFFs.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runValidation = exports.runRegionReadiness = exports.runExport = exports.DatabaseConnection = exports.dbConnection = exports.DatabaseValidator = exports.DataIntegrityValidator = exports.OSMPostgresLoader = exports.AtomicTrailInserter = void 0;
// Core exports
var AtomicTrailInserter_1 = require("./inserters/AtomicTrailInserter");
Object.defineProperty(exports, "AtomicTrailInserter", { enumerable: true, get: function () { return AtomicTrailInserter_1.AtomicTrailInserter; } });
var OSMPostgresLoader_1 = require("./loaders/OSMPostgresLoader");
Object.defineProperty(exports, "OSMPostgresLoader", { enumerable: true, get: function () { return OSMPostgresLoader_1.OSMPostgresLoader; } });
var DataIntegrityValidator_1 = require("./validation/DataIntegrityValidator");
Object.defineProperty(exports, "DataIntegrityValidator", { enumerable: true, get: function () { return DataIntegrityValidator_1.DataIntegrityValidator; } });
var DatabaseValidator_1 = require("./validation/DatabaseValidator");
Object.defineProperty(exports, "DatabaseValidator", { enumerable: true, get: function () { return DatabaseValidator_1.DatabaseValidator; } });
// Types
__exportStar(require("./types"), exports);
// Database
var connection_1 = require("./database/connection");
Object.defineProperty(exports, "dbConnection", { enumerable: true, get: function () { return connection_1.dbConnection; } });
Object.defineProperty(exports, "DatabaseConnection", { enumerable: true, get: function () { return connection_1.DatabaseConnection; } });
// CLI
// Export CLI functions
var export_1 = require("./cli/export");
Object.defineProperty(exports, "runExport", { enumerable: true, get: function () { return export_1.runExport; } });
var region_readiness_1 = require("./cli/region-readiness");
Object.defineProperty(exports, "runRegionReadiness", { enumerable: true, get: function () { return region_readiness_1.runRegionReadiness; } });
var validate_1 = require("./cli/validate");
Object.defineProperty(exports, "runValidation", { enumerable: true, get: function () { return validate_1.runValidation; } });
// Configuration
__exportStar(require("./utils/config-loader"), exports);
//# sourceMappingURL=index.js.map