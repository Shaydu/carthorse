import { Client } from 'pg';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    totalTrails: number;
    validTrails: number;
    invalidTrails: number;
  };
}

export interface BboxValidationResult {
  isValid: boolean;
  errors: string[];
  missingBboxCount: number;
  invalidBboxCount: number;
}

export interface GeometryValidationResult {
  isValid: boolean;
  errors: string[];
  invalidGeometryCount: number;
  emptyGeometryCount: number;
}

export class ValidationService {
  private pgClient: Client;

  constructor(pgClient: Client) {
    this.pgClient = pgClient;
  }

  /**
   * Validate bbox data for all trails
   */
  async validateBboxData(schemaName: string): Promise<BboxValidationResult> {
    console.log('🔍 Validating bbox data...');
    
    const result: BboxValidationResult = {
      isValid: true,
      errors: [],
      missingBboxCount: 0,
      invalidBboxCount: 0
    };

    // Check for trails with missing bbox data
    const missingBboxResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE bbox_min_lng IS NULL OR bbox_max_lng IS NULL 
         OR bbox_min_lat IS NULL OR bbox_max_lat IS NULL
    `);
    
    result.missingBboxCount = parseInt(missingBboxResult.rows[0].count);
    
    if (result.missingBboxCount > 0) {
      const error = `${result.missingBboxCount} trails have missing bbox data`;
      console.error(`❌ BBOX VALIDATION FAILED: ${error}`);
      result.errors.push(error);
      result.isValid = false;
    }

    // Check for trails with invalid bbox data (min > max)
    const invalidBboxResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE bbox_min_lng >= bbox_max_lng OR bbox_min_lat >= bbox_max_lat
    `);
    
    result.invalidBboxCount = parseInt(invalidBboxResult.rows[0].count);
    
    if (result.invalidBboxCount > 0) {
      const error = `${result.invalidBboxCount} trails have invalid bbox data (min >= max)`;
      console.error(`❌ BBOX VALIDATION FAILED: ${error}`);
      result.errors.push(error);
      result.isValid = false;
    }

    if (result.isValid) {
      console.log('✅ Bbox data validation passed');
    }
    
