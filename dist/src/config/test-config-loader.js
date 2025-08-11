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
exports.testConfigLoader = exports.TestConfigLoader = void 0;
exports.getTestConfig = getTestConfig;
exports.isTestDatabaseConfigured = isTestDatabaseConfigured;
exports.shouldSkipTest = shouldSkipTest;
exports.logTestConfiguration = logTestConfiguration;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
const carthorse_global_config_1 = require("./carthorse.global.config");
class TestConfigLoader {
    constructor(configPath) {
        this.config = null;
        this.configPath = configPath || path.resolve(__dirname, '../../configs/test-config.yaml');
    }
    /**
     * Get singleton instance of TestConfigLoader
     */
    static getInstance(configPath) {
        if (!TestConfigLoader.instance) {
            TestConfigLoader.instance = new TestConfigLoader(configPath);
        }
        return TestConfigLoader.instance;
    }
    /**
     * Load test configuration from YAML file
     */
    loadConfig() {
        if (this.config) {
            return this.config;
        }
        try {
            if (!fs.existsSync(this.configPath)) {
                console.warn(`⚠️  Test config file not found at ${this.configPath}, using defaults`);
                this.config = this.getDefaultConfig();
                return this.config;
            }
            const configFile = fs.readFileSync(this.configPath, 'utf8');
            const yamlConfig = yaml.load(configFile);
            this.config = this.mergeWithDefaults(yamlConfig);
            console.log(`✅ Loaded test configuration from ${this.configPath}`);
            return this.config;
        }
        catch (error) {
            console.warn(`⚠️  Failed to load test config from ${this.configPath}: ${error instanceof Error ? error.message : String(error)}`);
            console.warn('Using default test configuration');
            this.config = this.getDefaultConfig();
            return this.config;
        }
    }
    /**
     * Get the current test configuration
     */
    getConfig() {
        return this.loadConfig();
    }
    /**
     * Check if test database is configured
     */
    isTestDatabaseConfigured() {
        const config = this.getConfig();
        return !!(config.database.host && config.database.port);
    }
    /**
     * Check if test should be skipped
     */
    shouldSkipTest(reason) {
        if (!this.isTestDatabaseConfigured()) {
            console.log(`⏭️  Skipping test - no test database configured${reason ? `: ${reason}` : ''}`);
            return true;
        }
        return false;
    }
    /**
     * Log current test configuration
     */
    logTestConfiguration() {
        const config = this.getConfig();
        if (this.isTestDatabaseConfigured()) {
            console.log(`🧪 Test configuration: ${config.database.database} on ${config.database.host}:${config.database.port}`);
            console.log(`📏 Elevation precision: ${config.export.elevationPrecision} decimal places`);
            console.log(`⏱️  Timeout: ${config.limits.timeout}ms`);
        }
        else {
            console.log('⚠️  No test database configuration found');
        }
    }
    /**
     * Get default test configuration
     */
    getDefaultConfig() {
        return {
            database: {
                host: process.env.TEST_PGHOST || process.env.PGHOST || 'localhost',
                port: parseInt(process.env.TEST_PGPORT || process.env.PGPORT || '5432'),
                database: process.env.TEST_PGDATABASE || process.env.PGDATABASE || 'trail_master_db_test',
                user: process.env.TEST_PGUSER || process.env.PGUSER || 'tester',
                password: process.env.TEST_PGPASSWORD || process.env.PGPASSWORD || '',
                ssl: false,
            },
            limits: {
                timeout: 120000, // 2 minutes
                shortTimeout: 5000, // 5 seconds for quick tests
                maxTrails: 3, // Only test with 3 trails for speed
                maxSqliteDbSizeMB: 10, // Small size for testing
            },
            export: {
                simplifyTolerance: carthorse_global_config_1.GLOBAL_CONFIG.export.defaultSimplifyTolerance,
                intersectionTolerance: carthorse_global_config_1.GLOBAL_CONFIG.export.defaultIntersectionTolerance,
                maxSqliteDbSizeMB: carthorse_global_config_1.GLOBAL_CONFIG.export.maxSqliteDbSizeMB,
                useSqlite: true,
                elevationPrecision: carthorse_global_config_1.configHelpers.getElevationPrecision(),
            },
            validation: {
                skipIncompleteTrails: carthorse_global_config_1.GLOBAL_CONFIG.validation.skipIncompleteTrails,
                skipValidation: false,
                skipBboxValidation: false,
                skipGeometryValidation: false,
                skipTrailValidation: false,
            },
            orchestrator: {
                region: 'boulder',
                simplifyTolerance: carthorse_global_config_1.GLOBAL_CONFIG.export.defaultSimplifyTolerance,
                intersectionTolerance: carthorse_global_config_1.GLOBAL_CONFIG.export.defaultIntersectionTolerance,
                replace: true,
                validate: false,
                verbose: true,
                skipBackup: true,
                buildMaster: false,
                targetSizeMB: null,
                maxSqliteDbSizeMB: carthorse_global_config_1.GLOBAL_CONFIG.export.maxSqliteDbSizeMB,
                skipIncompleteTrails: carthorse_global_config_1.GLOBAL_CONFIG.validation.skipIncompleteTrails,
                useSqlite: true,
                skipCleanup: true,
                targetSchemaVersion: 7,
                elevationPrecision: carthorse_global_config_1.configHelpers.getElevationPrecision(),
            },
        };
    }
    /**
     * Merge YAML config with defaults
     */
    mergeWithDefaults(yamlConfig) {
        const defaults = this.getDefaultConfig();
        return {
            database: { ...defaults.database, ...yamlConfig.database },
            limits: { ...defaults.limits, ...yamlConfig.limits },
            export: { ...defaults.export, ...yamlConfig.export },
            validation: { ...defaults.validation, ...yamlConfig.validation },
            orchestrator: { ...defaults.orchestrator, ...yamlConfig.orchestrator },
        };
    }
    /**
     * Reload configuration from file
     */
    reloadConfig() {
        this.config = null;
        return this.loadConfig();
    }
}
exports.TestConfigLoader = TestConfigLoader;
// Export singleton instance for backward compatibility
exports.testConfigLoader = TestConfigLoader.getInstance();
// Export convenience functions for backward compatibility
function getTestConfig() {
    return exports.testConfigLoader.getConfig();
}
function isTestDatabaseConfigured() {
    return exports.testConfigLoader.isTestDatabaseConfigured();
}
function shouldSkipTest(reason) {
    return exports.testConfigLoader.shouldSkipTest(reason);
}
function logTestConfiguration() {
    exports.testConfigLoader.logTestConfiguration();
}
//# sourceMappingURL=test-config-loader.js.map