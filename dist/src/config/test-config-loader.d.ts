export interface TestDatabaseConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
}
export interface TestLimitsConfig {
    timeout: number;
    shortTimeout: number;
    maxTrails?: number;
    maxSqliteDbSizeMB?: number;
}
export interface TestExportConfig {
    simplifyTolerance: number;
    intersectionTolerance: number;
    maxSqliteDbSizeMB: number;
    useSqlite: boolean;
    elevationPrecision: number;
}
export interface TestValidationConfig {
    skipIncompleteTrails: boolean;
    skipValidation?: boolean;
    skipBboxValidation?: boolean;
    skipGeometryValidation?: boolean;
    skipTrailValidation?: boolean;
}
export interface TestOrchestratorConfig {
    region: string;
    simplifyTolerance: number;
    intersectionTolerance: number;
    replace: boolean;
    validate: boolean;
    verbose: boolean;
    skipBackup: boolean;
    buildMaster: boolean;
    targetSizeMB: number | null;
    maxSqliteDbSizeMB: number;
    skipIncompleteTrails: boolean;
    useSqlite: boolean;
    skipCleanup: boolean;
    targetSchemaVersion: number;
    elevationPrecision: number;
}
export interface TestConfig {
    database: TestDatabaseConfig;
    limits: TestLimitsConfig;
    export: TestExportConfig;
    validation: TestValidationConfig;
    orchestrator: TestOrchestratorConfig;
}
export declare class TestConfigLoader {
    private static instance;
    private config;
    private configPath;
    constructor(configPath?: string);
    /**
     * Get singleton instance of TestConfigLoader
     */
    static getInstance(configPath?: string): TestConfigLoader;
    /**
     * Load test configuration from YAML file
     */
    loadConfig(): TestConfig;
    /**
     * Get the current test configuration
     */
    getConfig(): TestConfig;
    /**
     * Check if test database is configured
     */
    isTestDatabaseConfigured(): boolean;
    /**
     * Check if test should be skipped
     */
    shouldSkipTest(reason?: string): boolean;
    /**
     * Log current test configuration
     */
    logTestConfiguration(): void;
    /**
     * Get default test configuration
     */
    private getDefaultConfig;
    /**
     * Merge YAML config with defaults
     */
    private mergeWithDefaults;
    /**
     * Reload configuration from file
     */
    reloadConfig(): TestConfig;
}
export declare const testConfigLoader: TestConfigLoader;
export declare function getTestConfig(): TestConfig;
export declare function isTestDatabaseConfigured(): boolean;
export declare function shouldSkipTest(reason?: string): boolean;
export declare function logTestConfiguration(): void;
//# sourceMappingURL=test-config-loader.d.ts.map