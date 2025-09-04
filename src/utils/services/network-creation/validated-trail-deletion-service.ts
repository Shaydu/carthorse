import { Pool, PoolClient } from 'pg';
import { TrailDeletionTracker } from './trail-deletion-tracker';

export interface ValidatedDeletionConfig {
  stagingSchema: string;
  validationTolerancePercentage: number;
  requireValidation: boolean;
}

export class ValidatedTrailDeletionService {
  private deletionTracker: TrailDeletionTracker;

  constructor(
    private pgClient: Pool,
    private config: ValidatedDeletionConfig
  ) {
    this.deletionTracker = new TrailDeletionTracker(pgClient, config.stagingSchema);
  }

  /**
   * Delete a trail with proper validation tracking
   */
  async deleteTrail(
    trailId: string,
    trailName: string,
    deletionReason: string,
    serviceName: string,
    replacementTrailIds?: string[]
  ): Promise<void> {
    const client = await this.pgClient.connect();
    
    try {
      // Get original trail length before deletion
      const originalTrailResult = await client.query(`
        SELECT ST_Length(geometry::geography) as length_m
        FROM ${this.config.stagingSchema}.trails
        WHERE app_uuid = $1
      `, [trailId]);

      const originalLength = originalTrailResult.rows.length > 0 ? originalTrailResult.rows[0].length_m : undefined;

      // Record the deletion before actually deleting
      await this.deletionTracker.recordTrailDeletion(
        trailId,
        trailName,
        deletionReason,
        serviceName,
        originalLength,
        replacementTrailIds
      );

      // Perform the actual deletion
      await client.query(`
        DELETE FROM ${this.config.stagingSchema}.trails
        WHERE app_uuid = $1
      `, [trailId]);

      console.log(`🗑️ Deleted trail: ${trailName} (${deletionReason})`);

    } finally {
      client.release();
    }
  }

  /**
   * Delete multiple trails with validation tracking
   */
  async deleteTrails(
    trailIds: string[],
    deletionReason: string,
    serviceName: string,
    replacementTrailIds?: string[]
  ): Promise<void> {
    const client = await this.pgClient.connect();
    
    try {
      // Get original trail information before deletion
      const originalTrailsResult = await client.query(`
        SELECT app_uuid, name, ST_Length(geometry::geography) as length_m
        FROM ${this.config.stagingSchema}.trails
        WHERE app_uuid = ANY($1)
      `, [trailIds]);

      const originalLength = originalTrailsResult.rows.reduce((sum, row) => sum + row.length_m, 0);
      const trailNames = originalTrailsResult.rows.map(row => row.name).join(', ');

      // Record the deletion
      await this.deletionTracker.recordTrailDeletion(
        trailIds.join(','),
        trailNames,
        deletionReason,
        serviceName,
        originalLength,
        replacementTrailIds
      );

      // Perform the actual deletion
      await client.query(`
        DELETE FROM ${this.config.stagingSchema}.trails
        WHERE app_uuid = ANY($1)
      `, [trailIds]);

      console.log(`🗑️ Deleted ${trailIds.length} trails: ${trailNames} (${deletionReason})`);

    } finally {
      client.release();
    }
  }

  /**
   * Delete trails by condition with validation tracking
   */
  async deleteTrailsByCondition(
    condition: string,
    deletionReason: string,
    serviceName: string,
    replacementTrailIds?: string[]
  ): Promise<number> {
    const client = await this.pgClient.connect();
    
    try {
      // Get original trail information before deletion
      const originalTrailsResult = await client.query(`
        SELECT app_uuid, name, ST_Length(geometry::geography) as length_m
        FROM ${this.config.stagingSchema}.trails
        WHERE ${condition}
      `);

      if (originalTrailsResult.rows.length === 0) {
        return 0;
      }

      const originalLength = originalTrailsResult.rows.reduce((sum, row) => sum + row.length_m, 0);
      const trailIds = originalTrailsResult.rows.map(row => row.app_uuid);
      const trailNames = originalTrailsResult.rows.map(row => row.name).join(', ');

      // Record the deletion
      await this.deletionTracker.recordTrailDeletion(
        trailIds.join(','),
        trailNames,
        deletionReason,
        serviceName,
        originalLength,
        replacementTrailIds
      );

      // Perform the actual deletion
      const deleteResult = await client.query(`
        DELETE FROM ${this.config.stagingSchema}.trails
        WHERE ${condition}
      `);

      const deletedCount = deleteResult.rowCount || 0;
      console.log(`🗑️ Deleted ${deletedCount} trails: ${trailNames} (${deletionReason})`);

      return deletedCount;

    } finally {
      client.release();
    }
  }

  /**
   * Get the deletion tracker for summary reporting
   */
  getDeletionTracker(): TrailDeletionTracker {
    return this.deletionTracker;
  }

  /**
   * Print deletion summary
   */
  printDeletionSummary(): void {
    this.deletionTracker.printDeletionSummary();
  }

  /**
   * Check if there are any problematic deletions
   */
  hasProblematicDeletions(): boolean {
    return this.deletionTracker.hasProblematicDeletions();
  }
}




