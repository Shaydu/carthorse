import { Pool, PoolClient } from 'pg';

export interface TrailDeletionRecord {
  trailId: string;
  trailName: string;
  deletionReason: string;
  serviceName: string;
  timestamp: Date;
  originalLength?: number;
  replacementTrailIds?: string[];
  validated: boolean;
}

export interface TrailDeletionSummary {
  totalDeletions: number;
  validatedDeletions: number;
  unvalidatedDeletions: number;
  deletionsByService: Record<string, number>;
  deletionsByReason: Record<string, number>;
  problematicDeletions: TrailDeletionRecord[];
}

export class TrailDeletionTracker {
  private deletions: TrailDeletionRecord[] = [];
  private stagingSchema: string;

  constructor(private pgClient: Pool, stagingSchema: string) {
    this.stagingSchema = stagingSchema;
  }

  /**
   * Record a trail deletion with validation tracking
   */
  async recordTrailDeletion(
    trailId: string,
    trailName: string,
    deletionReason: string,
    serviceName: string,
    originalLength?: number,
    replacementTrailIds?: string[]
  ): Promise<void> {
    const record: TrailDeletionRecord = {
      trailId,
      trailName,
      deletionReason,
      serviceName,
      timestamp: new Date(),
      originalLength,
      replacementTrailIds,
      validated: false
    };

    this.deletions.push(record);

    // If we have replacement trails, validate the deletion
    if (replacementTrailIds && replacementTrailIds.length > 0 && originalLength) {
      await this.validateDeletion(record);
    }
  }

  /**
   * Validate that a deletion has proper replacement trails
   */
  private async validateDeletion(record: TrailDeletionRecord): Promise<void> {
    if (!record.replacementTrailIds || !record.originalLength) {
      return;
    }

    try {
      const client = await this.pgClient.connect();
      
      try {
        // Get the total length of replacement trails
        const replacementLengths = await Promise.all(
          record.replacementTrailIds.map(async (id) => {
            const result = await client.query(`
              SELECT ST_Length(geometry::geography) as length_m
              FROM ${this.stagingSchema}.trails
              WHERE app_uuid = $1
            `, [id]);
            return result.rows.length > 0 ? result.rows[0].length_m : 0;
          })
        );

        const totalReplacementLength = replacementLengths.reduce((sum, length) => sum + length, 0);
        const lengthDifference = Math.abs(totalReplacementLength - record.originalLength);
        const lengthDifferencePercentage = (lengthDifference / record.originalLength) * 100;

        // Validate within 1% tolerance
        if (lengthDifferencePercentage <= 1.0) {
          record.validated = true;
          console.log(`✅ Deletion validated: ${record.trailName} (${(record.originalLength/1000).toFixed(3)}km → ${(totalReplacementLength/1000).toFixed(3)}km, diff: ${lengthDifferencePercentage.toFixed(2)}%)`);
        } else {
          console.error(`❌ Deletion validation failed: ${record.trailName} (${(record.originalLength/1000).toFixed(3)}km → ${(totalReplacementLength/1000).toFixed(3)}km, diff: ${lengthDifferencePercentage.toFixed(2)}%)`);
        }
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`❌ Error validating deletion for ${record.trailName}:`, error);
    }
  }

  /**
   * Get summary of all trail deletions
   */
  getDeletionSummary(): TrailDeletionSummary {
    const totalDeletions = this.deletions.length;
    const validatedDeletions = this.deletions.filter(d => d.validated).length;
    const unvalidatedDeletions = totalDeletions - validatedDeletions;

    const deletionsByService: Record<string, number> = {};
    const deletionsByReason: Record<string, number> = {};

    for (const deletion of this.deletions) {
      deletionsByService[deletion.serviceName] = (deletionsByService[deletion.serviceName] || 0) + 1;
      deletionsByReason[deletion.deletionReason] = (deletionsByReason[deletion.deletionReason] || 0) + 1;
    }

    const problematicDeletions = this.deletions.filter(d => !d.validated && d.replacementTrailIds && d.replacementTrailIds.length > 0);

    return {
      totalDeletions,
      validatedDeletions,
      unvalidatedDeletions,
      deletionsByService,
      deletionsByReason,
      problematicDeletions
    };
  }

  /**
   * Print a comprehensive summary of trail deletions
   */
  printDeletionSummary(): void {
    const summary = this.getDeletionSummary();

    console.log('\n📊 TRAIL DELETION SUMMARY:');
    console.log(`   Total deletions: ${summary.totalDeletions}`);
    console.log(`   Validated deletions: ${summary.validatedDeletions}`);
    console.log(`   Unvalidated deletions: ${summary.unvalidatedDeletions}`);

    if (Object.keys(summary.deletionsByService).length > 0) {
      console.log('\n   Deletions by service:');
      for (const [service, count] of Object.entries(summary.deletionsByService)) {
        console.log(`      ${service}: ${count}`);
      }
    }

    if (Object.keys(summary.deletionsByReason).length > 0) {
      console.log('\n   Deletions by reason:');
      for (const [reason, count] of Object.entries(summary.deletionsByReason)) {
        console.log(`      ${reason}: ${count}`);
      }
    }

    if (summary.problematicDeletions.length > 0) {
      console.log('\n   ❌ Problematic deletions (unvalidated with replacements):');
      for (const deletion of summary.problematicDeletions) {
        console.log(`      ${deletion.trailName} (${deletion.serviceName}): ${deletion.deletionReason}`);
      }
    }

    if (summary.unvalidatedDeletions > 0) {
      console.log('\n   ⚠️ WARNING: Some trail deletions were not properly validated!');
      console.log('   This could indicate trails are being dropped without proper replacement.');
    }
  }

  /**
   * Check if any problematic deletions occurred
   */
  hasProblematicDeletions(): boolean {
    const summary = this.getDeletionSummary();
    return summary.problematicDeletions.length > 0;
  }

  /**
   * Get all unvalidated deletions
   */
  getUnvalidatedDeletions(): TrailDeletionRecord[] {
    return this.deletions.filter(d => !d.validated);
  }
}


