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
exports.dbConnection = exports.DatabaseConnection = void 0;
exports.getTestDbConfig = getTestDbConfig;
exports.getProductionDbConfig = getProductionDbConfig;
exports.getBboxPhase2DbConfig = getBboxPhase2DbConfig;
exports.validateDbConfig = validateDbConfig;
exports.testConnection = testConnection;
exports.getProductionConnection = getProductionConnection;
const pg_1 = require("pg");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// Canonical DB config loader for Carthorse
// Always use this for all DB connections in tests and orchestrator
// Database configuration functions - no hardcoded fallbacks
function getTestDbConfig() {
    return {
        host: process.env.TEST_PGHOST || process.env.PGHOST,
        port: process.env.TEST_PGPORT || process.env.PGPORT ? parseInt(process.env.TEST_PGPORT || process.env.PGPORT) : undefined,
        database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
        user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
        password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
    };
}
function getProductionDbConfig() {
    return {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? parseInt(process.env.PGPORT) : undefined,
        database: process.env.PGDATABASE || 'trail_master_db',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
    };
}
function getBboxPhase2DbConfig() {
    return {
        host: process.env.BBOX_PHASE2_PGHOST || process.env.PGHOST,
        port: process.env.BBOX_PHASE2_PGPORT || process.env.PGPORT ? parseInt(process.env.BBOX_PHASE2_PGPORT || process.env.PGPORT) : undefined,
        database: process.env.BBOX_PHASE2_PGDATABASE || process.env.PGDATABASE || 'trail_master_db',
        user: process.env.BBOX_PHASE2_PGUSER || process.env.PGUSER || 'postgres',
        password: process.env.BBOX_PHASE2_PGPASSWORD || process.env.PGPASSWORD || '',
    };
}
// Connection validation
function validateDbConfig(config) {
    return !!(config.host && config.port && config.database && config.user);
}
// Test database connection
async function testConnection(config) {
    if (!validateDbConfig(config)) {
        console.log('❌ Invalid database configuration - missing required fields');
        return false;
    }
    const client = new pg_1.Client(config);
    try {
        await client.connect();
        console.log(`✅ Connected to database ${config.database} on ${config.host}:${config.port}`);
        return true;
    }
    catch (err) {
        console.log(`❌ Failed to connect to database: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
    finally {
        await client.end();
    }
}
// Production database connection (with safety checks)
async function getProductionConnection() {
    const config = getProductionDbConfig();
    if (!validateDbConfig(config)) {
        console.log('❌ Invalid production database configuration');
        return null;
    }
    // Safety check - prevent accidental production operations
    if (config.database === 'trail_master_db' && process.env.NODE_ENV !== 'production') {
        console.log('⚠️  WARNING: Attempting to connect to production database in non-production environment');
        console.log('   Set NODE_ENV=production to allow this operation');
        return null;
    }
    const client = new pg_1.Client(config);
    try {
        await client.connect();
        return client;
    }
    catch (err) {
        console.log(`❌ Failed to connect to production database: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
// Load environment variables from multiple possible locations
const envFiles = [
    '.env', // Standard .env file
    'env.local', // Local environment (common setup)
    'api-service/.env.api.local', // API-specific environment
    '.env.local', // Alternative local environment
];
// Try each file in order, later files override earlier ones
envFiles.forEach(envFile => {
    const envPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
        console.log(`📋 Loading environment from: ${envFile}`);
        dotenv.config({ path: envPath });
    }
});
// Log the database user being used for debugging
console.log(`🔗 Database user: ${process.env.PGUSER || 'not set'}`);
class DatabaseConnection {
    constructor() {
        this.client = null;
        this.currentEnvironment = 'default';
    }
    static getInstance() {
        if (!DatabaseConnection.instance) {
            DatabaseConnection.instance = new DatabaseConnection();
        }
        return DatabaseConnection.instance;
    }
    /**
     * Get configuration for a specific environment
     */
    getEnvironmentConfig(environment = 'default') {
        const env = environment.toLowerCase();
        switch (env) {
            case 'bbox-phase2':
                return {
                    name: 'bbox-phase2',
                    database: {
                        host: process.env.BBOX_PHASE2_PGHOST || process.env.PGHOST || 'localhost',
                        port: parseInt(process.env.BBOX_PHASE2_PGPORT || process.env.PGPORT || '5432'),
                        database: process.env.BBOX_PHASE2_PGDATABASE || process.env.PGDATABASE || 'trail_master_db',
                        user: process.env.BBOX_PHASE2_PGUSER || process.env.PGUSER || 'tester',
                        password: process.env.BBOX_PHASE2_PGPASSWORD || process.env.PGPASSWORD || '',
                        ssl: process.env.BBOX_PHASE2_PGSSL === 'true'
                    },
                    dataPaths: {
                        sourceDataDir: process.env.BBOX_PHASE2_SOURCE_DATA_DIR || process.env.SOURCE_DATA_DIR || '/path/to/source-data',
                        elevationTiffDir: process.env.BBOX_PHASE2_ELEVATION_TIFF_DIR || process.env.ELEVATION_TIFF_DIR || '/path/to/elevation-data',
                        osmDataPath: process.env.BBOX_PHASE2_OSM_DATA_PATH || process.env.OSM_DATA_PATH || '/path/to/osm/data'
                    },
                    processing: {
                        batchSize: parseInt(process.env.BBOX_PHASE2_BATCH_SIZE || process.env.CARTHORSE_BATCH_SIZE || '1000'),
                        timeoutMs: parseInt(process.env.BBOX_PHASE2_TIMEOUT_MS || process.env.CARTHORSE_TIMEOUT_MS || '30000'),
                        logLevel: process.env.BBOX_PHASE2_LOG_LEVEL || process.env.CARTHORSE_LOG_LEVEL || 'info',
                        verbose: process.env.BBOX_PHASE2_VERBOSE === 'true' || process.env.CARTHORSE_VERBOSE === 'true'
                    }
                };
            case 'test':
                return {
                    name: 'test',
                    database: {
                        host: process.env.TEST_PGHOST || 'localhost',
                        port: parseInt(process.env.TEST_PGPORT || '5432'),
                        database: process.env.TEST_PGDATABASE || 'trail_master_db_test',
                        user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
                        password: process.env.TEST_PGPASSWORD || '',
                        ssl: false
                    },
                    dataPaths: {
                        sourceDataDir: process.env.TEST_SOURCE_DATA_DIR || '/tmp/test-data',
                        elevationTiffDir: process.env.TEST_ELEVATION_TIFF_DIR || '/tmp/test-elevation',
                        osmDataPath: process.env.TEST_OSM_DATA_PATH || '/tmp/test-osm'
                    },
                    processing: {
                        batchSize: 100,
                        timeoutMs: 10000,
                        logLevel: 'debug',
                        verbose: true
                    }
                };
            case 'default':
            default:
                return {
                    name: 'default',
                    database: {
                        host: process.env.PGHOST || 'localhost',
                        port: parseInt(process.env.PGPORT || '5432'),
                        database: process.env.PGDATABASE || 'trail_master_db_test',
                        user: process.env.PGUSER || 'tester',
                        password: process.env.PGPASSWORD || '',
                        ssl: process.env.PGSSL === 'true'
                    },
                    dataPaths: {
                        sourceDataDir: process.env.SOURCE_DATA_DIR || '/path/to/source-data',
                        elevationTiffDir: process.env.ELEVATION_TIFF_DIR || '/path/to/elevation-data',
                        osmDataPath: process.env.OSM_DATA_PATH || '/path/to/osm/data'
                    },
                    processing: {
                        batchSize: parseInt(process.env.CARTHORSE_BATCH_SIZE || '1000'),
                        timeoutMs: parseInt(process.env.CARTHORSE_TIMEOUT_MS || '30000'),
                        logLevel: process.env.CARTHORSE_LOG_LEVEL || 'info',
                        verbose: process.env.CARTHORSE_VERBOSE === 'true'
                    }
                };
        }
    }
    /**
   * Create a new database client for the specified environment
   */
    async createClient(environment = 'default') {
        const config = this.getEnvironmentConfig(environment);
        this.currentEnvironment = environment;
        // Validate required environment variables
        const requiredEnvVars = ['PGUSER', 'PGHOST', 'PGDATABASE'];
        const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
        if (missingVars.length > 0) {
            console.error('❌ Missing required environment variables:');
            missingVars.forEach(varName => console.error(`   - ${varName}`));
            console.error('');
            console.error('💡 Make sure your environment variables are loaded correctly.');
            console.error('   Try creating a .env file in the project root with:');
            console.error('   PGUSER=your_username');
            console.error('   PGHOST=localhost');
            console.error('   PGDATABASE=your_database');
            console.error('   PGPASSWORD=your_password');
            process.exit(1);
        }
        const clientConfig = {
            host: config.database.host,
            port: config.database.port,
            database: config.database.database,
            user: config.database.user,
            password: config.database.password,
            ssl: config.database.ssl ? { rejectUnauthorized: false } : false
        };
        const client = new pg_1.Client(clientConfig);
        try {
            await client.connect();
            console.log(`✅ Connected to PostgreSQL (${environment} environment)`);
            console.log(`   Host: ${config.database.host}:${config.database.port}`);
            console.log(`   Database: ${config.database.database}`);
            console.log(`   User: ${config.database.user}`);
            // Test PostGIS
            const result = await client.query('SELECT PostGIS_Version()');
            console.log(`🌍 PostGIS version: ${result.rows[0].postgis_version}`);
            this.client = client;
            return client;
        }
        catch (error) {
            if (error.message && error.message.includes('role "postgres" does not exist')) {
                console.error('❌ Database connection failed:');
                console.error('   - PGUSER is set to:', process.env.PGUSER || 'undefined');
                console.error('   - PGHOST is set to:', process.env.PGHOST || 'undefined');
                console.error('   - PGDATABASE is set to:', process.env.PGDATABASE || 'undefined');
                console.error('');
                console.error('💡 The database user does not exist in your database.');
                console.error('   Make sure PGUSER is set to an existing database user.');
                console.error('   Common values: "postgres", your system username, or create a new user');
                process.exit(1);
            }
            console.error(`❌ Failed to connect to PostgreSQL (${environment} environment):`, error);
            throw error;
        }
    }
    /**
     * Get the current database client
     */
    getClient() {
        return this.client;
    }
    /**
     * Get the current environment name
     */
    getCurrentEnvironment() {
        return this.currentEnvironment;
    }
    /**
     * Get the current environment configuration
     */
    getCurrentConfig() {
        return this.getEnvironmentConfig(this.currentEnvironment);
    }
    /**
     * Disconnect the current client
     */
    async disconnect() {
        if (this.client) {
            await this.client.end();
            this.client = null;
            console.log('🔌 Disconnected from PostgreSQL');
        }
    }
    /**
     * Test the connection to a specific environment
     */
    async testConnection(environment = 'default') {
        try {
            const client = await this.createClient(environment);
            await client.end();
            return true;
        }
        catch (error) {
            console.error(`❌ Connection test failed for ${environment}:`, error);
            return false;
        }
    }
}
exports.DatabaseConnection = DatabaseConnection;
// Export singleton instance
exports.dbConnection = DatabaseConnection.getInstance();
//# sourceMappingURL=connection.js.map