"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSchemaVersionFromFile = getSchemaVersionFromFile;
exports.getCurrentSqliteSchemaVersion = getCurrentSqliteSchemaVersion;
exports.getSchemaDescriptionFromFile = getSchemaDescriptionFromFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Extract schema version from SQL schema file
 * Reads the version from the header comment in the SQL file
 */
function getSchemaVersionFromFile(schemaFilePath) {
    try {
        const content = fs.readFileSync(schemaFilePath, 'utf8');
        // Look for version in header comment
        const versionMatch = content.match(/-- CARTHORSE SQLITE SCHEMA v(\d+)/);
        if (versionMatch) {
            return parseInt(versionMatch[1]);
        }
        // Fallback: look for any vXX pattern in the file
        const fallbackMatch = content.match(/v(\d+)/);
        if (fallbackMatch) {
            return parseInt(fallbackMatch[1]);
        }
        throw new Error(`Could not extract schema version from ${schemaFilePath}`);
    }
    catch (error) {
        console.error(`Error reading schema version from ${schemaFilePath}:`, error);
        throw error;
    }
}
/**
 * Get the current SQLite schema version by reading from the schema file
 */
function getCurrentSqliteSchemaVersion() {
    // Try multiple possible paths for the schema file
    const possiblePaths = [
        path.join(__dirname, '../../sql/schemas/carthorse-sqlite-schema-v14.sql'),
        path.join(__dirname, '../../../sql/schemas/carthorse-sqlite-schema-v14.sql'),
        path.join(process.cwd(), 'sql/schemas/carthorse-sqlite-schema-v14.sql'),
        path.join(process.cwd(), 'dist/sql/schemas/carthorse-sqlite-schema-v14.sql')
    ];
    for (const schemaFilePath of possiblePaths) {
        try {
            return getSchemaVersionFromFile(schemaFilePath);
        }
        catch (error) {
            // Continue to next path
            continue;
        }
    }
    // If all paths fail, return a default version
    console.warn('Could not find schema file, using default version 14');
    return 14;
}
/**
 * Get schema description from SQL file
 */
function getSchemaDescriptionFromFile(schemaFilePath) {
    try {
        const content = fs.readFileSync(schemaFilePath, 'utf8');
        // Look for description in header comment
        const descMatch = content.match(/--\s*(.+)/);
        if (descMatch) {
            return descMatch[1].trim();
        }
        return 'Carthorse SQLite Export';
    }
    catch (error) {
        console.error(`Error reading schema description from ${schemaFilePath}:`, error);
        return 'Carthorse SQLite Export';
    }
}
//# sourceMappingURL=schema-version-reader.js.map