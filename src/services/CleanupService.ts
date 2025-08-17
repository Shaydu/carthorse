import { Pool } from 'pg';
import { CleanupQueries } from '../sql/queries/cleanup-queries';
import { PgRoutingHelpers } from '../utils/pgrouting-helpers';

export interface CleanupConfig {
  noCleanup?: boolean;
  cleanupOldStagingSchemas?: boolean;
  cleanupTempFiles?: boolean;
  cleanupDatabaseLogs?: boolean;
  maxStagingSchemasToKeep?: number;
}

export class CleanupService {
  private pgClient: Pool;
  private config: CleanupConfig;
  private stagingSchema?: string;

  constructor(pgClient: Pool, config: CleanupConfig, stagingSchema?: string) {
    this.pgClient = pgClient;
    this.config = config;
    this.stagingSchema = stagingSchema;
  }

  /**
   * Main cleanup method that respects the noCleanup flag
   */
  async performCleanup(): Promise<void> {
    if (this.config.noCleanup) {
      console.log('🔒 Skipping cleanup (--no-cleanup flag set)');
      return;
    }

    console.log('🧹 Performing centralized cleanup...');

    try {
      // Cleanup pgRouting views if staging schema is provided
      if (this.stagingSchema) {
        await this.cleanupPgRoutingViews();
      }

      // Drop the staging schema if provided
      if (this.stagingSchema) {
        await this.dropStagingSchema();
      }

      // Cleanup old staging schemas if enabled
      if (this.config.cleanupOldStagingSchemas) {
        await this.cleanupOldStagingSchemas();
      }

      // Cleanup temp files if enabled
      if (this.config.cleanupTempFiles) {
        await this.cleanupTempFiles();
      }

      // Cleanup database logs if enabled
      if (this.config.cleanupDatabaseLogs) {
        await this.cleanupDatabaseLogs();
      }

      console.log('✅ Centralized cleanup completed');
    } catch (error) {
      console.warn('⚠️ Cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup pgRouting views
   */
  private async cleanupPgRoutingViews(): Promise<void> {
    if (!this.stagingSchema) return;

    try {
      const pgrouting = new PgRoutingHelpers({
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient
      });
      
      await pgrouting.cleanupViews();
      console.log('✅ pgRouting views cleaned up');
    } catch (error) {
      console.warn('⚠️ Failed to cleanup pgRouting views:', error);
    }
  }

  /**
   * Drop the current staging schema
   */
  private async dropStagingSchema(): Promise<void> {
    if (!this.stagingSchema) return;

    // Only drop the schema if noCleanup is not set
    if (this.config.noCleanup) {
      console.log(`🔒 Preserving staging schema ${this.stagingSchema} (--no-cleanup flag set)`);
      return;
    }

    try {
      await this.pgClient.query(`DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE`);
      console.log(`✅ Dropped staging schema: ${this.stagingSchema}`);
    } catch (error) {
      console.warn(`⚠️ Failed to drop staging schema ${this.stagingSchema}:`, error);
    }
  }

  /**
   * Cleanup old staging schemas, keeping only the most recent ones
   */
  private async cleanupOldStagingSchemas(): Promise<void> {
    const maxToKeep = this.config.maxStagingSchemasToKeep || 10;

    try {
      // Find all staging schemas
      const result = await this.pgClient.query(CleanupQueries.findAllStagingSchemas());
      const stagingSchemas = result.rows.map(row => row.nspname);

      if (stagingSchemas.length <= maxToKeep) {
        console.log(`📊 No old staging schemas to clean up (${stagingSchemas.length} schemas, keeping up to ${maxToKeep})`);
        return;
      }

      // Sort by creation time (assuming timestamp in schema name)
      const sortedSchemas = stagingSchemas.sort((a, b) => {
        const timestampA = parseInt(a.split('_')[1] || '0');
        const timestampB = parseInt(b.split('_')[1] || '0');
        return timestampB - timestampA; // Newest first
      });

      // Keep the most recent schemas, drop the rest
      const schemasToDrop = sortedSchemas.slice(maxToKeep);
      
      console.log(`🗑️ Dropping ${schemasToDrop.length} old staging schemas: ${schemasToDrop.join(', ')}`);

      for (const schema of schemasToDrop) {
        try {
          await this.pgClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          console.log(`✅ Dropped old schema: ${schema}`);
        } catch (error) {
          console.warn(`⚠️ Failed to drop old schema ${schema}:`, error);
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to cleanup old staging schemas:', error);
    }
  }

  /**
   * Cleanup temporary files
   */
  private async cleanupTempFiles(): Promise<void> {
    // This would implement temp file cleanup logic
    console.log('📁 Temp file cleanup not yet implemented');
  }

  /**
   * Cleanup database logs
   */
  private async cleanupDatabaseLogs(): Promise<void> {
    // This would implement database log cleanup logic
    console.log('📋 Database log cleanup not yet implemented');
  }

  /**
   * Get all staging schemas (for debugging)
   */
  async getAllStagingSchemas(): Promise<string[]> {
    try {
      const result = await this.pgClient.query(CleanupQueries.findAllStagingSchemas());
      return result.rows.map(row => row.nspname);
    } catch (error) {
      console.warn('⚠️ Failed to get staging schemas:', error);
      return [];
    }
  }
}
