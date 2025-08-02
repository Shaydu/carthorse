import { Client } from 'pg';
import { StagingQueries, CleanupQueries } from '../sql/queries';
import { DatabaseService } from './DatabaseService';

export interface CopyResult {
  trailsCopied: number;
  nodesCopied: number;
  edgesCopied: number;
  bbox: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  } | null;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalTrails: number;
    nullGeometry: number;
    invalidGeometry: number;
    zeroOrNullLength: number;
    selfLoops: number;
    zeroLengthGeometry: number;
    singlePointGeometry: number;
  };
}

export interface StagingService {
  createStagingEnvironment(schemaName: string): Promise<void>;
  copyRegionData(region: string, bbox?: [number, number, number, number]): Promise<CopyResult>;
  validateStagingData(schemaName: string): Promise<ValidationResult>;
  cleanupStaging(schemaName: string): Promise<void>;
  cleanupAllStagingSchemas(): Promise<void>;
}

export class PostgresStagingService implements StagingService {
  private client: Client;
  private databaseService: DatabaseService;

  constructor(client: Client, databaseService: DatabaseService) {
    this.client = client;
    this.databaseService = databaseService;
  }

  async createStagingEnvironment(schemaName: string): Promise<void> {
    console.log(`🏗️ Creating staging environment: ${schemaName}`);
    
    // Check if schema already exists
    const schemaExists = await this.databaseService.executeQuery(
      StagingQueries.checkSchemaExists(schemaName),
      [schemaName]
    );

    if (schemaExists.rows.length > 0) {
      console.log(`⚠️  Staging schema '${schemaName}' already exists, dropping and recreating...`);
      await this.databaseService.executeQuery(CleanupQueries.cleanupStagingSchema(schemaName));
    }

    // Create schema
    await this.databaseService.executeQuery(StagingQueries.createSchema(schemaName));
    console.log(`✅ Staging schema '${schemaName}' created successfully`);
  }

  async copyRegionData(region: string, bbox?: [number, number, number, number]): Promise<CopyResult> {
    console.log(`📋 Copying region data for '${region}'${bbox ? ' with bbox filter' : ''}`);
    
    // Convert bbox array to object if provided
    const bboxObj = bbox ? {
      minLng: bbox[0],
      minLat: bbox[1],
      maxLng: bbox[2],
      maxLat: bbox[3]
    } : null;

    // Copy trails
    const copyQuery = StagingQueries.copyTrails('public', 'staging', region, bboxObj);
    const copyParams = bbox ? [region, bbox[0], bbox[1], bbox[2], bbox[3]] : [region];
    
    const copyResult = await this.databaseService.executeQuery(copyQuery, copyParams);
    const trailsCopied = copyResult.rowCount;

    console.log(`✅ Copied ${trailsCopied} trails to staging`);

    // Try to copy related data (routing nodes, edges) if they exist
    let nodesCopied = 0;
    let edgesCopied = 0;

    try {
      // Copy routing nodes for the copied trails
      const nodesQuery = `
        INSERT INTO staging.routing_nodes 
        SELECT rn.* FROM routing_nodes rn
        INNER JOIN trails t ON ST_DWithin(rn.geometry, t.geometry, 100)
        WHERE t.region = $1
      `;
      const nodesResult = await this.databaseService.executeQuery(nodesQuery, [region]);
      nodesCopied = nodesResult.rowCount;
      console.log(`✅ Copied ${nodesCopied} routing nodes`);

      // Copy routing edges for the copied trails
      const edgesQuery = `
        INSERT INTO staging.routing_edges 
        SELECT re.* FROM routing_edges re
        INNER JOIN trails t ON ST_DWithin(re.geometry, t.geometry, 100)
        WHERE t.region = $1
      `;
      const edgesResult = await this.databaseService.executeQuery(edgesQuery, [region]);
      edgesCopied = edgesResult.rowCount;
      console.log(`✅ Copied ${edgesCopied} routing edges`);

    } catch (error) {
      console.warn('⚠️  Could not copy routing data (tables may not exist in production):', error instanceof Error ? error.message : String(error));
    }

    return {
      trailsCopied,
      nodesCopied,
      edgesCopied,
      bbox: bboxObj
    };
  }

