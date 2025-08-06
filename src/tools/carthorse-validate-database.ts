#!/usr/bin/env ts-node
/**
 * Database Validation Script - v14 Schema Validator
 * 
 * This script performs comprehensive validation of a v14 trail database after build completion.
 * It checks data completeness, quality, and identifies any missing or problematic data.
 * 
 * IMPORTANT: This validator is designed for v14 schema only. It will fail if the database
 * schema version is not 14.
 * 
 * Usage:
 *   npx ts-node validate-database.ts --db <database_path>
 *   npx ts-node validate-database.ts --db ../../data/boulder-complete.db
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Types
interface ValidationResult {
  summary: {
    totalTrails: number;
    completeTrails: number;
    incompleteTrails: number;
    completionRate: number;
  };
  trailData: {
    withGeometry: number;
    withLength: number;
    withElevationGain: number;
    withElevationLoss: number;
    withMaxElevation: number;
    withMinElevation: number;
    withAvgElevation: number;
    withNames: number;
    withSurface: number;
    withTrailType: number;
    withBbox: number;
  };
  routingData: {
    nodes: number;
    edges: number;
    connectedNodes: number;
    isolatedNodes: number;
  };
  qualityMetrics: {
    avgLength: number;
    avgElevationGain: number;
    avgElevationLoss: number;
    trailsWithZeroElevation: number;
    trailsWithZeroLength: number;
    trailsWithInvalidGeometry: number;
  };
  surfaceDistribution: Array<{
    surface: string;
    count: number;
    percentage: number;
  }>;
  trailTypeDistribution: Array<{
    trailType: string;
    count: number;
    percentage: number;
  }>;
  schemaValidation: {
    requiredTables: string[];
    missingTables: string[];
    tableSchemas: Record<string, any>;
  };
  geometryValidation: {
    validTrailGeometries: number;
    validEdgeGeometries: number;
    totalTrailGeometries: number;
    totalEdgeGeometries: number;
  };
  networkValidation: {
    orphanedNodes: number;
    orphanedEdges: number;
    selfLoops: number;
    duplicateEdges: number;
    nodeTypeDistribution: Record<string, number>;
  };
  routeRecommendationsValidation: {
    totalRoutes: number;
    routesWithValidData: number;
    routesWithInvalidData: number;
    routesWithValidGeometry: number;
    routesWithValidScores: number;
    routesWithValidDistances: number;
    routesWithValidElevation: number;
    routesWithValidTrailCount: number;
    routesWithValidRouteType: number;
    routesWithValidRouteShape: number;
    routesWithValidDifficulty: number;
    routesWithValidConnectivity: number;
    orphanedRoutes: number;
    routesWithoutTrailComposition: number;
    routeTypeDistribution: Record<string, number>;
    routeShapeDistribution: Record<string, number>;
    routeDifficultyDistribution: Record<string, number>;
    averageRouteScore: number;
    averageRouteDistance: number;
    averageRouteElevationGain: number;
    routesWithZeroScore: number;
    routesWithZeroDistance: number;
    routesWithZeroElevation: number;
    routesWithInvalidGeometry: number;
  };
  regionMetadata: {
    regionName: string;
    bbox: {
      minLng: number;
      maxLng: number;
      minLat: number;
      maxLat: number;
    };
    trailCount: number;
  };
  issues: Array<{
    type: 'error' | 'warning' | 'info';
    message: string;
    count?: number;
  }>;
  recommendations: string[];
}

// CLI args
function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv.length > idx + 1) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const dbPath = getArg('--db', '');
if (!dbPath) {
  console.error('❌ Please provide database path: --db <path>');
  process.exit(1);
}

export async function validateDatabase(dbPath: string): Promise<ValidationResult> {
  console.log('🔍 Validating Database...');
  console.log('📁 Database:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const db = new Database(dbPath);

  const result: ValidationResult = {
    summary: { totalTrails: 0, completeTrails: 0, incompleteTrails: 0, completionRate: 0 },
    trailData: {
      withGeometry: 0, withLength: 0, withElevationGain: 0, withElevationLoss: 0,
      withMaxElevation: 0, withMinElevation: 0, withAvgElevation: 0, withNames: 0,
      withSurface: 0, withTrailType: 0, withBbox: 0
    },
    routingData: { nodes: 0, edges: 0, connectedNodes: 0, isolatedNodes: 0 },
    qualityMetrics: {
      avgLength: 0, avgElevationGain: 0, avgElevationLoss: 0,
      trailsWithZeroElevation: 0, trailsWithZeroLength: 0, trailsWithInvalidGeometry: 0
    },
    surfaceDistribution: [],
    trailTypeDistribution: [],
    schemaValidation: {
      requiredTables: [],
      missingTables: [],
      tableSchemas: {}
    },
    geometryValidation: {
      validTrailGeometries: 0,
      validEdgeGeometries: 0,
      totalTrailGeometries: 0,
      totalEdgeGeometries: 0
    },
    networkValidation: {
      orphanedNodes: 0,
      orphanedEdges: 0,
      selfLoops: 0,
      duplicateEdges: 0,
      nodeTypeDistribution: {}
    },
    routeRecommendationsValidation: {
      totalRoutes: 0,
      routesWithValidData: 0,
      routesWithInvalidData: 0,
      routesWithValidGeometry: 0,
      routesWithValidScores: 0,
      routesWithValidDistances: 0,
      routesWithValidElevation: 0,
      routesWithValidTrailCount: 0,
      routesWithValidRouteType: 0,
      routesWithValidRouteShape: 0,
      routesWithValidDifficulty: 0,
      routesWithValidConnectivity: 0,
      orphanedRoutes: 0,
      routesWithoutTrailComposition: 0,
      routeTypeDistribution: {},
      routeShapeDistribution: {},
      routeDifficultyDistribution: {},
      averageRouteScore: 0,
      averageRouteDistance: 0,
      averageRouteElevationGain: 0,
      routesWithZeroScore: 0,
      routesWithZeroDistance: 0,
      routesWithZeroElevation: 0,
      routesWithInvalidGeometry: 0
    },
    regionMetadata: {
      regionName: '',
      bbox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 },
      trailCount: 0
    },
    issues: [],
    recommendations: []
  };

  try {
    // PHASE 1: SCHEMA VALIDATION
    
    // 1.1 Check table existence
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    const requiredTables = [
      'trails', 
      'routing_nodes', 
      'routing_edges', 
      'route_recommendations',  // v14 table
      'route_trails',           // v14 table
      'region_metadata', 
      'schema_version'
    ];
    
    for (const table of requiredTables) {
      if (!tableNames.includes(table)) {
        result.issues.push({ type: 'error', message: `Missing required table: ${table}` });
      }
    }
    if (result.issues.length > 0) return result;

    // 1.2 Validate schema version - MUST be v14
    const schemaVersion = db.prepare(`
      SELECT version FROM schema_version ORDER BY id DESC LIMIT 1
    `).get() as any;

    if (!schemaVersion || !schemaVersion.version) {
      result.issues.push({ 
        type: 'error', 
        message: 'Schema version table is missing or empty' 
      });
      return result;
    }

    if (schemaVersion.version !== 14) {
      result.issues.push({ 
        type: 'error', 
        message: `This validator is designed for v14 schema only. Found schema version ${schemaVersion.version}. Please use the appropriate validator for your schema version.` 
      });
      return result;
    }

    console.log(`✅ Schema version validated: v${schemaVersion.version} (from schema_version table)`);

    // 1.3 Validate column structure against v14 schema
    const v14ColumnDefinitions = {
      trails: [
        'id', 'app_uuid', 'name', 'region', 'osm_id', 'osm_type', 'length_km', 
        'elevation_gain', 'elevation_loss', 'max_elevation', 'min_elevation', 'avg_elevation',
        'difficulty', 'surface_type', 'trail_type', 'geojson', 'bbox_min_lng', 'bbox_max_lng',
        'bbox_min_lat', 'bbox_max_lat', 'created_at', 'updated_at'
      ],
      routing_nodes: [
        'id', 'node_uuid', 'lat', 'lng', 'elevation', 'node_type', 'connected_trails', 'created_at'
      ],
      routing_edges: [
        'id', 'source', 'target', 'trail_id', 'trail_name', 'length_km', 
        'elevation_gain', 'elevation_loss', 'geojson', 'created_at'
      ],
      route_recommendations: [
                  'id', 'route_uuid', 'region', 'input_length_km', 'input_elevation_gain',
        'recommended_length_km', 'recommended_elevation_gain', 'route_elevation_loss',
        'route_score', 'route_type', 'route_name', 'route_shape', 'trail_count',
        'route_path', 'route_edges', 'similarity_score', 'created_at',
        'input_distance_tolerance', 'input_elevation_tolerance', 'expires_at', 'usage_count',
        'complete_route_data', 'trail_connectivity_data', 'request_hash',
        'route_gain_rate', 'route_trail_count', 'route_max_elevation', 'route_min_elevation',
        'route_avg_elevation', 'route_difficulty', 'route_estimated_time_hours', 'route_connectivity_score'
      ],
      route_trails: [
        'id', 'route_uuid', 'trail_id', 'trail_name', 'segment_order',
        'segment_distance_km', 'segment_elevation_gain', 'segment_elevation_loss', 'created_at'
      ],
      region_metadata: [
        'id', 'region', 'total_trails', 'total_nodes', 'total_edges', 'total_routes',
        'bbox_min_lat', 'bbox_max_lat', 'bbox_min_lng', 'bbox_max_lng', 'created_at', 'updated_at'
      ],
      schema_version: [
        'id', 'version', 'description', 'created_at'
      ]
    };

    // Validate each table's columns
    for (const [tableName, expectedColumns] of Object.entries(v14ColumnDefinitions)) {
      if (tableNames.includes(tableName)) {
        const actualColumns = db.prepare(`PRAGMA table_info(${tableName})`).all()
          .map((col: any) => col.name);
        
        const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
        const extraColumns = actualColumns.filter(col => !expectedColumns.includes(col));
        
        if (missingColumns.length > 0) {
          result.issues.push({ 
            type: 'error', 
            message: `Table ${tableName} missing required columns: ${missingColumns.join(', ')}` 
          });
        }
        
        if (extraColumns.length > 0) {
          result.issues.push({ 
            type: 'warning', 
            message: `Table ${tableName} has extra columns: ${extraColumns.join(', ')}` 
          });
        }
      }
    }

    // 1.4 Validate indexes exist (key performance indexes)
    const expectedIndexes = [
      'idx_trails_name', 'idx_trails_length', 'idx_trails_elevation',
      'idx_routing_nodes_coords', 'idx_routing_nodes_elevation', 'idx_routing_nodes_type',
      'idx_routing_edges_source_target', 'idx_routing_edges_trail', 'idx_routing_edges_length'
    ];
    
    const actualIndexes = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'
    `).all().map((row: any) => row.name);
    
    const missingIndexes = expectedIndexes.filter(idx => !actualIndexes.includes(idx));
    if (missingIndexes.length > 0) {
      result.issues.push({ 
        type: 'warning', 
        message: `Missing performance indexes: ${missingIndexes.join(', ')}` 
      });
    }

    console.log('✅ Schema structure validation completed');

    // PHASE 2: DATA VALIDATION (only if schema passes)
    console.log('🔍 Starting data validation...');
    
    // 2.1 Basic trail statistics (use geojson)
    const trailStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN geojson IS NOT NULL AND geojson != '' THEN 1 END) as with_geometry,
        COUNT(CASE WHEN length_km IS NOT NULL AND length_km > 0 THEN 1 END) as with_length,
        COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as with_elevation_gain,
        COUNT(CASE WHEN elevation_loss IS NOT NULL THEN 1 END) as with_elevation_loss,
        COUNT(CASE WHEN max_elevation IS NOT NULL THEN 1 END) as with_max_elevation,
        COUNT(CASE WHEN min_elevation IS NOT NULL THEN 1 END) as with_min_elevation,
        COUNT(CASE WHEN avg_elevation IS NOT NULL THEN 1 END) as with_avg_elevation,
        COUNT(CASE WHEN name IS NOT NULL AND name != '' THEN 1 END) as with_names,
        COUNT(CASE WHEN surface_type IS NOT NULL AND surface_type != '' THEN 1 END) as with_surface,
        COUNT(CASE WHEN trail_type IS NOT NULL AND trail_type != '' THEN 1 END) as with_trail_type,
        COUNT(CASE WHEN bbox_min_lng IS NOT NULL AND bbox_max_lng IS NOT NULL AND bbox_min_lat IS NOT NULL AND bbox_max_lat IS NOT NULL THEN 1 END) as with_bbox,
        COUNT(CASE WHEN elevation_gain = 0 OR elevation_gain IS NULL THEN 1 END) as zero_elevation,
        COUNT(CASE WHEN length_km = 0 OR length_km IS NULL THEN 1 END) as zero_length,
        AVG(length_km) as avg_length,
        AVG(elevation_gain) as avg_elevation_gain,
        AVG(elevation_loss) as avg_elevation_loss
      FROM trails
    `).get() as any;

    result.summary.totalTrails = trailStats.total || 0;
    result.trailData = {
      withGeometry: trailStats.with_geometry || 0,
      withLength: trailStats.with_length || 0,
      withElevationGain: trailStats.with_elevation_gain || 0,
      withElevationLoss: trailStats.with_elevation_loss || 0,
      withMaxElevation: trailStats.with_max_elevation || 0,
      withMinElevation: trailStats.with_min_elevation || 0,
      withAvgElevation: trailStats.with_avg_elevation || 0,
      withNames: trailStats.with_names || 0,
      withSurface: trailStats.with_surface || 0,
      withTrailType: trailStats.with_trail_type || 0,
      withBbox: trailStats.with_bbox || 0
    };

    result.qualityMetrics = {
      avgLength: trailStats.avg_length || 0,
      avgElevationGain: trailStats.avg_elevation_gain !== null ? trailStats.avg_elevation_gain : 0,
      avgElevationLoss: trailStats.avg_elevation_loss !== null ? trailStats.avg_elevation_loss : 0,
      trailsWithZeroElevation: trailStats.zero_elevation || 0,
      trailsWithZeroLength: trailStats.zero_length || 0,
      trailsWithInvalidGeometry: 0 // Not checked in SQLite
    };

    // Check for complete trails (all required fields present)
    const completeTrails = db.prepare(`
      SELECT COUNT(*) as count
      FROM trails 
      WHERE geojson IS NOT NULL AND geojson != ''
        AND length_km IS NOT NULL AND length_km > 0
        AND elevation_gain IS NOT NULL
        AND elevation_loss IS NOT NULL
        AND max_elevation IS NOT NULL
        AND min_elevation IS NOT NULL
        AND avg_elevation IS NOT NULL
        AND name IS NOT NULL AND name != ''
        AND surface_type IS NOT NULL AND surface_type != ''
        AND trail_type IS NOT NULL AND trail_type != ''
        AND bbox_min_lng IS NOT NULL AND bbox_max_lng IS NOT NULL 
        AND bbox_min_lat IS NOT NULL AND bbox_max_lat IS NOT NULL
    `).get() as any;

    result.summary.completeTrails = completeTrails.count || 0;
    result.summary.incompleteTrails = result.summary.totalTrails - result.summary.completeTrails;
    result.summary.completionRate = result.summary.totalTrails > 0 ? 
      (result.summary.completeTrails / result.summary.totalTrails) * 100 : 0;

    // Surface distribution
    const surfaceStats = db.prepare(`
      SELECT surface_type, COUNT(*) as count
      FROM trails 
      WHERE surface_type IS NOT NULL AND surface_type != ''
      GROUP BY surface_type 
      ORDER BY count DESC
    `).all() as Array<{ surface_type: string; count: number }>;

    result.surfaceDistribution = surfaceStats.map(s => ({
      surface: s.surface_type,
      count: s.count,
      percentage: (s.count / result.summary.totalTrails) * 100
    }));

    // Trail type distribution
    const trailTypeStats = db.prepare(`
      SELECT trail_type, COUNT(*) as count
      FROM trails 
      WHERE trail_type IS NOT NULL AND trail_type != ''
      GROUP BY trail_type 
      ORDER BY count DESC
    `).all() as Array<{ trail_type: string; count: number }>;

    result.trailTypeDistribution = trailTypeStats.map(t => ({
      trailType: t.trail_type,
      count: t.count,
      percentage: (t.count / result.summary.totalTrails) * 100
    }));

    // Routing network statistics (use coordinate_wkt, geometry_wkt)
    if (tableNames.includes('routing_nodes') && tableNames.includes('routing_edges')) {
      const routingStats = db.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM routing_nodes) as nodes,
          (SELECT COUNT(*) FROM routing_edges) as edges,
          (SELECT COUNT(DISTINCT source) + COUNT(DISTINCT target) FROM routing_edges) as connected_nodes
      `).get() as any;

      result.routingData = {
        nodes: routingStats.nodes || 0,
        edges: routingStats.edges || 0,
        connectedNodes: routingStats.connected_nodes || 0,
        isolatedNodes: 0
      };

      // Calculate isolated nodes
      if (result.routingData.nodes > 0 && result.routingData.edges > 0) {
        result.routingData.isolatedNodes = result.routingData.nodes - (result.routingData.connectedNodes / 2);
      }
    }

    // Schema validation
    result.schemaValidation.requiredTables = requiredTables;
    result.schemaValidation.missingTables = requiredTables.filter(table => !tableNames.includes(table));
    
    // Get table schemas
    for (const table of tableNames) {
      try {
        const schema = db.prepare(`PRAGMA table_info(${table})`).all();
        result.schemaValidation.tableSchemas[table] = schema;
      } catch (error) {
        console.warn(`Could not get schema for table ${table}:`, error);
      }
    }

    // Geometry validation
    const geometryStats = db.prepare(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN json_valid(geojson) THEN 1 END) as valid_trail_geometries
      FROM trails
    `).get() as any;
    
    result.geometryValidation.totalTrailGeometries = geometryStats.total_trails || 0;
    result.geometryValidation.validTrailGeometries = geometryStats.valid_trail_geometries || 0;

    if (tableNames.includes('routing_edges')) {
      const edgeGeometryStats = db.prepare(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN json_valid(geojson) THEN 1 END) as valid_edge_geometries
        FROM routing_edges
      `).get() as any;
      
      result.geometryValidation.totalEdgeGeometries = edgeGeometryStats.total_edges || 0;
      result.geometryValidation.validEdgeGeometries = edgeGeometryStats.valid_edge_geometries || 0;
    }

    // Network validation
    if (tableNames.includes('routing_nodes') && tableNames.includes('routing_edges')) {
      // Orphaned nodes
      const orphanedNodes = db.prepare(`
        SELECT COUNT(*) as count
        FROM routing_nodes 
        WHERE id NOT IN (
          SELECT DISTINCT source FROM routing_edges 
          UNION 
          SELECT DISTINCT target FROM routing_edges
        )
      `).get() as any;
      result.networkValidation.orphanedNodes = orphanedNodes.count || 0;

      // Orphaned edges
      const orphanedEdges = db.prepare(`
        SELECT COUNT(*) as count
        FROM routing_edges 
        WHERE source NOT IN (SELECT id FROM routing_nodes) 
           OR target NOT IN (SELECT id FROM routing_nodes)
      `).get() as any;
      result.networkValidation.orphanedEdges = orphanedEdges.count || 0;

      // Self-loops
      const selfLoops = db.prepare(`
        SELECT COUNT(*) as count
        FROM routing_edges 
        WHERE source = target
      `).get() as any;
      result.networkValidation.selfLoops = selfLoops.count || 0;

      // Duplicate edges
      const duplicateEdges = db.prepare(`
        SELECT COUNT(*) as count
        FROM (
          SELECT source, target, trail_id, COUNT(*) as cnt
          FROM routing_edges 
          GROUP BY source, target, trail_id 
          HAVING cnt > 1
        )
      `).get() as any;
      result.networkValidation.duplicateEdges = duplicateEdges.count || 0;

      // Node type distribution (v14 schema)
      const nodeTypeStats = db.prepare(`
        SELECT node_type, COUNT(*) as count
        FROM routing_nodes 
        WHERE node_type IS NOT NULL
        GROUP BY node_type
        ORDER BY node_type
      `).all() as Array<{ node_type: string; count: number }>;
      
      for (const nodeType of nodeTypeStats) {
        result.networkValidation.nodeTypeDistribution[nodeType.node_type] = nodeType.count;
      }
    }

    // Route recommendations validation (v14 schema)
    if (tableNames.includes('route_recommendations')) {
      console.log('🔍 Validating route recommendations...');
      
      // Basic route count and data validation
      const routeStats = db.prepare(`
        SELECT 
          COUNT(*) as total_routes,
          COUNT(CASE WHEN route_uuid IS NOT NULL AND route_uuid != '' THEN 1 END) as routes_with_valid_uuid,
          COUNT(CASE WHEN route_score >= 0 AND route_score <= 100 THEN 1 END) as routes_with_valid_scores,
          COUNT(CASE WHEN recommended_length_km > 0 THEN 1 END) as routes_with_valid_distances,
          COUNT(CASE WHEN recommended_elevation_gain >= 0 THEN 1 END) as routes_with_valid_elevation,
          COUNT(CASE WHEN trail_count >= 1 THEN 1 END) as routes_with_valid_trail_count,
          COUNT(CASE WHEN route_type IN ('out-and-back', 'loop', 'lollipop', 'point-to-point') THEN 1 END) as routes_with_valid_type,
          COUNT(CASE WHEN route_shape IN ('loop', 'out-and-back', 'lollipop', 'point-to-point') THEN 1 END) as routes_with_valid_shape,
          COUNT(CASE WHEN route_difficulty IN ('easy', 'moderate', 'hard', 'expert') THEN 1 END) as routes_with_valid_difficulty,
          COUNT(CASE WHEN route_connectivity_score >= 0 AND route_connectivity_score <= 1 THEN 1 END) as routes_with_valid_connectivity,
          COUNT(CASE WHEN json_valid(route_path) THEN 1 END) as routes_with_valid_geometry,
          COUNT(CASE WHEN route_score = 0 THEN 1 END) as routes_with_zero_score,
          COUNT(CASE WHEN recommended_length_km = 0 THEN 1 END) as routes_with_zero_distance,
          COUNT(CASE WHEN recommended_elevation_gain = 0 THEN 1 END) as routes_with_zero_elevation,
          AVG(route_score) as avg_route_score,
          AVG(recommended_length_km) as avg_route_distance,
          AVG(recommended_elevation_gain) as avg_route_elevation
        FROM route_recommendations
      `).get() as any;

      result.routeRecommendationsValidation = {
        totalRoutes: routeStats.total_routes || 0,
        routesWithValidData: routeStats.routes_with_valid_uuid || 0,
        routesWithInvalidData: (routeStats.total_routes || 0) - (routeStats.routes_with_valid_uuid || 0),
        routesWithValidGeometry: routeStats.routes_with_valid_geometry || 0,
        routesWithValidScores: routeStats.routes_with_valid_scores || 0,
        routesWithValidDistances: routeStats.routes_with_valid_distances || 0,
        routesWithValidElevation: routeStats.routes_with_valid_elevation || 0,
        routesWithValidTrailCount: routeStats.routes_with_valid_trail_count || 0,
        routesWithValidRouteType: routeStats.routes_with_valid_type || 0,
        routesWithValidRouteShape: routeStats.routes_with_valid_shape || 0,
        routesWithValidDifficulty: routeStats.routes_with_valid_difficulty || 0,
        routesWithValidConnectivity: routeStats.routes_with_valid_connectivity || 0,
        orphanedRoutes: 0, // Will be calculated below
        routesWithoutTrailComposition: 0, // Will be calculated below
        routeTypeDistribution: {},
        routeShapeDistribution: {},
        routeDifficultyDistribution: {},
        averageRouteScore: routeStats.avg_route_score || 0,
        averageRouteDistance: routeStats.avg_route_distance || 0,
        averageRouteElevationGain: routeStats.avg_route_elevation || 0,
        routesWithZeroScore: routeStats.routes_with_zero_score || 0,
        routesWithZeroDistance: routeStats.routes_with_zero_distance || 0,
        routesWithZeroElevation: routeStats.routes_with_zero_elevation || 0,
        routesWithInvalidGeometry: (routeStats.total_routes || 0) - (routeStats.routes_with_valid_geometry || 0)
      };

      // Route type distribution
      const routeTypeStats = db.prepare(`
        SELECT route_type, COUNT(*) as count
        FROM route_recommendations 
        WHERE route_type IS NOT NULL
        GROUP BY route_type
        ORDER BY route_type
      `).all() as Array<{ route_type: string; count: number }>;
      
      for (const routeType of routeTypeStats) {
        result.routeRecommendationsValidation.routeTypeDistribution[routeType.route_type] = routeType.count;
      }

      // Route shape distribution
      const routeShapeStats = db.prepare(`
        SELECT route_shape, COUNT(*) as count
        FROM route_recommendations 
        WHERE route_shape IS NOT NULL
        GROUP BY route_shape
        ORDER BY route_shape
      `).all() as Array<{ route_shape: string; count: number }>;
      
      for (const routeShape of routeShapeStats) {
        result.routeRecommendationsValidation.routeShapeDistribution[routeShape.route_shape] = routeShape.count;
      }

      // Route difficulty distribution
      const routeDifficultyStats = db.prepare(`
        SELECT route_difficulty, COUNT(*) as count
        FROM route_recommendations 
        WHERE route_difficulty IS NOT NULL
        GROUP BY route_difficulty
        ORDER BY route_difficulty
      `).all() as Array<{ route_difficulty: string; count: number }>;
      
      for (const routeDifficulty of routeDifficultyStats) {
        result.routeRecommendationsValidation.routeDifficultyDistribution[routeDifficulty.route_difficulty] = routeDifficulty.count;
      }

      // Check for orphaned routes (routes without trail composition)
      if (tableNames.includes('route_trails')) {
        const orphanedRoutes = db.prepare(`
          SELECT COUNT(*) as count
          FROM route_recommendations rr
          LEFT JOIN route_trails rt ON rr.route_uuid = rt.route_uuid
          WHERE rt.route_uuid IS NULL
        `).get() as any;
        result.routeRecommendationsValidation.orphanedRoutes = orphanedRoutes.count || 0;

        // Check for routes without trail composition
        const routesWithoutComposition = db.prepare(`
          SELECT COUNT(DISTINCT rr.route_uuid) as count
          FROM route_recommendations rr
          LEFT JOIN route_trails rt ON rr.route_uuid = rt.route_uuid
          WHERE rt.route_uuid IS NULL OR rt.trail_id IS NULL
        `).get() as any;
        result.routeRecommendationsValidation.routesWithoutTrailComposition = routesWithoutComposition.count || 0;
      } else {
        // If route_trails table doesn't exist, all routes are considered orphaned
        result.routeRecommendationsValidation.orphanedRoutes = result.routeRecommendationsValidation.totalRoutes;
        result.routeRecommendationsValidation.routesWithoutTrailComposition = result.routeRecommendationsValidation.totalRoutes;
      }

      console.log(`✅ Route recommendations validation completed: ${result.routeRecommendationsValidation.totalRoutes} routes found`);
    }

    // Region metadata
    if (tableNames.includes('region_metadata')) {
      const regionMeta = db.prepare(`
        SELECT region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, total_trails
        FROM region_metadata 
        LIMIT 1
      `).get() as any;
      
      if (regionMeta) {
        result.regionMetadata = {
          regionName: regionMeta.region || '',
          bbox: {
            minLng: regionMeta.bbox_min_lng || 0,
            maxLng: regionMeta.bbox_max_lng || 0,
            minLat: regionMeta.bbox_min_lat || 0,
            maxLat: regionMeta.bbox_max_lat || 0
          },
          trailCount: regionMeta.total_trails || 0
        };
      }
    }

    // Generate issues and recommendations
    generateIssuesAndRecommendations(result);

  } finally {
    db.close();
  }

  return result;
}

function generateIssuesAndRecommendations(result: ValidationResult): void {
  // Issues
  if (result.summary.totalTrails === 0) {
    result.issues.push({ type: 'error', message: 'No trails found in database' });
  }

  if (result.trailData.withGeometry === 0) {
    result.issues.push({ type: 'error', message: 'No trails with geometry found' });
  }

  if (result.trailData.withElevationGain === 0) {
    result.issues.push({ type: 'error', message: 'No trails with elevation data found' });
  }

  if (result.qualityMetrics.trailsWithZeroElevation > result.summary.totalTrails * 0.5) {
    result.issues.push({ 
      type: 'warning', 
      message: `High number of trails with zero elevation (${result.qualityMetrics.trailsWithZeroElevation}/${result.summary.totalTrails})`,
      count: result.qualityMetrics.trailsWithZeroElevation
    });
  }

  if (result.qualityMetrics.trailsWithZeroLength > 0) {
    result.issues.push({ 
      type: 'warning', 
      message: `Trails with zero length found`,
      count: result.qualityMetrics.trailsWithZeroLength
    });
  }

  if (result.qualityMetrics.trailsWithInvalidGeometry > 0) {
    result.issues.push({ 
      type: 'warning', 
      message: `Trails with invalid geometry found`,
      count: result.qualityMetrics.trailsWithInvalidGeometry
    });
  }

  if (result.routingData.nodes === 0) {
    result.issues.push({ type: 'warning', message: 'No routing nodes found' });
  }

  if (result.routingData.edges === 0) {
    result.issues.push({ type: 'warning', message: 'No routing edges found' });
  }

  if (result.routingData.isolatedNodes > result.routingData.nodes * 0.1) {
    result.issues.push({ 
      type: 'warning', 
      message: `High number of isolated routing nodes (${result.routingData.isolatedNodes}/${result.routingData.nodes})`
    });
  }

  // Schema validation issues
  if (result.schemaValidation.missingTables.length > 0) {
    result.issues.push({ 
      type: 'error', 
      message: `Missing required tables: ${result.schemaValidation.missingTables.join(', ')}`
    });
  }

  // Geometry validation issues
  if (result.geometryValidation.validTrailGeometries < result.geometryValidation.totalTrailGeometries) {
    result.issues.push({ 
      type: 'error', 
      message: `Invalid trail geometries found (${result.geometryValidation.totalTrailGeometries - result.geometryValidation.validTrailGeometries}/${result.geometryValidation.totalTrailGeometries})`
    });
  }

  if (result.geometryValidation.validEdgeGeometries < result.geometryValidation.totalEdgeGeometries) {
    result.issues.push({ 
      type: 'error', 
      message: `Invalid edge geometries found (${result.geometryValidation.totalEdgeGeometries - result.geometryValidation.validEdgeGeometries}/${result.geometryValidation.totalEdgeGeometries})`
    });
  }

  // Network validation issues
  if (result.networkValidation.orphanedNodes > 0) {
    result.issues.push({ 
      type: 'warning', 
      message: `Orphaned routing nodes found (not connected to any edges)`,
      count: result.networkValidation.orphanedNodes
    });
  }

  if (result.networkValidation.orphanedEdges > 0) {
    result.issues.push({ 
      type: 'error', 
      message: `Orphaned routing edges found (pointing to non-existent nodes)`,
      count: result.networkValidation.orphanedEdges
    });
  }

  if (result.networkValidation.selfLoops > 0) {
    result.issues.push({ 
      type: 'warning', 
      message: `Self-loop edges found (edge from node to itself)`,
      count: result.networkValidation.selfLoops
    });
  }

  if (result.networkValidation.duplicateEdges > 0) {
    result.issues.push({ 
      type: 'warning', 
      message: `Duplicate edges found`,
      count: result.networkValidation.duplicateEdges
    });
  }

  // Recommendations
  if (result.summary.completionRate < 90) {
    result.recommendations.push(`Improve data completeness: Only ${result.summary.completionRate.toFixed(1)}% of trails are complete`);
  }

  if (result.qualityMetrics.avgLength < 0.1) {
    result.recommendations.push('Average trail length is very short - consider filtering out very short trails');
  }

  if (result.qualityMetrics.avgElevationGain < 10) {
    result.recommendations.push('Average elevation gain is very low - check if elevation data is properly loaded');
  }

  if (result.surfaceDistribution.length > 0 && result.surfaceDistribution[0].surface === 'gravel') {
    result.recommendations.push('Consider filtering out gravel trails if you want only natural surfaces');
  }

  if (result.routingData.edges < result.routingData.nodes * 0.5) {
    result.recommendations.push('Routing network seems sparse - check if trail splitting worked correctly');
  }

  // Route recommendations validation issues
  if (result.routeRecommendationsValidation.totalRoutes === 0) {
    result.issues.push({ type: 'warning', message: 'No route recommendations found in database' });
  }

  if (result.routeRecommendationsValidation.routesWithInvalidData > 0) {
    result.issues.push({ 
      type: 'error', 
      message: `Route recommendations with invalid data found`,
      count: result.routeRecommendationsValidation.routesWithInvalidData
    });
  }

  if (result.routeRecommendationsValidation.routesWithInvalidGeometry > 0) {
    result.issues.push({ 
      type: 'error', 
      message: `Route recommendations with invalid geometry found`,
      count: result.routeRecommendationsValidation.routesWithInvalidGeometry
    });
  }

  if (result.routeRecommendationsValidation.routesWithZeroScore > 0) {
    result.issues.push({ 
      type: 'warning', 
      message: `Route recommendations with zero score found`,
      count: result.routeRecommendationsValidation.routesWithZeroScore
    });
  }

  if (result.routeRecommendationsValidation.routesWithZeroDistance > 0) {
    result.issues.push({ 
      type: 'error', 
      message: `Route recommendations with zero distance found`,
      count: result.routeRecommendationsValidation.routesWithZeroDistance
    });
  }

  if (result.routeRecommendationsValidation.routesWithZeroElevation > 0) {
    result.issues.push({ 
      type: 'warning', 
      message: `Route recommendations with zero elevation gain found`,
      count: result.routeRecommendationsValidation.routesWithZeroElevation
    });
  }

  if (result.routeRecommendationsValidation.orphanedRoutes > 0) {
    result.issues.push({ 
      type: 'error', 
      message: `Orphaned route recommendations found (without trail composition)`,
      count: result.routeRecommendationsValidation.orphanedRoutes
    });
  }

  if (result.routeRecommendationsValidation.routesWithoutTrailComposition > 0) {
    result.issues.push({ 
      type: 'warning', 
      message: `Route recommendations without trail composition found`,
      count: result.routeRecommendationsValidation.routesWithoutTrailComposition
    });
  }

  // Route recommendations recommendations
  if (result.routeRecommendationsValidation.totalRoutes > 0) {
    if (result.routeRecommendationsValidation.averageRouteScore < 50) {
      result.recommendations.push(`Average route score is low (${result.routeRecommendationsValidation.averageRouteScore.toFixed(1)}) - consider improving route generation algorithm`);
    }

    if (result.routeRecommendationsValidation.averageRouteDistance < 1.0) {
      result.recommendations.push(`Average route distance is very short (${result.routeRecommendationsValidation.averageRouteDistance.toFixed(1)}km) - check route generation parameters`);
    }

    if (result.routeRecommendationsValidation.averageRouteElevationGain < 10) {
      result.recommendations.push(`Average route elevation gain is very low (${result.routeRecommendationsValidation.averageRouteElevationGain.toFixed(1)}m) - check elevation data quality`);
    }

    const routeTypeCount = Object.keys(result.routeRecommendationsValidation.routeTypeDistribution).length;
    if (routeTypeCount < 2) {
      result.recommendations.push(`Limited route type diversity (${routeTypeCount} types) - consider generating more route variety`);
    }

    const routeShapeCount = Object.keys(result.routeRecommendationsValidation.routeShapeDistribution).length;
    if (routeShapeCount < 2) {
      result.recommendations.push(`Limited route shape diversity (${routeShapeCount} shapes) - consider generating more route variety`);
    }

    const routeDifficultyCount = Object.keys(result.routeRecommendationsValidation.routeDifficultyDistribution).length;
    if (routeDifficultyCount < 2) {
      result.recommendations.push(`Limited route difficulty diversity (${routeDifficultyCount} difficulties) - consider generating routes for different skill levels`);
    }
  }
}

export function printValidationReport(result: ValidationResult): void {
  console.log('\n📊 Database Validation Report');
  console.log('============================\n');

  // Summary
  console.log('🎯 Summary:');
  console.log(`   Total Trails: ${result.summary.totalTrails}`);
  console.log(`   Complete Trails: ${result.summary.completeTrails}`);
  console.log(`   Incomplete Trails: ${result.summary.incompleteTrails}`);
  console.log(`   Completion Rate: ${result.summary.completionRate.toFixed(1)}%`);
  console.log('');

  // Trail Data Quality
  console.log('🗺️ Trail Data Quality:');
  console.log(`   With Geometry: ${result.trailData.withGeometry} (${((result.trailData.withGeometry / result.summary.totalTrails) * 100).toFixed(1)}%)`);
  console.log(`   With Length: ${result.trailData.withLength} (${((result.trailData.withLength / result.summary.totalTrails) * 100).toFixed(1)}%)`);
  console.log(`   With Elevation Gain: ${result.trailData.withElevationGain} (${((result.trailData.withElevationGain / result.summary.totalTrails) * 100).toFixed(1)}%)`);
  console.log(`   With Elevation Loss: ${result.trailData.withElevationLoss} (${((result.trailData.withElevationLoss / result.summary.totalTrails) * 100).toFixed(1)}%)`);
  console.log(`   With Names: ${result.trailData.withNames} (${((result.trailData.withNames / result.summary.totalTrails) * 100).toFixed(1)}%)`);
  console.log(`   With Surface: ${result.trailData.withSurface} (${((result.trailData.withSurface / result.summary.totalTrails) * 100).toFixed(1)}%)`);
  console.log(`   With Trail Type: ${result.trailData.withTrailType} (${((result.trailData.withTrailType / result.summary.totalTrails) * 100).toFixed(1)}%)`);
  console.log(`   With BBox: ${result.trailData.withBbox} (${((result.trailData.withBbox / result.summary.totalTrails) * 100).toFixed(1)}%)`);
  console.log('');

  // Quality Metrics
  console.log('📈 Quality Metrics:');
  console.log(`   Average Length: ${result.qualityMetrics.avgLength.toFixed(2)} km`);
  console.log(`   Average Elevation Gain: ${result.qualityMetrics.avgElevationGain.toFixed(1)} m`);
  console.log(`   Average Elevation Loss: ${result.qualityMetrics.avgElevationLoss.toFixed(1)} m`);
  console.log(`   Trails with Zero Elevation: ${result.qualityMetrics.trailsWithZeroElevation}`);
  console.log(`   Trails with Zero Length: ${result.qualityMetrics.trailsWithZeroLength}`);
  console.log(`   Trails with Invalid Geometry: ${result.qualityMetrics.trailsWithInvalidGeometry}`);
  console.log('');

  // Routing Network
  console.log('🔗 Routing Network:');
  console.log(`   Routing Nodes: ${result.routingData.nodes}`);
  console.log(`   Routing Edges: ${result.routingData.edges}`);
  console.log(`   Connected Nodes: ${result.routingData.connectedNodes}`);
  console.log(`   Isolated Nodes: ${result.routingData.isolatedNodes}`);
  console.log('');

  // Surface Distribution
  if (result.surfaceDistribution.length > 0) {
    console.log('🛤️ Surface Distribution:');
    result.surfaceDistribution.forEach(s => {
      console.log(`   ${s.surface}: ${s.count} (${s.percentage.toFixed(1)}%)`);
    });
    console.log('');
  }

  // Trail Type Distribution
  if (result.trailTypeDistribution.length > 0) {
    console.log('🏃 Trail Type Distribution:');
    result.trailTypeDistribution.forEach(t => {
      console.log(`   ${t.trailType}: ${t.count} (${t.percentage.toFixed(1)}%)`);
    });
    console.log('');
  }

  // Schema Validation
  console.log('🗄️ Schema Validation:');
  console.log(`   Required Tables: ${result.schemaValidation.requiredTables.join(', ')}`);
  if (result.schemaValidation.missingTables.length > 0) {
    console.log(`   ❌ Missing Tables: ${result.schemaValidation.missingTables.join(', ')}`);
  } else {
    console.log(`   ✅ All required tables present`);
  }
  console.log(`   Total Tables: ${Object.keys(result.schemaValidation.tableSchemas).length}`);
  console.log('');

  // Geometry Validation
  console.log('🗺️ Geometry Validation:');
  console.log(`   Trail Geometries: ${result.geometryValidation.validTrailGeometries}/${result.geometryValidation.totalTrailGeometries} valid`);
  console.log(`   Edge Geometries: ${result.geometryValidation.validEdgeGeometries}/${result.geometryValidation.totalEdgeGeometries} valid`);
  if (result.geometryValidation.validTrailGeometries === result.geometryValidation.totalTrailGeometries && 
      result.geometryValidation.validEdgeGeometries === result.geometryValidation.totalEdgeGeometries) {
    console.log(`   ✅ All geometries are valid GeoJSON`);
  }
  console.log('');

  // Network Validation
  console.log('🔗 Network Validation:');
  console.log(`   Orphaned Nodes: ${result.networkValidation.orphanedNodes}`);
  console.log(`   Orphaned Edges: ${result.networkValidation.orphanedEdges}`);
  console.log(`   Self-Loops: ${result.networkValidation.selfLoops}`);
  console.log(`   Duplicate Edges: ${result.networkValidation.duplicateEdges}`);
  if (Object.keys(result.networkValidation.nodeTypeDistribution).length > 0) {
    console.log(`   Node Types: ${Object.entries(result.networkValidation.nodeTypeDistribution).map(([type, count]) => `${type}: ${count}`).join(', ')}`);
  }
  console.log('');

  // Route Recommendations Validation
  console.log('🛤️ Route Recommendations Validation:');
  console.log(`   Total Routes: ${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Data: ${result.routeRecommendationsValidation.routesWithValidData}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Geometry: ${result.routeRecommendationsValidation.routesWithValidGeometry}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Scores: ${result.routeRecommendationsValidation.routesWithValidScores}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Distances: ${result.routeRecommendationsValidation.routesWithValidDistances}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Elevation: ${result.routeRecommendationsValidation.routesWithValidElevation}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Trail Count: ${result.routeRecommendationsValidation.routesWithValidTrailCount}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Route Type: ${result.routeRecommendationsValidation.routesWithValidRouteType}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Route Shape: ${result.routeRecommendationsValidation.routesWithValidRouteShape}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Difficulty: ${result.routeRecommendationsValidation.routesWithValidDifficulty}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Valid Connectivity: ${result.routeRecommendationsValidation.routesWithValidConnectivity}/${result.routeRecommendationsValidation.totalRoutes}`);
  console.log(`   Orphaned Routes: ${result.routeRecommendationsValidation.orphanedRoutes}`);
  console.log(`   Routes Without Trail Composition: ${result.routeRecommendationsValidation.routesWithoutTrailComposition}`);
  console.log(`   Routes with Zero Score: ${result.routeRecommendationsValidation.routesWithZeroScore}`);
  console.log(`   Routes with Zero Distance: ${result.routeRecommendationsValidation.routesWithZeroDistance}`);
  console.log(`   Routes with Zero Elevation: ${result.routeRecommendationsValidation.routesWithZeroElevation}`);
  console.log(`   Routes with Invalid Geometry: ${result.routeRecommendationsValidation.routesWithInvalidGeometry}`);
  
  if (result.routeRecommendationsValidation.totalRoutes > 0) {
    console.log(`   Average Route Score: ${result.routeRecommendationsValidation.averageRouteScore.toFixed(1)}`);
    console.log(`   Average Route Distance: ${result.routeRecommendationsValidation.averageRouteDistance.toFixed(1)}km`);
    console.log(`   Average Route Elevation Gain: ${result.routeRecommendationsValidation.averageRouteElevationGain.toFixed(1)}m`);
    
    if (Object.keys(result.routeRecommendationsValidation.routeTypeDistribution).length > 0) {
      console.log(`   Route Types: ${Object.entries(result.routeRecommendationsValidation.routeTypeDistribution).map(([type, count]) => `${type}: ${count}`).join(', ')}`);
    }
    
    if (Object.keys(result.routeRecommendationsValidation.routeShapeDistribution).length > 0) {
      console.log(`   Route Shapes: ${Object.entries(result.routeRecommendationsValidation.routeShapeDistribution).map(([shape, count]) => `${shape}: ${count}`).join(', ')}`);
    }
    
    if (Object.keys(result.routeRecommendationsValidation.routeDifficultyDistribution).length > 0) {
      console.log(`   Route Difficulties: ${Object.entries(result.routeRecommendationsValidation.routeDifficultyDistribution).map(([difficulty, count]) => `${difficulty}: ${count}`).join(', ')}`);
    }
  }
  console.log('');

  // Region Metadata
  if (result.regionMetadata.regionName) {
    console.log('📍 Region Metadata:');
    console.log(`   Region: ${result.regionMetadata.regionName}`);
    console.log(`   BBox: ${result.regionMetadata.bbox.minLng.toFixed(6)}, ${result.regionMetadata.bbox.minLat.toFixed(6)} to ${result.regionMetadata.bbox.maxLng.toFixed(6)}, ${result.regionMetadata.bbox.maxLat.toFixed(6)}`);
    console.log(`   Trail Count: ${result.regionMetadata.trailCount}`);
    console.log('');
  }

  // Issues
  if (result.issues.length > 0) {
    console.log('⚠️ Issues Found:');
    result.issues.forEach(issue => {
      const icon = issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️';
      const count = issue.count ? ` (${issue.count})` : '';
      console.log(`   ${icon} ${issue.message}${count}`);
    });
    console.log('');
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    console.log('💡 Recommendations:');
    result.recommendations.forEach(rec => {
      console.log(`   💡 ${rec}`);
    });
    console.log('');
  }

  // Overall Assessment
  const hasErrors = result.issues.some(i => i.type === 'error');
  const hasWarnings = result.issues.some(i => i.type === 'warning');
  
  if (hasErrors) {
    console.log('❌ Database has critical issues that need to be addressed.');
  } else if (hasWarnings) {
    console.log('⚠️ Database has warnings but is generally functional.');
  } else {
    console.log('✅ Database validation passed successfully!');
  }
}

// Main execution
async function main() {
  try {
    const result = await validateDatabase(dbPath);
    printValidationReport(result);
    
    // Exit with error code if there are critical issues
    const hasErrors = result.issues.some(i => i.type === 'error');
    if (hasErrors) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

main(); 