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
  shortTrailsWithInvalidBbox: Array<{
    name: string;
    app_uuid: string;
    length_meters: number;
    bbox_min_lng: number;
    bbox_max_lng: number;
    bbox_min_lat: number;
    bbox_max_lat: number;
  }>;
}

export interface GeometryValidationResult {
  isValid: boolean;
  errors: string[];
  invalidGeometryCount: number;
  emptyGeometryCount: number;
}

export interface TrailLengthValidationResult {
  isValid: boolean;
  errors: string[];
  shortTrailsCount: number;
  shortTrails: Array<{
    name: string;
    app_uuid: string;
    length_meters: number;
    region: string;
  }>;
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
      invalidBboxCount: 0,
      shortTrailsWithInvalidBbox: []
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
      WHERE bbox_min_lng > bbox_max_lng OR bbox_min_lat > bbox_max_lat
    `);
    
    result.invalidBboxCount = parseInt(invalidBboxResult.rows[0].count);
    
    if (result.invalidBboxCount > 0) {
      const error = `${result.invalidBboxCount} trails have invalid bbox data (min > max)`;
      console.error(`❌ BBOX VALIDATION FAILED: ${error}`);
      result.errors.push(error);
      result.isValid = false;
    }

    // Special validation for trails with identical coordinates (edge case)
    // These must be horizontal or vertical flat trails with minimum length
    const identicalCoordsResult = await this.pgClient.query(`
      SELECT name, app_uuid, ST_Length(geometry::geography) as length_meters,
             bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
             (bbox_max_lng - bbox_min_lng) as lng_range,
             (bbox_max_lat - bbox_min_lat) as lat_range
      FROM ${schemaName}.trails
      WHERE (bbox_min_lng = bbox_max_lng OR bbox_min_lat = bbox_max_lat)
         AND ST_Length(geometry::geography) < 0.5
      ORDER BY length_meters ASC
    `);
    
    const invalidFlatTrails = identicalCoordsResult.rows.map(row => ({
      name: row.name,
      app_uuid: row.app_uuid,
      length_meters: parseFloat(row.length_meters),
      bbox_min_lng: row.bbox_min_lng,
      bbox_max_lng: row.bbox_max_lng,
      bbox_min_lat: row.bbox_min_lat,
      bbox_max_lat: row.bbox_max_lat
    }));

    if (invalidFlatTrails.length > 0) {
      const error = `${invalidFlatTrails.length} trails have identical bbox coordinates but are too short (< 0.5m)`;
      console.error(`❌ BBOX VALIDATION FAILED: ${error}`);
      console.error('📋 Invalid flat trails details:');
      invalidFlatTrails.forEach(trail => {
        console.error(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_meters.toFixed(2)}m`);
      });
      result.errors.push(error);
      result.isValid = false;
      result.shortTrailsWithInvalidBbox = invalidFlatTrails;
    }

    // Check for trails with small bbox ranges that might be problematic
    // Get details of short trails with small bbox ranges for debugging
    const smallBboxTrailsResult = await this.pgClient.query(`
      SELECT name, app_uuid, ST_Length(geometry::geography) as length_meters,
             bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
             (bbox_max_lng - bbox_min_lng) as lng_range,
             (bbox_max_lat - bbox_min_lat) as lat_range
      FROM ${schemaName}.trails
      WHERE (bbox_max_lng - bbox_min_lng) < 0.001 OR (bbox_max_lat - bbox_min_lat) < 0.001
         AND ST_Length(geometry::geography) < 10
         AND NOT (bbox_min_lng = bbox_max_lng OR bbox_min_lat = bbox_max_lat)
      ORDER BY length_meters ASC
    `);
    
    // Combine and deduplicate based on app_uuid
    const allShortTrails = [
      ...result.shortTrailsWithInvalidBbox,
      ...smallBboxTrailsResult.rows.map(row => ({
        name: row.name,
        app_uuid: row.app_uuid,
        length_meters: parseFloat(row.length_meters),
        bbox_min_lng: row.bbox_min_lng,
        bbox_max_lng: row.bbox_max_lng,
        bbox_min_lat: row.bbox_min_lat,
        bbox_max_lat: row.bbox_max_lat
      }))
    ];
    
    // Deduplicate based on app_uuid
    const seenUuids = new Set();
    result.shortTrailsWithInvalidBbox = allShortTrails.filter(trail => {
      if (seenUuids.has(trail.app_uuid)) {
        return false;
      }
      seenUuids.add(trail.app_uuid);
      return true;
    });

    if (result.shortTrailsWithInvalidBbox.length > 0) {
      console.warn(`⚠️ Found ${result.shortTrailsWithInvalidBbox.length} short trails with small bbox ranges:`);
      result.shortTrailsWithInvalidBbox.forEach(trail => {
        console.warn(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_meters.toFixed(2)}m`);
      });
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
   * Validate trail lengths - fail export if any trails are under minimum length
   */
  async validateTrailLengths(schemaName: string, minLengthMeters: number = 2): Promise<TrailLengthValidationResult> {
    console.log(`🔍 Validating trail lengths (minimum: ${minLengthMeters}m)...`);
    
    const result: TrailLengthValidationResult = {
      isValid: true,
      errors: [],
      shortTrailsCount: 0,
      shortTrails: []
    };

    // Get short trails with details for debugging
    const shortTrailsResult = await this.pgClient.query(`
      SELECT name, app_uuid, ST_Length(geometry::geography) as length_meters, region
      FROM ${schemaName}.trails
      WHERE ST_Length(geometry::geography) < $1
      ORDER BY length_meters ASC
    `, [minLengthMeters]);
    
    result.shortTrailsCount = shortTrailsResult.rows.length;
    result.shortTrails = shortTrailsResult.rows.map(row => ({
      name: row.name,
      app_uuid: row.app_uuid,
      length_meters: parseFloat(row.length_meters),
      region: row.region
    }));
    
    if (result.shortTrailsCount > 0) {
      const error = `${result.shortTrailsCount} trails are shorter than ${minLengthMeters} meter(s)`;
      console.error(`❌ TRAIL LENGTH VALIDATION FAILED: ${error}`);
      
      // Log detailed information about short trails for debugging
      console.error('📋 Short trails details:');
      result.shortTrails.forEach(trail => {
        console.error(`   - ${trail.name} (${trail.app_uuid}): ${trail.length_meters.toFixed(2)}m (${trail.region})`);
      });
      
      result.errors.push(error);
      result.isValid = false;
    }

    if (result.isValid) {
      console.log('✅ Trail length validation passed');
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

    // Validate bbox data (commented out to avoid duplicate validation - handled by validate-bbox-data hook)
    // const bboxValidation = await this.validateBboxData(schemaName);
    // if (!bboxValidation.isValid) {
    //   result.errors.push(...bboxValidation.errors);
    //   result.isValid = false;
    // }

    // Validate geometry data
    const geometryValidation = await this.validateGeometryData(schemaName);
    if (!geometryValidation.isValid) {
      result.errors.push(...geometryValidation.errors);
      result.isValid = false;
    }

    // Validate trail lengths (fail export if any trails under 0.5 meters - very lenient for split trails)
    const lengthValidation = await this.validateTrailLengths(schemaName, 0.5);
    if (!lengthValidation.isValid) {
      result.errors.push(...lengthValidation.errors);
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