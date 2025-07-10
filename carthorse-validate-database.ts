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
  issues: Array<{
    type: 'error' | 'warning' | 'info';
    message: string;
    count?: number;
  }>;
  recommendations: string[];
}

// CLI args
function getArg(flag: string, fallback: string | null): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv.length > idx + 1) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const dbPath = getArg('--db', null);
if (!dbPath) {
  console.error('❌ Please provide database path: --db <path>');
  process.exit(1);
}

const SPATIALITE_PATH = '/opt/homebrew/lib/mod_spatialite.dylib';

async function validateDatabase(dbPath: string): Promise<ValidationResult> {
  console.log('🔍 Validating Database...');
  console.log('📁 Database:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const db = new Database(dbPath);
  
  // Try to load SpatiaLite
  let spatialiteLoaded = false;
  try {
    db.loadExtension(SPATIALITE_PATH);
    spatialiteLoaded = true;
  } catch (e) {
    console.log('⚠️  SpatiaLite not loaded, some spatial queries may fail');
  }

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
    issues: [],
    recommendations: []
  };

  try {
    // Check table existence
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    
    if (!tableNames.includes('trails')) {
      result.issues.push({ type: 'error', message: 'trails table missing' });
      return result;
    }

    // Basic trail statistics
    const trailStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN geometry IS NOT NULL THEN 1 END) as with_geometry,
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
      trailsWithInvalidGeometry: 0
    };

    // Check for complete trails (all required fields present)
    const completeTrails = db.prepare(`
      SELECT COUNT(*) as count
      FROM trails 
      WHERE geometry IS NOT NULL 
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

    // Routing network statistics
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

    // Check for invalid geometry
    if (spatialiteLoaded) {
      try {
        const invalidGeometry = db.prepare(`
          SELECT COUNT(*) as count
          FROM trails 
          WHERE geometry IS NOT NULL 
            AND (ST_NumPoints(geometry) < 2 OR ST_IsValid(geometry) = 0)
        `).get() as any;
        
        result.qualityMetrics.trailsWithInvalidGeometry = invalidGeometry.count || 0;
      } catch (e) {
        result.issues.push({ type: 'warning', message: 'Could not validate geometry due to SpatiaLite issues' });
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