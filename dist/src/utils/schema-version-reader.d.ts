/**
 * Extract schema version from SQL schema file
 * Reads the version from the header comment in the SQL file
 */
export declare function getSchemaVersionFromFile(schemaFilePath: string): number;
/**
 * Get the current SQLite schema version by reading from the schema file
 */
export declare function getCurrentSqliteSchemaVersion(): number;
/**
 * Get schema description from SQL file
 */
export declare function getSchemaDescriptionFromFile(schemaFilePath: string): string;
//# sourceMappingURL=schema-version-reader.d.ts.map