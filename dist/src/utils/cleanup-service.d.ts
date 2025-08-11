import { Client } from 'pg';
export interface CleanupConfig {
    maxStagingSchemasToKeep?: number;
    cleanupTempFiles?: boolean;
    cleanupDatabaseLogs?: boolean;
    aggressiveCleanup?: boolean;
}
export interface CleanupResult {
    cleanedStagingSchemas: number;
    cleanedTempFiles: number;
    cleanedDatabaseLogs: number;
    freedSpaceMB: number;
}
export declare class CleanupService {
    private pgClient;
    private config;
    constructor(pgClient: Client, config?: CleanupConfig);
    /**
     * Comprehensive cleanup for disk space management
     */
    performComprehensiveCleanup(): Promise<CleanupResult>;
    /**
     * Clean up old staging schemas, keeping only the most recent ones
     */
    private cleanupOldStagingSchemas;
    /**
     * Clean up temporary files
     */
    private cleanupTempFiles;
    /**
     * Clean up database logs
     */
    private cleanupDatabaseLogs;
    /**
     * Perform aggressive cleanup (use with caution)
     */
    private performAggressiveCleanup;
    /**
     * Clean up orphaned staging schemas
     */
    private cleanupOrphanedStagingSchemas;
    /**
     * Clean up temporary tables
     */
    private cleanupTemporaryTables;
    /**
     * Check for deadlocks and conflicting operations
     */
    private checkForDeadlocks;
    /**
     * Terminate conflicting processes with detailed reporting
     */
    private terminateConflictingProcesses;
    /**
     * Execute a query with timeout to prevent hanging
     */
    private executeWithTimeout;
    /**
     * Clean all test staging schemas with deadlock detection and conflict resolution
     */
    cleanAllTestStagingSchemas(): Promise<void>;
    /**
     * Clean a specific staging schema with deadlock detection and conflict resolution
     */
    cleanSpecificStagingSchema(schemaName: string): Promise<void>;
}
//# sourceMappingURL=cleanup-service.d.ts.map