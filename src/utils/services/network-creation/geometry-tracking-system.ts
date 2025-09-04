import { Pool } from 'pg';

export interface GeometryRecord {
  trailId: string;
  trailName: string;
  geometry: any; // PostGIS geometry
  lengthMeters: number;
  serviceName: string;
  operationType: 'original' | 'deleted' | 'inserted' | 'split';
  timestamp: Date;
  originalTrailId?: string;
  metadata?: any;
}

export interface GeometryValidationResult {
  isValid: boolean;
  missingGeometries: GeometryRecord[];
  orphanedGeometries: GeometryRecord[];
  lengthMismatches: {
    original: GeometryRecord;
    replacements: GeometryRecord[];
    expectedLength: number;
    actualLength: number;
    difference: number;
    differencePercentage: number;
  }[];
  errors: string[];
}

export class GeometryTrackingSystem {
  private static instance: GeometryTrackingSystem;
  private geometryRecords: Map<string, GeometryRecord[]> = new Map();
  private deletedGeometries: Map<string, GeometryRecord> = new Map();
  private insertedGeometries: Map<string, GeometryRecord[]> = new Map();
  private originalGeometries: Map<string, GeometryRecord> = new Map();
  private pgClient: Pool;
  private stagingSchema: string;

  private constructor(pgClient: Pool, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }

  public static getInstance(pgClient?: Pool, stagingSchema?: string): GeometryTrackingSystem {
    if (!GeometryTrackingSystem.instance) {
      if (!pgClient || !stagingSchema) {
        throw new Error('GeometryTrackingSystem requires pgClient and stagingSchema for initialization');
      }
      GeometryTrackingSystem.instance = new GeometryTrackingSystem(pgClient, stagingSchema);
    }
    return GeometryTrackingSystem.instance;
  }

  /**
   * Record an original geometry before any processing
   */
  async recordOriginalGeometry(
    trailId: string,
    trailName: string,
    geometry: any,
    serviceName: string = 'system'
  ): Promise<void> {
    const lengthMeters = await this.calculateGeometryLength(geometry);
    
    const record: GeometryRecord = {
      trailId,
      trailName,
      geometry,
      lengthMeters,
      serviceName,
      operationType: 'original',
      timestamp: new Date()
    };

    this.originalGeometries.set(trailId, record);
    this.addToRecords(trailId, record);
  }

  /**
   * Record a geometry deletion
   */
  async recordGeometryDeletion(
    trailId: string,
    trailName: string,
    geometry: any,
    serviceName: string,
    metadata?: any
  ): Promise<void> {
    const lengthMeters = await this.calculateGeometryLength(geometry);
    
    const record: GeometryRecord = {
      trailId,
      trailName,
      geometry,
      lengthMeters,
      serviceName,
      operationType: 'deleted',
      timestamp: new Date(),
      metadata
    };

    this.deletedGeometries.set(trailId, record);
    this.addToRecords(trailId, record);
  }

  /**
   * Record a geometry insertion
   */
  async recordGeometryInsertion(
    trailId: string,
    trailName: string,
    geometry: any,
    serviceName: string,
    originalTrailId?: string,
    metadata?: any
  ): Promise<void> {
    const lengthMeters = await this.calculateGeometryLength(geometry);
    
    const record: GeometryRecord = {
      trailId,
      trailName,
      geometry,
      lengthMeters,
      serviceName,
      operationType: 'inserted',
      timestamp: new Date(),
      originalTrailId,
      metadata
    };

    if (!this.insertedGeometries.has(originalTrailId || trailId)) {
      this.insertedGeometries.set(originalTrailId || trailId, []);
    }
    this.insertedGeometries.get(originalTrailId || trailId)!.push(record);
    this.addToRecords(trailId, record);
  }

  /**
   * Record a geometry split operation
   */
  async recordGeometrySplit(
    originalTrailId: string,
    originalTrailName: string,
    originalGeometry: any,
    splitGeometries: Array<{ trailId: string; trailName: string; geometry: any }>,
    serviceName: string,
    metadata?: any
  ): Promise<void> {
    // Record the original geometry
    await this.recordOriginalGeometry(originalTrailId, originalTrailName, originalGeometry, serviceName);
    
    // Record the deletion
    await this.recordGeometryDeletion(originalTrailId, originalTrailName, originalGeometry, serviceName, metadata);
    
    // Record all the split geometries
    for (const split of splitGeometries) {
      await this.recordGeometryInsertion(
        split.trailId,
        split.trailName,
        split.geometry,
        serviceName,
        originalTrailId,
        metadata
      );
    }
  }

