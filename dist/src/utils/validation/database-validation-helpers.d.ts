import { Pool } from 'pg';
export interface ValidationResult {
    success: boolean;
    message: string;
    details?: any;
}
export interface SchemaVersion {
    version: string;
    description: string;
    created_at: string;
}
/**
 * Check PostgreSQL master database schema version
 */
export declare function checkMasterSchemaVersion(pgClient: Pool): Promise<ValidationResult>;
/**
 * Check SQLite database schema version
 */
export declare function checkSqliteSchemaVersion(sqlitePath: string): Promise<ValidationResult>;
/**
 * Check required PostgreSQL functions exist
 */
export declare function checkRequiredSqlFunctions(pgClient: Pool): Promise<ValidationResult>;
/**
 * Validate pgRouting network topology
 */
export declare function validateRoutingNetwork(pgClient: Pool, stagingSchema: string): Promise<ValidationResult>;
/**
 * Comprehensive database validation
 */
export declare function validateDatabase(pgClient: Pool, stagingSchema: string, sqlitePath?: string): Promise<ValidationResult[]>;
//# sourceMappingURL=database-validation-helpers.d.ts.map