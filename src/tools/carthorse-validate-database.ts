#!/usr/bin/env ts-node
/**
 * Database Validation Script
 * 
 * This script performs comprehensive validation of a trail database after build completion.
 * It checks data completeness, quality, and identifies any missing or problematic data.
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

async function validateDatabase(dbPath: string): Promise<ValidationResult> {
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
    regionMetadata: {
      regionName: '',
      bbox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 },
      trailCount: 0
    },
    issues: [],
    recommendations: []
  };

  try {
    // Check table existence
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    const requiredTables = ['trails', 'routing_nodes', 'routing_edges', 'region_metadata', 'schema_version'];
    for (const table of requiredTables) {
      if (!tableNames.includes(table)) {
        result.issues.push({ type: 'error', message: `Missing required table: ${table}` });
      }
    }
    if (result.issues.length > 0) return result;

    // Basic trail statistics (use geojson)
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
        COUNT(CASE WHEN surface IS NOT NULL AND surface != '' THEN 1 END) as with_surface,
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
      avgElevationGain: trailStats.avg_elevation_gain || 0,
      avgElevationLoss: trailStats.avg_elevation_loss || 0,
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
        AND surface IS NOT NULL AND surface != ''
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
      SELECT surface, COUNT(*) as count
      FROM trails 
      WHERE surface IS NOT NULL AND surface != ''
      GROUP BY surface 
      ORDER BY count DESC
    `).all() as Array<{ surface: string; count: number }>;

    result.surfaceDistribution = surfaceStats.map(s => ({
      surface: s.surface,
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
          (SELECT COUNT(DISTINCT from_node_id) + COUNT(DISTINCT to_node_id) FROM routing_edges) as connected_nodes
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
          SELECT DISTINCT from_node_id FROM routing_edges 
          UNION 
          SELECT DISTINCT to_node_id FROM routing_edges
        )
      `).get() as any;
      result.networkValidation.orphanedNodes = orphanedNodes.count || 0;

      // Orphaned edges
      const orphanedEdges = db.prepare(`
        SELECT COUNT(*) as count
        FROM routing_edges 
        WHERE from_node_id NOT IN (SELECT id FROM routing_nodes) 
           OR to_node_id NOT IN (SELECT id FROM routing_nodes)
      `).get() as any;
      result.networkValidation.orphanedEdges = orphanedEdges.count || 0;

      // Self-loops
      const selfLoops = db.prepare(`
        SELECT COUNT(*) as count
        FROM routing_edges 
        WHERE from_node_id = to_node_id
      `).get() as any;
      result.networkValidation.selfLoops = selfLoops.count || 0;

      // Duplicate edges
      const duplicateEdges = db.prepare(`
        SELECT COUNT(*) as count
        FROM (
          SELECT from_node_id, to_node_id, trail_id, COUNT(*) as cnt
          FROM routing_edges 
          GROUP BY from_node_id, to_node_id, trail_id 
          HAVING cnt > 1
        )
      `).get() as any;
      result.networkValidation.duplicateEdges = duplicateEdges.count || 0;

      // Node type distribution
      const nodeTypes = db.prepare(`
        SELECT node_type, COUNT(*) as count
        FROM routing_nodes 
        WHERE node_type IS NOT NULL
        GROUP BY node_type
      `).all() as Array<{ node_type: string; count: number }>;
      
      for (const nodeType of nodeTypes) {
        result.networkValidation.nodeTypeDistribution[nodeType.node_type] = nodeType.count;
      }
    }

    // Region metadata
    if (tableNames.includes('region_metadata')) {
      const regionMeta = db.prepare(`
        SELECT region_name, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, trail_count
        FROM region_metadata 
        LIMIT 1
      `).get() as any;
      
      if (regionMeta) {
        result.regionMetadata = {
          regionName: regionMeta.region_name || '',
          bbox: {
            minLng: regionMeta.bbox_min_lng || 0,
            maxLng: regionMeta.bbox_max_lng || 0,
            minLat: regionMeta.bbox_min_lat || 0,
            maxLat: regionMeta.bbox_max_lat || 0
          },
          trailCount: regionMeta.trail_count || 0
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
}

function printValidationReport(result: ValidationResult): void {
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