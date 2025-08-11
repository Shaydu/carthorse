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
exports.env = void 0;
exports.getDbConfig = getDbConfig;
exports.validateTestEnvironment = validateTestEnvironment;
// Utility functions for environment and DB config/validation
const process = __importStar(require("process"));
const connection_1 = require("../database/connection");
exports.env = {
    // Database configuration - no hardcoded fallbacks
    host: process.env.PGHOST,
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : undefined,
    database: process.env.PGDATABASE || 'trail_master_db',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    // Test database configuration - no hardcoded fallbacks
    testHost: process.env.TEST_PGHOST || process.env.PGHOST,
    testPort: process.env.TEST_PGPORT || process.env.PGPORT ? parseInt(process.env.TEST_PGPORT || process.env.PGPORT) : undefined,
    testDatabase: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
    testUser: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
    testPassword: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
    // Environment
    nodeEnv: process.env.NODE_ENV || 'development',
    // Logging
    verbose: process.env.VERBOSE === 'true' || process.env.VERBOSE === '1',
    // Test configuration
    testLimit: process.env.CARTHORSE_TEST_LIMIT ? parseInt(process.env.CARTHORSE_TEST_LIMIT) : undefined,
};
// Backward compatibility function for orchestrator
function getDbConfig() {
    return (0, connection_1.getTestDbConfig)();
}
function validateTestEnvironment() {
    const testConfig = (0, connection_1.getTestDbConfig)();
    const requiredFields = ['host', 'port', 'database', 'user'];
    const missingFields = requiredFields.filter(field => !testConfig[field]);
    if (missingFields.length > 0) {
        console.log(`❌ Missing required test environment variables: ${missingFields.join(', ')}`);
        console.log('   Please set the following environment variables:');
        console.log('   - TEST_PGHOST or PGHOST');
        console.log('   - TEST_PGPORT or PGPORT');
        console.log('   - TEST_PGDATABASE or PGDATABASE');
        console.log('   - TEST_PGUSER or PGUSER');
        return false;
    }
    return true;
}
//# sourceMappingURL=env.js.map