  async validateStagingData(schemaName: string): Promise<ValidationResult> {
    console.log(`🔍 Validating staging data in schema '${schemaName}'`);
    
    const result = await this.databaseService.executeQuery(StagingQueries.validateStagingData(schemaName));
    const stats = result.rows[0];
    
    const validationStats = {
      totalTrails: parseInt(stats.total_trails),
      nullGeometry: parseInt(stats.null_geometry),
      invalidGeometry: parseInt(stats.invalid_geometry),
      zeroOrNullLength: parseInt(stats.zero_or_null_length),
      selfLoops: parseInt(stats.self_loops),
      zeroLengthGeometry: parseInt(stats.zero_length_geometry),
      singlePointGeometry: parseInt(stats.single_point_geometry)
    };

    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for critical issues
    if (validationStats.nullGeometry > 0) {
      errors.push(`${validationStats.nullGeometry} trails have null geometry`);
    }

    if (validationStats.invalidGeometry > 0) {
      errors.push(`${validationStats.invalidGeometry} trails have invalid geometry`);
    }

    if (validationStats.zeroLengthGeometry > 0) {
      errors.push(`${validationStats.zeroLengthGeometry} trails have zero length geometry`);
    }

    if (validationStats.singlePointGeometry > 0) {
      errors.push(`${validationStats.singlePointGeometry} trails are single points`);
    }

    // Check for warnings
    if (validationStats.zeroOrNullLength > 0) {
      warnings.push(`${validationStats.zeroOrNullLength} trails have zero or null length`);
    }

    if (validationStats.selfLoops > 0) {
      warnings.push(`${validationStats.selfLoops} trails are self-loops (start = end)`);
    }

    const isValid = errors.length === 0;

    console.log(`📊 Validation results:`);
    console.log(`   Total trails: ${validationStats.totalTrails}`);
    console.log(`   Null geometry: ${validationStats.nullGeometry}`);
    console.log(`   Invalid geometry: ${validationStats.invalidGeometry}`);
    console.log(`   Zero/null length: ${validationStats.zeroOrNullLength}`);
    console.log(`   Self-loops: ${validationStats.selfLoops}`);
    console.log(`   Zero length geometry: ${validationStats.zeroLengthGeometry}`);
    console.log(`   Single point geometry: ${validationStats.singlePointGeometry}`);

    if (errors.length > 0) {
      console.error(`❌ Validation errors: ${errors.join(', ')}`);
    }

    if (warnings.length > 0) {
      console.warn(`⚠️  Validation warnings: ${warnings.join(', ')}`);
    }

    return {
      isValid,
      errors,
      warnings,
      stats: validationStats
    };
  }

  async cleanupStaging(schemaName: string): Promise<void> {
    console.log(`🗑️ Cleaning up staging schema: ${schemaName}`);
    await this.databaseService.executeQuery(CleanupQueries.cleanupStagingSchema(schemaName));
    console.log(`✅ Staging schema '${schemaName}' cleaned up`);
  }

  async cleanupAllStagingSchemas(): Promise<void> {
    console.log('🗑️ Cleaning up all test staging schemas...');
    
    const result = await this.databaseService.executeQuery(CleanupQueries.findAllStagingSchemas());
    const stagingSchemas = result.rows.map((row: any) => row.nspname);
    
    if (stagingSchemas.length === 0) {
      console.log('📊 No staging schemas found to clean up');
      return;
    }

    console.log(`🗑️ Found ${stagingSchemas.length} staging schemas to clean up:`);
    
    for (const schema of stagingSchemas) {
      console.log(`   - Dropping staging schema: ${schema}`);
      await this.databaseService.executeQuery(CleanupQueries.cleanupStagingSchema(schema));
    }

    console.log('✅ All test staging schemas cleaned up successfully');
  }
} 