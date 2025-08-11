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
exports.CleanupService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class CleanupService {
    constructor(pgClient, config = {}) {
        this.pgClient = pgClient;
        this.config = {
            maxStagingSchemasToKeep: 2,
            cleanupTempFiles: true,
            cleanupDatabaseLogs: true,
            aggressiveCleanup: false,
            ...config
        };
    }
    /**
     * Comprehensive cleanup for disk space management
     */
    async performComprehensiveCleanup() {
        console.log('🧹 Starting comprehensive cleanup for disk space management...');
        const result = {
            cleanedStagingSchemas: 0,
            cleanedTempFiles: 0,
            cleanedDatabaseLogs: 0,
            freedSpaceMB: 0
        };
        // Clean up old staging schemas
        result.cleanedStagingSchemas = await this.cleanupOldStagingSchemas(this.config.maxStagingSchemasToKeep);
        // Clean up temp files
        if (this.config.cleanupTempFiles) {
            result.cleanedTempFiles = await this.cleanupTempFiles();
        }
        // Clean up database logs
        if (this.config.cleanupDatabaseLogs) {
            result.cleanedDatabaseLogs = await this.cleanupDatabaseLogs();
        }
        // Aggressive cleanup if requested
        if (this.config.aggressiveCleanup) {
            await this.performAggressiveCleanup();
        }
        console.log('✅ Comprehensive cleanup completed');
        return result;
    }
    /**
     * Clean up old staging schemas, keeping only the most recent ones
     */
    async cleanupOldStagingSchemas(maxToKeep = 2) {
        console.log(`🗂️ Cleaning up old staging schemas (keeping ${maxToKeep} most recent)...`);
        const result = await this.pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      ORDER BY schema_name DESC
    `);
        const stagingSchemas = result.rows.map(row => row.schema_name);
        const schemasToDrop = stagingSchemas.slice(maxToKeep);
        if (schemasToDrop.length === 0) {
            console.log('✅ No old staging schemas to clean up');
            return 0;
        }
        console.log(`🗑️ Dropping ${schemasToDrop.length} old staging schemas: ${schemasToDrop.join(', ')}`);
        for (const schema of schemasToDrop) {
            try {
                await this.pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
                console.log(`✅ Dropped schema: ${schema}`);
            }
            catch (error) {
                console.error(`❌ Failed to drop schema ${schema}:`, error);
            }
        }
        return schemasToDrop.length;
    }
    /**
     * Clean up temporary files
     */
    async cleanupTempFiles() {
        console.log('🗂️ Cleaning up temporary files...');
        const tempDirs = [
            './tmp',
            './logs',
            './data/temp',
            './scripts/tmp'
        ];
        let cleanedFiles = 0;
        for (const dir of tempDirs) {
            if (fs.existsSync(dir)) {
                try {
                    const files = fs.readdirSync(dir);
                    for (const file of files) {
                        const filePath = path.join(dir, file);
                        const stats = fs.statSync(filePath);
                        // Remove files older than 24 hours
                        const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
                        if (ageHours > 24) {
                            fs.unlinkSync(filePath);
                            cleanedFiles++;
                        }
                    }
                }
                catch (error) {
                    console.error(`❌ Error cleaning temp dir ${dir}:`, error);
                }
            }
        }
        console.log(`✅ Cleaned up ${cleanedFiles} temporary files`);
        return cleanedFiles;
    }
    /**
     * Clean up database logs
     */
    async cleanupDatabaseLogs() {
        console.log('🗂️ Cleaning up database logs...');
        const logDirs = [
            './logs',
            './data/logs'
        ];
        let cleanedLogs = 0;
        for (const dir of logDirs) {
            if (fs.existsSync(dir)) {
                try {
                    const files = fs.readdirSync(dir);
                    for (const file of files) {
                        if (file.endsWith('.log') || file.endsWith('.sql')) {
                            const filePath = path.join(dir, file);
                            const stats = fs.statSync(filePath);
                            // Remove log files older than 7 days
                            const ageDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
                            if (ageDays > 7) {
                                fs.unlinkSync(filePath);
                                cleanedLogs++;
                            }
                        }
                    }
                }
                catch (error) {
                    console.error(`❌ Error cleaning log dir ${dir}:`, error);
                }
            }
        }
        console.log(`✅ Cleaned up ${cleanedLogs} log files`);
        return cleanedLogs;
    }
    /**
     * Perform aggressive cleanup (use with caution)
     */
    async performAggressiveCleanup() {
        console.log('🧹 Performing aggressive cleanup...');
        // Clean up orphaned staging schemas
        await this.cleanupOrphanedStagingSchemas();
        // Clean up temporary tables
        await this.cleanupTemporaryTables();
        // Vacuum database
        try {
            await this.pgClient.query('VACUUM ANALYZE');
            console.log('✅ Database vacuum completed');
        }
        catch (error) {
            console.error('❌ Database vacuum failed:', error);
        }
    }
    /**
     * Clean up orphaned staging schemas
     */
    async cleanupOrphanedStagingSchemas() {
        console.log('🗂️ Cleaning up orphaned staging schemas...');
        const result = await this.pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      AND schema_name NOT IN (
        SELECT DISTINCT table_schema 
        FROM information_schema.tables 
        WHERE table_schema LIKE 'staging_%'
      )
    `);
        const orphanedSchemas = result.rows.map(row => row.schema_name);
        if (orphanedSchemas.length === 0) {
            console.log('✅ No orphaned staging schemas found');
            return;
        }
        console.log(`🗑️ Dropping ${orphanedSchemas.length} orphaned schemas: ${orphanedSchemas.join(', ')}`);
        for (const schema of orphanedSchemas) {
            try {
                await this.pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
                console.log(`✅ Dropped orphaned schema: ${schema}`);
            }
            catch (error) {
                console.error(`❌ Failed to drop orphaned schema ${schema}:`, error);
            }
        }
    }
    /**
     * Clean up temporary tables
     */
    async cleanupTemporaryTables() {
        console.log('🗂️ Cleaning up temporary tables...');
        const result = await this.pgClient.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables 
      WHERE table_name LIKE 'temp_%' 
         OR table_name LIKE 'tmp_%'
         OR table_name LIKE '%_temp'
         OR table_name LIKE '%_tmp'
    `);
        const tempTables = result.rows;
        if (tempTables.length === 0) {
            console.log('✅ No temporary tables found');
            return;
        }
        console.log(`🗑️ Dropping ${tempTables.length} temporary tables`);
        for (const table of tempTables) {
            try {
                await this.pgClient.query(`DROP TABLE IF EXISTS "${table.table_schema}"."${table.table_name}" CASCADE`);
                console.log(`✅ Dropped temp table: ${table.table_schema}.${table.table_name}`);
            }
            catch (error) {
                console.error(`❌ Failed to drop temp table ${table.table_schema}.${table.table_name}:`, error);
            }
        }
    }
    /**
     * Check for deadlocks and conflicting operations
     */
    async checkForDeadlocks() {
        console.log('🔍 Checking for deadlocks and conflicts...');
        // Check for conflicting queries on staging schemas
        const conflictResult = await this.pgClient.query(`
      SELECT pid, usename, application_name, state, query
      FROM pg_stat_activity 
      WHERE (query LIKE '%staging_%' OR query LIKE '%DROP%')
        AND pid != pg_backend_pid()
        AND state = 'active'
    `);
        const conflictingQueries = conflictResult.rows.map(row => ({
            pid: row.pid,
            usename: row.usename,
            query: row.query?.substring(0, 100) + '...' || 'Unknown query'
        }));
        // Check for locks on staging schemas
        const lockResult = await this.pgClient.query(`
      SELECT l.pid, l.mode, l.granted, a.usename, a.query
      FROM pg_locks l
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE l.relation::regclass::text LIKE '%staging_%'
        AND l.pid != pg_backend_pid()
    `);
        const hasConflicts = conflictingQueries.length > 0 || lockResult.rows.length > 0;
        let deadlockInfo = '';
        if (hasConflicts) {
            deadlockInfo = `🚨 DEADLOCK DETECTED!\n`;
            deadlockInfo += `Found ${conflictingQueries.length} conflicting queries and ${lockResult.rows.length} locks\n`;
            if (conflictingQueries.length > 0) {
                deadlockInfo += `\nConflicting queries:\n`;
                conflictingQueries.forEach(q => {
                    deadlockInfo += `  PID ${q.pid} (${q.usename}): ${q.query}\n`;
                });
            }
            if (lockResult.rows.length > 0) {
                deadlockInfo += `\nActive locks:\n`;
                lockResult.rows.forEach(l => {
                    deadlockInfo += `  PID ${l.pid} (${l.usename}): ${l.mode} ${l.granted ? 'GRANTED' : 'WAITING'}\n`;
                });
            }
            deadlockInfo += `\n💡 RECOMMENDATION: Terminate conflicting processes before cleanup`;
        }
        else {
            deadlockInfo = '✅ No conflicts detected - safe to proceed with cleanup';
        }
        return {
            hasConflicts,
            conflictingQueries,
            deadlockInfo
        };
    }
    /**
     * Terminate conflicting processes with detailed reporting
     */
    async terminateConflictingProcesses() {
        console.log('🔌 Terminating conflicting processes...');
        const terminateResult = await this.pgClient.query(`
      SELECT pg_terminate_backend(pid) as terminated, pid, usename, query
      FROM pg_stat_activity 
      WHERE (query LIKE '%staging_%' OR query LIKE '%DROP%')
        AND pid != pg_backend_pid()
        AND state = 'active'
    `);
        const terminatedCount = terminateResult.rows.filter(r => r.terminated).length;
        if (terminatedCount > 0) {
            console.log(`✅ Terminated ${terminatedCount} conflicting processes:`);
            terminateResult.rows.forEach(row => {
                if (row.terminated) {
                    console.log(`  - PID ${row.pid} (${row.usename}): ${row.query?.substring(0, 80)}...`);
                }
            });
        }
        else {
            console.log('✅ No conflicting processes found to terminate');
        }
        return terminatedCount;
    }
    /**
     * Execute a query with timeout to prevent hanging
     */
    async executeWithTimeout(queryFn, timeoutMs = 30000, operationName = 'Database operation') {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            queryFn()
                .then(result => {
                clearTimeout(timeout);
                resolve(result);
            })
                .catch(error => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
    /**
     * Clean all test staging schemas with deadlock detection and conflict resolution
     */
    async cleanAllTestStagingSchemas() {
        console.log('🧹 Cleaning all test staging schemas...');
        try {
            // Check for deadlocks first
            const deadlockCheck = await this.executeWithTimeout(() => this.checkForDeadlocks(), 10000, 'Deadlock detection');
            console.log(deadlockCheck.deadlockInfo);
            if (deadlockCheck.hasConflicts) {
                console.log('⚠️  Conflicts detected! Attempting to resolve...');
                // Terminate conflicting processes
                const terminatedCount = await this.executeWithTimeout(() => this.terminateConflictingProcesses(), 15000, 'Process termination');
                if (terminatedCount > 0) {
                    console.log('⏳ Waiting for processes to fully terminate...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    // Re-check for deadlocks
                    const recheck = await this.executeWithTimeout(() => this.checkForDeadlocks(), 10000, 'Deadlock recheck');
                    if (recheck.hasConflicts) {
                        console.log('🚨 Still detecting conflicts after termination attempt!');
                        console.log(recheck.deadlockInfo);
                        throw new Error('Cleanup blocked by persistent conflicts. Manual intervention required.');
                    }
                }
            }
            // Get list of staging schemas
            const result = await this.executeWithTimeout(() => this.pgClient.query(`
          SELECT schema_name 
          FROM information_schema.schemata 
          WHERE schema_name LIKE 'staging_%'
        `), 10000, 'Schema enumeration');
            const stagingSchemas = result.rows.map(row => row.schema_name);
            if (stagingSchemas.length === 0) {
                console.log('✅ No staging schemas to clean');
                return;
            }
            console.log(`🗑️ Dropping ${stagingSchemas.length} staging schemas: ${stagingSchemas.join(', ')}`);
            let successCount = 0;
            let failureCount = 0;
            for (const schema of stagingSchemas) {
                try {
                    console.log(`\n📋 Processing schema: ${schema}`);
                    // Check if schema exists
                    const schemaCheck = await this.executeWithTimeout(() => this.pgClient.query(`
              SELECT schema_name 
              FROM information_schema.schemata 
              WHERE schema_name = $1
            `, [schema]), 5000, `Schema existence check for ${schema}`);
                    if (schemaCheck.rows.length === 0) {
                        console.log(`✅ Schema ${schema} does not exist`);
                        continue;
                    }
                    // Get table count for reporting
                    const tableCount = await this.executeWithTimeout(() => this.pgClient.query(`
              SELECT COUNT(*) as count 
              FROM information_schema.tables 
              WHERE table_schema = $1
            `, [schema]), 5000, `Table count for ${schema}`);
                    console.log(`📊 Schema contains ${tableCount.rows[0].count} tables`);
                    // Force drop with CASCADE
                    console.log(`🗑️ Force dropping schema ${schema} with CASCADE...`);
                    await this.executeWithTimeout(() => this.pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`), 30000, `Schema drop for ${schema}`);
                    // Verify the drop
                    const verifyResult = await this.executeWithTimeout(() => this.pgClient.query(`
              SELECT schema_name 
              FROM information_schema.schemata 
              WHERE schema_name = $1
            `, [schema]), 5000, `Drop verification for ${schema}`);
                    if (verifyResult.rows.length === 0) {
                        console.log(`✅ Successfully dropped schema: ${schema}`);
                        successCount++;
                    }
                    else {
                        throw new Error(`Failed to drop schema ${schema}`);
                    }
                }
                catch (error) {
                    console.error(`❌ Failed to drop schema ${schema}:`, error);
                    failureCount++;
                    // Check for deadlocks after each failure
                    try {
                        const deadlockCheck = await this.checkForDeadlocks();
                        if (deadlockCheck.hasConflicts) {
                            console.log('🚨 Deadlock detected during cleanup!');
                            console.log(deadlockCheck.deadlockInfo);
                            throw new Error(`Cleanup failed due to deadlock on schema ${schema}`);
                        }
                    }
                    catch (deadlockError) {
                        console.error('Failed to check for deadlocks:', deadlockError);
                    }
                }
            }
            console.log(`\n📊 Cleanup Summary:`);
            console.log(`  ✅ Successfully dropped: ${successCount} schemas`);
            console.log(`  ❌ Failed to drop: ${failureCount} schemas`);
            if (failureCount > 0) {
                throw new Error(`Cleanup completed with ${failureCount} failures. Manual intervention may be required.`);
            }
        }
        catch (error) {
            console.error('🚨 Cleanup failed:', error);
            throw error;
        }
    }
    /**
     * Clean a specific staging schema with deadlock detection and conflict resolution
     */
    async cleanSpecificStagingSchema(schemaName) {
        console.log(`🧹 Cleaning specific staging schema: ${schemaName}`);
        try {
            // Check for deadlocks first
            const deadlockCheck = await this.checkForDeadlocks();
            console.log(deadlockCheck.deadlockInfo);
            if (deadlockCheck.hasConflicts) {
                console.log('⚠️  Conflicts detected! Attempting to resolve...');
                // Terminate conflicting processes
                const terminatedCount = await this.terminateConflictingProcesses();
                if (terminatedCount > 0) {
                    console.log('⏳ Waiting for processes to fully terminate...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    // Re-check for deadlocks
                    const recheck = await this.checkForDeadlocks();
                    if (recheck.hasConflicts) {
                        console.log('🚨 Still detecting conflicts after termination attempt!');
                        console.log(recheck.deadlockInfo);
                        throw new Error('Cleanup blocked by persistent conflicts. Manual intervention required.');
                    }
                }
            }
            // Check if schema exists
            const schemaCheck = await this.pgClient.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = $1
      `, [schemaName]);
            if (schemaCheck.rows.length === 0) {
                console.log(`✅ Schema ${schemaName} does not exist`);
                return;
            }
            // Get table count for reporting
            const tableCount = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = $1
      `, [schemaName]);
            console.log(`📊 Schema contains ${tableCount.rows[0].count} tables`);
            // Force drop with CASCADE
            console.log(`🗑️ Force dropping schema ${schemaName} with CASCADE...`);
            await this.pgClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
            // Verify the drop
            const verifyResult = await this.pgClient.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = $1
      `, [schemaName]);
            if (verifyResult.rows.length === 0) {
                console.log(`✅ Successfully dropped schema: ${schemaName}`);
            }
            else {
                throw new Error(`Failed to drop schema ${schemaName}`);
            }
        }
        catch (error) {
            console.error(`❌ Failed to drop schema ${schemaName}:`, error);
            // Check for deadlocks after failure
            const deadlockCheck = await this.checkForDeadlocks();
            if (deadlockCheck.hasConflicts) {
                console.log('🚨 Deadlock detected during cleanup!');
                console.log(deadlockCheck.deadlockInfo);
            }
            throw error;
        }
    }
}
exports.CleanupService = CleanupService;
//# sourceMappingURL=cleanup-service.js.map