  /**
   * Validate that all deleted geometries are properly represented by inserted geometries
   */
  async validateGeometryIntegrity(): Promise<GeometryValidationResult> {
    const result: GeometryValidationResult = {
      isValid: true,
      missingGeometries: [],
      orphanedGeometries: [],
      lengthMismatches: [],
      errors: []
    };

    // Check for missing geometries (deleted but not replaced)
    for (const [deletedId, deletedRecord] of this.deletedGeometries) {
      const replacements = this.insertedGeometries.get(deletedId) || [];
      
      if (replacements.length === 0) {
        result.missingGeometries.push(deletedRecord);
        result.isValid = false;
        result.errors.push(
          `Missing geometry: Trail "${deletedRecord.trailName}" (${deletedId}) was deleted but has no replacement geometries`
        );
      } else {
        // Validate length integrity
        const totalReplacementLength = replacements.reduce((sum, r) => sum + r.lengthMeters, 0);
        const lengthDifference = Math.abs(deletedRecord.lengthMeters - totalReplacementLength);
        const lengthDifferencePercentage = (lengthDifference / deletedRecord.lengthMeters) * 100;
        
        // Allow 1% tolerance for length differences
        if (lengthDifferencePercentage > 1.0) {
          result.lengthMismatches.push({
            original: deletedRecord,
            replacements,
            expectedLength: deletedRecord.lengthMeters,
            actualLength: totalReplacementLength,
            difference: lengthDifference,
            differencePercentage: lengthDifferencePercentage
          });
          result.isValid = false;
          result.errors.push(
            `Length mismatch: Trail "${deletedRecord.trailName}" (${deletedId}) - Expected: ${deletedRecord.lengthMeters.toFixed(2)}m, Actual: ${totalReplacementLength.toFixed(2)}m (${lengthDifferencePercentage.toFixed(2)}% difference)`
          );
        }
      }
    }

    // Check for orphaned geometries (inserted but no corresponding deletion)
    for (const [insertedId, insertedRecords] of this.insertedGeometries) {
      if (!this.deletedGeometries.has(insertedId)) {
        result.orphanedGeometries.push(...insertedRecords);
        result.errors.push(
          `Orphaned geometry: Trail "${insertedRecords[0].trailName}" (${insertedId}) was inserted but has no corresponding deletion record`
        );
      }
    }

    return result;
  }

  /**
   * Get a summary of all geometry operations
   */
  async getGeometrySummary(): Promise<{
    totalOriginal: number;
    totalDeleted: number;
    totalInserted: number;
    missingGeometries: number;
    orphanedGeometries: number;
    lengthMismatches: number;
  }> {
    const validation = await this.validateGeometryIntegrity();
    
    return {
      totalOriginal: this.originalGeometries.size,
      totalDeleted: this.deletedGeometries.size,
      totalInserted: Array.from(this.insertedGeometries.values()).reduce((sum, records) => sum + records.length, 0),
      missingGeometries: validation.missingGeometries.length,
      orphanedGeometries: validation.orphanedGeometries.length,
      lengthMismatches: validation.lengthMismatches.length
    };
  }

  /**
   * Print a detailed report of geometry operations
   */
  async printGeometryReport(): Promise<void> {
    const summary = await this.getGeometrySummary();
    const validation = await this.validateGeometryIntegrity();
    
    console.log('\n🔍 GEOMETRY TRACKING REPORT');
    console.log('============================');
    console.log(`📊 Summary:`);
    console.log(`   Original geometries: ${summary.totalOriginal}`);
    console.log(`   Deleted geometries:  ${summary.totalDeleted}`);
    console.log(`   Inserted geometries: ${summary.totalInserted}`);
    console.log(`   Missing geometries:  ${summary.missingGeometries}`);
    console.log(`   Orphaned geometries: ${summary.orphanedGeometries}`);
    console.log(`   Length mismatches:   ${summary.lengthMismatches}`);
    
    if (validation.errors.length > 0) {
      console.log(`\n❌ ERRORS FOUND:`);
      validation.errors.forEach((error: string, index: number) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }
    
    if (validation.missingGeometries.length > 0) {
      console.log(`\n🚨 MISSING GEOMETRIES:`);
      validation.missingGeometries.forEach((missing: GeometryRecord, index: number) => {
        console.log(`   ${index + 1}. "${missing.trailName}" (${missing.trailId}) - ${missing.lengthMeters.toFixed(2)}m`);
      });
    }
    
    if (validation.lengthMismatches.length > 0) {
      console.log(`\n⚠️  LENGTH MISMATCHES:`);
      validation.lengthMismatches.forEach((mismatch: any, index: number) => {
        console.log(`   ${index + 1}. "${mismatch.original.trailName}" (${mismatch.original.trailId})`);
        console.log(`      Expected: ${mismatch.expectedLength.toFixed(2)}m`);
        console.log(`      Actual:   ${mismatch.actualLength.toFixed(2)}m`);
        console.log(`      Difference: ${mismatch.differencePercentage.toFixed(2)}%`);
      });
    }
    
    if (validation.isValid) {
      console.log(`\n✅ All geometries are properly tracked and validated!`);
    } else {
      console.log(`\n❌ Geometry integrity validation failed!`);
    }
  }

  /**
   * Reset all tracking data
   */
  reset(): void {
    this.geometryRecords.clear();
    this.deletedGeometries.clear();
    this.insertedGeometries.clear();
    this.originalGeometries.clear();
  }

  private addToRecords(trailId: string, record: GeometryRecord): void {
    if (!this.geometryRecords.has(trailId)) {
      this.geometryRecords.set(trailId, []);
    }
    this.geometryRecords.get(trailId)!.push(record);
  }

  private async calculateGeometryLength(geometry: any): Promise<number> {
    try {
      const result = await this.pgClient.query(
        `SELECT ST_Length($1::geography) as length_meters`,
        [geometry]
      );
      return parseFloat(result.rows[0].length_meters) || 0;
    } catch (error) {
      console.warn(`Failed to calculate geometry length: ${error}`);
      return 0;
    }
  }
}
