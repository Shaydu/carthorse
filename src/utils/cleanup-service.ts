import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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

export class CleanupService {
  private pgClient: Client;
  private config: CleanupConfig;

  constructor(pgClient: Client, config: CleanupConfig = {}) {
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
  async performComprehensiveCleanup(): Promise<CleanupResult> {
    console.log('🧹 Starting comprehensive cleanup for disk space management...');
    
    const result: CleanupResult = {
      cleanedStagingSchemas: 0,
      cleanedTempFiles: 0,
      cleanedDatabaseLogs: 0,
      freedSpaceMB: 0
    };

    // Clean up old staging schemas
    result.cleanedStagingSchemas = await this.cleanupOldStagingSchemas(this.config.maxStagingSchemasToKeep!);
    
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
  private async cleanupOldStagingSchemas(maxToKeep: number = 2): Promise<number> {
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
      } catch (error) {
        console.error(`❌ Failed to drop schema ${schema}:`, error);
      }
    }
    
    return schemasToDrop.length;
  }

  /**
   * Clean up temporary files
   */
  private async cleanupTempFiles(): Promise<number> {
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
        } catch (error) {
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
  private async cleanupDatabaseLogs(): Promise<number> {
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
        } catch (error) {
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
  private async performAggressiveCleanup(): Promise<void> {
    console.log('🧹 Performing aggressive cleanup...');
    
    // Clean up orphaned staging schemas
    await this.cleanupOrphanedStagingSchemas();
    
    // Clean up temporary tables
    await this.cleanupTemporaryTables();
    
    // Vacuum database
    try {
      await this.pgClient.query('VACUUM ANALYZE');
      console.log('✅ Database vacuum completed');
    } catch (error) {
      console.error('❌ Database vacuum failed:', error);
    }
  }

  /**
   * Clean up orphaned staging schemas
   */
  private async cleanupOrphanedStagingSchemas(): Promise<void> {
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
      } catch (error) {
        console.error(`❌ Failed to drop orphaned schema ${schema}:`, error);
      }
    }
  }

  /**
   * Clean up temporary tables
   */
  private async cleanupTemporaryTables(): Promise<void> {
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
      } catch (error) {
        console.error(`❌ Failed to drop temp table ${table.table_schema}.${table.table_name}:`, error);
      }
    }
  }

  /**
   * Clean all test staging schemas (for testing)
   */
  async cleanAllTestStagingSchemas(): Promise<void> {
    console.log('🧹 Cleaning all test staging schemas...');
    
    const result = await this.pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
    `);
    
    const stagingSchemas = result.rows.map(row => row.schema_name);
    
    if (stagingSchemas.length === 0) {
      console.log('✅ No staging schemas to clean');
      return;
    }
    
    console.log(`🗑️ Dropping ${stagingSchemas.length} staging schemas: ${stagingSchemas.join(', ')}`);
    
    for (const schema of stagingSchemas) {
      try {
        await this.pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        console.log(`✅ Dropped schema: ${schema}`);
      } catch (error) {
        console.error(`❌ Failed to drop schema ${schema}:`, error);
      }
    }
  }
}