    return result;
  }

  /**
   * Validate geometry data for all trails
   */
  async validateGeometryData(schemaName: string): Promise<GeometryValidationResult> {
    console.log('🔍 Validating geometry data...');
    
    const result: GeometryValidationResult = {
      isValid: true,
      errors: [],
      invalidGeometryCount: 0,
      emptyGeometryCount: 0
    };

    // Check for trails with empty or invalid geometry
    const emptyGeometryResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE geometry IS NULL OR ST_IsEmpty(geometry) OR NOT ST_IsValid(geometry)
    `);
    
    result.emptyGeometryCount = parseInt(emptyGeometryResult.rows[0].count);
    
    if (result.emptyGeometryCount > 0) {
      const error = `${result.emptyGeometryCount} trails have empty or invalid geometry`;
      console.error(`❌ GEOMETRY VALIDATION FAILED: ${error}`);
      result.errors.push(error);
      result.isValid = false;
    }

    // Check for trails with wrong geometry type
    const invalidGeometryResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE NOT ST_GeometryType(geometry) = 'ST_LineString'
    `);
    
    result.invalidGeometryCount = parseInt(invalidGeometryResult.rows[0].count);
    
    if (result.invalidGeometryCount > 0) {
      const error = `${result.invalidGeometryCount} trails have wrong geometry type (not LineString)`;
      console.error(`❌ GEOMETRY VALIDATION FAILED: ${error}`);
      result.errors.push(error);
      result.isValid = false;
    }

    if (result.isValid) {
      console.log('✅ Geometry data validation passed');
    }
    
    return result;
  }

  /**
   * Comprehensive validation of all trail data
   */
  async validateAllTrailData(schemaName: string): Promise<ValidationResult> {
    console.log('🔍 Performing comprehensive trail data validation...');
    
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      summary: {
        totalTrails: 0,
        validTrails: 0,
        invalidTrails: 0
      }
    };

    // Get total trail count
    const totalResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
    `);
    result.summary.totalTrails = parseInt(totalResult.rows[0].count);

    // Validate bbox data
    const bboxValidation = await this.validateBboxData(schemaName);
    if (!bboxValidation.isValid) {
      result.errors.push(...bboxValidation.errors);
      result.isValid = false;
    }

    // Validate geometry data
    const geometryValidation = await this.validateGeometryData(schemaName);
    if (!geometryValidation.isValid) {
      result.errors.push(...geometryValidation.errors);
      result.isValid = false;
    }

    // Check for trails with missing required fields
    const missingFieldsResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.trails
      WHERE name IS NULL OR name = '' 
         OR app_uuid IS NULL OR app_uuid = ''
         OR region IS NULL OR region = ''
    `);
    
    const missingFieldsCount = parseInt(missingFieldsResult.rows[0].count);
    
    if (missingFieldsCount > 0) {
      const error = `${missingFieldsCount} trails have missing required fields (name, app_uuid, region)`;
      console.error(`❌ DATA VALIDATION FAILED: ${error}`);
      result.errors.push(error);
      result.isValid = false;
    }

    // Calculate valid trails
    result.summary.validTrails = result.isValid ? result.summary.totalTrails : 0;
    result.summary.invalidTrails = result.summary.totalTrails - result.summary.validTrails;

    if (result.isValid) {
      console.log('✅ Comprehensive trail data validation passed');
      console.log(`📊 Summary: ${result.summary.validTrails}/${result.summary.totalTrails} trails are valid`);
    } else {
      console.error('❌ Comprehensive trail data validation failed');
      console.error('Errors:', result.errors);
    }
    
    return result;
  }

  /**
   * Validate routing graph data
   */
  async validateRoutingGraph(schemaName: string): Promise<{
    isValid: boolean;
    errors: string[];
    nodeCount: number;
    edgeCount: number;
    orphanedNodes: number;
    selfLoops: number;
  }> {
    console.log('🔍 Validating routing graph data...');
    
    const result: {
      isValid: boolean;
      errors: string[];
      nodeCount: number;
      edgeCount: number;
      orphanedNodes: number;
      selfLoops: number;
    } = {
      isValid: true,
      errors: [],
      nodeCount: 0,
      edgeCount: 0,
      orphanedNodes: 0,
      selfLoops: 0
    };

    // Check if routing tables exist
    const tablesExist = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'routing_nodes') as nodes_exist,
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'routing_edges') as edges_exist
    `, [schemaName]);
    
    const nodesExist = parseInt(tablesExist.rows[0].nodes_exist) > 0;
    const edgesExist = parseInt(tablesExist.rows[0].edges_exist) > 0;
    
    if (!nodesExist || !edgesExist) {
      const error = 'Routing tables do not exist';
      console.error(`❌ ROUTING VALIDATION FAILED: ${error}`);
      result.errors.push(error);
      result.isValid = false;
      return result;
    }

    // Get node and edge counts
    const countsResult = await this.pgClient.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${schemaName}.routing_nodes) as node_count,
        (SELECT COUNT(*) FROM ${schemaName}.routing_edges) as edge_count
    `);
    
    result.nodeCount = parseInt(countsResult.rows[0].node_count);
    result.edgeCount = parseInt(countsResult.rows[0].edge_count);

    // Check for orphaned nodes (nodes not connected by any edges)
    const orphanedResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.routing_nodes n
      WHERE NOT EXISTS (
        SELECT 1 FROM ${schemaName}.routing_edges e 
        WHERE e.source = n.id OR e.target = n.id
      )
    `);
    
    result.orphanedNodes = parseInt(orphanedResult.rows[0].count);
    
    if (result.orphanedNodes > 0) {
      const warning = `${result.orphanedNodes} orphaned nodes found (not connected by any edges)`;
      console.warn(`⚠️ ROUTING WARNING: ${warning}`);
      result.errors.push(warning);
    }

    // Check for self-loops (edges where source = target)
    const selfLoopsResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.routing_edges
      WHERE source = target
    `);
    
    result.selfLoops = parseInt(selfLoopsResult.rows[0].count);
    
    if (result.selfLoops > 0) {
      const error = `${result.selfLoops} self-loops found in routing edges`;
      console.error(`❌ ROUTING VALIDATION FAILED: ${error}`);
      result.errors.push(error);
      result.isValid = false;
    }

    if (result.isValid) {
      console.log('✅ Routing graph validation passed');
      console.log(`📊 Routing summary: ${result.nodeCount} nodes, ${result.edgeCount} edges`);
    }
    
    return result;
  }
}