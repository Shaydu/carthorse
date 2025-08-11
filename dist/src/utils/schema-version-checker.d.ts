export interface SchemaVersion {
    version: number;
    description?: string;
    applied_at?: string;
    created_at?: string;
    updated_at?: string;
}
export declare class SchemaVersionChecker {
    /**
     * Check schema version for SpatiaLite database
     */
    checkSpatiaLiteVersion(filePath: string): SchemaVersion;
    /**
     * Get expected schema version for current application
     */
    getExpectedSchemaVersion(): SchemaVersion;
    /**
     * Validate that a SpatiaLite database has the expected schema version
     */
    validateSpatiaLiteSchema(filePath: string): {
        valid: boolean;
        message: string;
        actualVersion?: SchemaVersion;
    };
    /**
     * Print comprehensive schema version information for all databases
     */
    printSchemaInfo(): Promise<void>;
}
export declare function checkSchemaVersions(): Promise<void>;
export { SchemaVersionChecker as default };
//# sourceMappingURL=schema-version-checker.d.ts.map