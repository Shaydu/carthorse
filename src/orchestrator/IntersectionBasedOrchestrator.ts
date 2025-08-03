#!/usr/bin/env ts-node
/**
 * Intersection-Based Carthorse Orchestrator
 * 
 * This orchestrator implements an alternative routing strategy based on:
 * 1. Creating working copies of trail geometry
 * 2. Densifying lines for better intersection detection
 * 3. Exploding multipart lines and splitting at intersections
 * 4. Extracting unique node points (start, end, intersections)
 * 5. Splitting trails at node locations to form graph edges
 * 6. Creating node IDs and assigning source/target nodes
 * 
 * This is a parallel implementation that doesn't disturb the existing orchestrator.
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
dotenv.config();

import { getDbConfig, validateTestEnvironment } from '../utils/env';
import { getStagingSchemaSql } from '../utils/sql/staging-schema';
import { getRegionDataCopySql, validateRegionExistsSql } from '../utils/sql/region-data';
import { validateStagingData, calculateAndDisplayRegionBbox } from '../utils/sql/validation';
import { getTolerances } from '../utils/config-loader';
import { calculateInitialViewBbox, getValidInitialViewBbox } from '../utils/bbox';
import { getTestDbConfig } from '../database/connection';

// --- Type Definitions ---
import type { CarthorseOrchestratorConfig } from '../types';

export interface IntersectionBasedOrchestratorConfig {
  densifyDistance?: number; // Distance in meters for line densification
  snapTolerance?: number;   // Tolerance for snapping nodes to grid
  segmentizeDistance?: number; // Distance for ST_Segmentize
}

export class IntersectionBasedOrchestrator {
  private pgClient!: Client;
  private pgConfig: any;
  private config: IntersectionBasedOrchestratorConfig;
  public readonly stagingSchema: string;

  constructor(config?: IntersectionBasedOrchestratorConfig) {
    this.config = {
      densifyDistance: 5, // 5 meters default
      snapTolerance: 0.00001, // Default snap tolerance
      segmentizeDistance: 5, // 5 meters default
      ...config
    };
    
    // Use a consistent schema name for the intersection-based approach
    this.stagingSchema = 'staging_intersection';
    this.pgConfig = getDbConfig();
    this.pgClient = new Client(this.pgConfig);
  }

  /**
   * Install the intersection-based routing system
   */
  public static async install(): Promise<void> {
    console.log('🔧 Installing intersection-based routing system...');
    
    try {
      const dbConfig = getDbConfig();
      const client = new Client(dbConfig);
      await client.connect();

      // Install the same base schema as the main orchestrator
      await this.installSchema(client);
      
      await client.end();
      console.log('✅ Intersection-based routing system installed successfully!');
    } catch (error) {
      console.error('❌ Failed to install intersection-based routing system:', error);
      throw error;
    }
  }

  /**
   * Install test database with intersection-based routing
   */
  public static async installTestDatabase(region: string = 'boulder', dataLimit: number = 1000): Promise<void> {
    console.log(`🧪 Installing test database with intersection-based routing for region: ${region}`);
    
    try {
      const dbConfig = getDbConfig();
      const client = new Client(dbConfig);
      await client.connect();

      // Install base schema
      await this.installSchema(client);

      // Copy region data
      await this.copyRegionDataToTest(client, region, dataLimit);

      await client.end();
      console.log('✅ Test database with intersection-based routing installed successfully!');
    } catch (error) {
      console.error('❌ Failed to install test database with intersection-based routing:', error);
      throw error;
    }
  }

  /**
   * Process trails using intersection-based routing strategy
   */
  public async processTrails(): Promise<void> {
    console.log('🔄 Processing trails using intersection-based routing strategy...');
    
    try {
      await this.pgClient.connect();
      
      // Step 1: Create working copy of trails geometry
      await this.createWorkingTrails();
      
      // Step 2: Densify the lines for better intersection detection
      await this.densifyLines();
      
      // Step 3: Detect loops and add additional nodes
      await this.detectLoops();
      
      // Step 3.6: Detect trail junctions (where side trails branch off)
      await this.detectJunctions();
      
      // Step 4: Explode multipart lines and split at intersections
      await this.createTrailIntersections();
      
      // Step 5: Extract unique node points
      await this.createTrailNodes();
      
      // Step 6: Create unique nodes with snapping
      await this.createUniqueNodes();
      
      // Step 7: Split trails at node locations
      await this.createGraphEdges();
      
      // Step 8: Create node IDs
      await this.createGraphNodes();
      
      // Step 9: Assign source and target nodes to edges
      await this.createGraphNetwork();
      
      // Step 10: Validate the network
      await this.validateNetwork();
      
      console.log('✅ Intersection-based routing processing completed successfully!');
    } catch (error) {
      console.error('❌ Failed to process trails with intersection-based routing:', error);
      throw error;
    } finally {
      await this.pgClient.end();
    }
  }

  /**
   * Step 1: Create working copy of trails geometry
   */
  private async createWorkingTrails(): Promise<void> {
    console.log('📋 Creating working copy of trails geometry...');
    
    const sql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.working_trails CASCADE;
      CREATE TABLE ${this.stagingSchema}.working_trails AS
      SELECT id, geometry as geom
      FROM ${this.stagingSchema}.trails;
    `;
    
    await this.pgClient.query(sql);
    console.log('✅ Working trails table created');
  }

  /**
   * Step 2: Densify the lines for better intersection detection
   */
  private async densifyLines(): Promise<void> {
    console.log('📏 Densifying lines for better intersection detection...');
    
    const sql = `
      UPDATE ${this.stagingSchema}.working_trails
      SET geom = ST_Segmentize(geom, ${this.config.segmentizeDistance});
    `;
    
    await this.pgClient.query(sql);
    console.log('✅ Lines densified');
  }

  /**
   * Step 3.5: Detect loops and add additional nodes
   */
  private async detectLoops(): Promise<void> {
    console.log('🔄 Detecting loops and adding curve nodes...');
    
    // Debug: Check all trails for potential loops
    const debugLoopsSql = `
      SELECT 
        id,
        name,
        ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance,
        ST_Length(geometry) as trail_length,
        ST_NumPoints(geometry) as num_points,
        ST_GeometryType(geometry) as geom_type
      FROM ${this.stagingSchema}.trails
      WHERE name ILIKE '%boy scout%' OR name ILIKE '%scout%'
      ORDER BY start_end_distance ASC;
    `;
    
    const debugLoopsResult = await this.pgClient.query(debugLoopsSql);
    console.log('🔍 Debug: Boy Scout Trail details:');
    debugLoopsResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. Trail ${row.id} (${row.name}): ${row.start_end_distance.toFixed(2)}m distance, ${row.trail_length.toFixed(2)}m length, ${row.num_points} points, ${row.geom_type}`);
    });
    
    // Check the master database for Boy Scout Trail
    const masterBoyScoutSql = `
      SELECT 
        id,
        name,
        region,
        ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance,
        ST_Length(geometry) as trail_length,
        ST_NumPoints(geometry) as num_points
      FROM trails
      WHERE name ILIKE '%boy scout%' OR name ILIKE '%scout%'
      ORDER BY trail_length DESC
      LIMIT 5;
    `;
    
    const masterBoyScoutResult = await this.pgClient.query(masterBoyScoutSql);
    console.log('🔍 Debug: Boy Scout Trail in master database:');
    masterBoyScoutResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. Trail ${row.id} (${row.name}) in ${row.region}: ${row.start_end_distance.toFixed(2)}m distance, ${row.trail_length.toFixed(2)}m length, ${row.num_points} points`);
    });
    
    // Also check for any trails with "loop" in the name
    const debugLoopNamesSql = `
      SELECT 
        id,
        name,
        ST_Distance(ST_StartPoint(geometry), ST_EndPoint(geometry)) as start_end_distance,
        ST_Length(geometry) as trail_length
      FROM ${this.stagingSchema}.trails
      WHERE name ILIKE '%loop%'
      ORDER BY start_end_distance ASC
      LIMIT 5;
    `;
    
    const debugLoopNamesResult = await this.pgClient.query(debugLoopNamesSql);
    console.log('🔍 Debug: Trails with "loop" in name:');
    debugLoopNamesResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. Trail ${row.id} (${row.name}): ${row.start_end_distance.toFixed(2)}m distance, ${row.trail_length.toFixed(2)}m length`);
    });
    
    // Find trails that form loops (start point close to end point)
    const loopDetectionSql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.loop_trails CASCADE;
      CREATE TABLE ${this.stagingSchema}.loop_trails AS
      SELECT 
        id,
        geom,
        ST_Distance(ST_StartPoint(geom), ST_EndPoint(geom)) as start_end_distance
      FROM ${this.stagingSchema}.working_trails
      WHERE ST_Distance(ST_StartPoint(geom), ST_EndPoint(geom)) < 50; -- 50 meters threshold
    `;
    
    await this.pgClient.query(loopDetectionSql);
    
    // Debug: Check how many loops we found
    const loopCountSql = `SELECT COUNT(*) as count FROM ${this.stagingSchema}.loop_trails;`;
    const loopCountResult = await this.pgClient.query(loopCountSql);
    console.log(`🔍 Debug: Found ${loopCountResult.rows[0].count} loop trails`);
    
    // Only add nodes at actual self-intersections within loops (no curve points)
    const curveNodesSql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.curve_nodes CASCADE;
      CREATE TABLE ${this.stagingSchema}.curve_nodes AS
      SELECT 
        id,
        NULL as point_geom
      FROM ${this.stagingSchema}.loop_trails
      WHERE 1=0; -- Disable curve nodes for now
    `;
    
    await this.pgClient.query(curveNodesSql);
    
    // Add self-intersection detection for loops
    const selfIntersectionSql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.self_intersections CASCADE;
      CREATE TABLE ${this.stagingSchema}.self_intersections AS
      SELECT DISTINCT 
        a.id,
        ST_Intersection(a.geom, a.geom) as intersection_geom
      FROM ${this.stagingSchema}.loop_trails a
      WHERE ST_Intersects(a.geom, a.geom)
        AND GeometryType(ST_Intersection(a.geom, a.geom)) IN ('POINT', 'MULTIPOINT');
    `;
    
    await this.pgClient.query(selfIntersectionSql);
    
    // Debug: Check self-intersections
    const selfIntersectionCountSql = `SELECT COUNT(*) as count FROM ${this.stagingSchema}.self_intersections;`;
    const selfIntersectionCountResult = await this.pgClient.query(selfIntersectionCountSql);
    console.log(`🔍 Debug: Found ${selfIntersectionCountResult.rows[0].count} self-intersections in loops`);
    
    console.log('✅ Loop detection completed');
  }

  /**
   * Step 3.6: Detect trail junctions (where side trails branch off)
   */
  private async detectJunctions(): Promise<void> {
    console.log('🔄 Detecting trail junctions...');
    
    // Find points where trails have junctions (trails that are close to each other)
    const junctionDetectionSql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.trail_junctions CASCADE;
      CREATE TABLE ${this.stagingSchema}.trail_junctions AS
      SELECT DISTINCT
        a.id as main_trail_id,
        b.id as side_trail_id,
        ST_ClosestPoint(a.geom, b.geom) as junction_point,
        ST_Distance(a.geom, b.geom) as distance
      FROM ${this.stagingSchema}.working_trails a
      JOIN ${this.stagingSchema}.working_trails b ON a.id != b.id
      WHERE ST_DWithin(a.geom, b.geom, 5)  -- Trails within 5m of each other
        AND ST_Distance(a.geom, b.geom) > 0  -- But not identical
        AND ST_Length(a.geom) > 0.001  -- Main trail has some length
        AND ST_Length(b.geom) > 0.001;  -- Side trail has some length
    `;
    
    await this.pgClient.query(junctionDetectionSql);
    
    // Debug: Check how many junctions we found
    const junctionCountSql = `SELECT COUNT(*) as count FROM ${this.stagingSchema}.trail_junctions;`;
    const junctionCountResult = await this.pgClient.query(junctionCountSql);
    console.log(`🔍 Debug: Found ${junctionCountResult.rows[0].count} trail junctions`);
    
    // Debug: Show some junction details
    if (junctionCountResult.rows[0].count > 0) {
      const junctionDetailsSql = `
        SELECT 
          main_trail_id, 
          side_trail_id, 
          ROUND(distance::numeric, 3) as distance_m,
          ST_AsText(junction_point) as junction_coords
        FROM ${this.stagingSchema}.trail_junctions 
        LIMIT 5;
      `;
      const junctionDetailsResult = await this.pgClient.query(junctionDetailsSql);
      console.log('🔍 Debug: Sample junctions:');
      junctionDetailsResult.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. Main: ${row.main_trail_id}, Side: ${row.side_trail_id}, Distance: ${row.distance_m}m`);
      });
    }
    
    console.log('✅ Junction detection completed');
  }

  /**
   * Step 4: Explode multipart lines and split at intersections
   */
  private async createTrailIntersections(): Promise<void> {
    console.log('🔗 Creating trail intersections...');
    
    // First, let's check if we have any trails at all
    const trailCountSql = `SELECT COUNT(*) as count FROM ${this.stagingSchema}.working_trails;`;
    const trailCountResult = await this.pgClient.query(trailCountSql);
    console.log(`🔍 Debug: Total trails: ${trailCountResult.rows[0].count}`);
    
    // Check if any trails intersect at all (without geometry type filter)
    const basicIntersectionSql = `
      SELECT COUNT(*) as count
      FROM ${this.stagingSchema}.working_trails a, ${this.stagingSchema}.working_trails b
      WHERE a.id < b.id AND ST_Intersects(a.geom, b.geom);
    `;
    const basicIntersectionResult = await this.pgClient.query(basicIntersectionSql);
    console.log(`🔍 Debug: Trails that intersect (any type): ${basicIntersectionResult.rows[0].count}`);
    
    // Check what types of intersections we're getting
    const intersectionTypesSql = `
      SELECT 
        GeometryType(ST_Intersection(a.geom, b.geom)) as intersection_type,
        COUNT(*) as count
      FROM ${this.stagingSchema}.working_trails a, ${this.stagingSchema}.working_trails b
      WHERE a.id < b.id AND ST_Intersects(a.geom, b.geom)
      GROUP BY GeometryType(ST_Intersection(a.geom, b.geom));
    `;
    const intersectionTypesResult = await this.pgClient.query(intersectionTypesSql);
    console.log('🔍 Debug: Intersection types found:');
    intersectionTypesResult.rows.forEach(row => {
      console.log(`   - ${row.intersection_type}: ${row.count}`);
    });
    
          // First, let's debug what intersections we're finding
      const debugIntersectionsSql = `
        SELECT 
          a.id as trail1_id,
          b.id as trail2_id,
          ST_AsText(ST_Intersection(a.geom, b.geom)) as intersection_point,
          GeometryType(ST_Intersection(a.geom, b.geom)) as intersection_type
        FROM ${this.stagingSchema}.working_trails a, ${this.stagingSchema}.working_trails b
        WHERE a.id < b.id
          AND ST_Intersects(a.geom, b.geom)
          AND GeometryType(ST_Intersection(a.geom, b.geom)) IN ('POINT', 'MULTIPOINT')
        LIMIT 10;
      `;
    
    const debugResult = await this.pgClient.query(debugIntersectionsSql);
    console.log('🔍 Debug: Found intersections:', debugResult.rows.length);
    debugResult.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. Trail ${row.trail1_id} x Trail ${row.trail2_id}: ${row.intersection_type} at ${row.intersection_point}`);
    });
    
    const sql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.trail_intersections CASCADE;
      CREATE TABLE ${this.stagingSchema}.trail_intersections AS
      SELECT DISTINCT ST_Intersection(a.geom, b.geom) AS geom
      FROM ${this.stagingSchema}.working_trails a, ${this.stagingSchema}.working_trails b
      WHERE a.id < b.id
        AND ST_Intersects(a.geom, b.geom)
        AND GeometryType(ST_Intersection(a.geom, b.geom)) IN ('POINT', 'MULTIPOINT');
    `;
    
    await this.pgClient.query(sql);
    console.log('✅ Trail intersections created');
  }

  /**
   * Step 5: Extract unique node points
   */
  private async createTrailNodes(): Promise<void> {
    console.log('📍 Creating trail nodes from start/end points, intersections, and loop nodes...');
    
    const sql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.trail_nodes CASCADE;
      CREATE TABLE ${this.stagingSchema}.trail_nodes AS
      SELECT ST_StartPoint(geom) AS geom FROM ${this.stagingSchema}.working_trails
      UNION
      SELECT ST_EndPoint(geom) FROM ${this.stagingSchema}.working_trails
      UNION
      SELECT geom FROM ${this.stagingSchema}.trail_intersections
      UNION
      SELECT intersection_geom AS geom FROM ${this.stagingSchema}.self_intersections
      WHERE intersection_geom IS NOT NULL
      UNION
      SELECT junction_point AS geom FROM ${this.stagingSchema}.trail_junctions
      WHERE junction_point IS NOT NULL;
    `;
    
    await this.pgClient.query(sql);
    console.log('✅ Trail nodes created');
  }

  /**
   * Step 6: Create unique nodes with snapping
   */
  private async createUniqueNodes(): Promise<void> {
    console.log('🎯 Creating unique nodes with snapping...');
    
    const sql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.unique_nodes CASCADE;
      CREATE TABLE ${this.stagingSchema}.unique_nodes AS
      SELECT ST_SnapToGrid(geom, ${this.config.snapTolerance}) AS geom
      FROM ${this.stagingSchema}.trail_nodes
      GROUP BY ST_SnapToGrid(geom, ${this.config.snapTolerance});
    `;
    
    await this.pgClient.query(sql);
    console.log('✅ Unique nodes created');
  }

  /**
   * Step 7: Split trails at node locations
   */
  private async createGraphEdges(): Promise<void> {
    console.log('✂️ Creating graph edges by splitting trails at nodes...');
    
    const sql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.graph_edges CASCADE;
      CREATE TABLE ${this.stagingSchema}.graph_edges AS
      SELECT (ST_Dump(ST_Split(w.geom, nodes.all_nodes))).geom AS geom
      FROM ${this.stagingSchema}.working_trails w
      CROSS JOIN (
        SELECT ST_Union(geom) AS all_nodes FROM ${this.stagingSchema}.unique_nodes
      ) nodes;
    `;
    
    await this.pgClient.query(sql);
    console.log('✅ Graph edges created');
  }

  /**
   * Step 8: Create node IDs
   */
  private async createGraphNodes(): Promise<void> {
    console.log('🆔 Creating graph nodes with IDs...');
    
    const sql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.graph_nodes CASCADE;
      CREATE TABLE ${this.stagingSchema}.graph_nodes AS
      SELECT row_number() OVER () AS node_id, geom
      FROM ${this.stagingSchema}.unique_nodes;
    `;
    
    await this.pgClient.query(sql);
    console.log('✅ Graph nodes created');
  }

  /**
   * Step 9: Create graph network with source/target nodes
   */
  private async createGraphNetwork(): Promise<void> {
    console.log('🌐 Creating graph network with source/target assignments...');
    
    // First, let's debug the edge splitting to see what we're getting
    const debugEdgesSql = `
      SELECT COUNT(*) as edge_count FROM ${this.stagingSchema}.graph_edges;
    `;
    const debugEdgesResult = await this.pgClient.query(debugEdgesSql);
    console.log(`🔍 Debug: Created ${debugEdgesResult.rows[0].edge_count} graph edges`);
    
    const sql = `
      DROP TABLE IF EXISTS ${this.stagingSchema}.graph_network CASCADE;
      CREATE TABLE ${this.stagingSchema}.graph_network AS
      SELECT 
        e.geom,
        (SELECT node_id FROM ${this.stagingSchema}.graph_nodes n ORDER BY n.geom <-> ST_StartPoint(e.geom) LIMIT 1) AS source,
        (SELECT node_id FROM ${this.stagingSchema}.graph_nodes n ORDER BY n.geom <-> ST_EndPoint(e.geom) LIMIT 1) AS target,
        ST_Length(e.geom)::numeric AS length
      FROM ${this.stagingSchema}.graph_edges e
      WHERE e.geom IS NOT NULL;
    `;
    
    await this.pgClient.query(sql);
    
    // Debug the network connections
    const debugNetworkSql = `
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as connected_edges,
        COUNT(CASE WHEN source IS NULL OR target IS NULL THEN 1 END) as disconnected_edges
      FROM ${this.stagingSchema}.graph_network;
    `;
    const debugNetworkResult = await this.pgClient.query(debugNetworkSql);
    const stats = debugNetworkResult.rows[0];
    console.log(`🔍 Debug: Network stats - Total: ${stats.total_edges}, Connected: ${stats.connected_edges}, Disconnected: ${stats.disconnected_edges}`);
    
    console.log('✅ Graph network created');
  }

  /**
   * Step 10: Validate the network
   */
  private async validateNetwork(): Promise<void> {
    console.log('✅ Validating intersection-based network...');
    
    // Count nodes and edges
    const nodeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.graph_nodes;
    `);
    
    const edgeCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.graph_network;
    `);
    
    console.log(`📊 Network validation complete:`);
    console.log(`   - Nodes: ${nodeCount.rows[0].count}`);
    console.log(`   - Edges: ${edgeCount.rows[0].count}`);
  }

  /**
   * Export the intersection-based network to SQLite
   */
  public async exportToSqlite(outputPath: string): Promise<void> {
    console.log(`💾 Exporting intersection-based network to SQLite: ${outputPath}`);
    
    // This would implement the export logic similar to the main orchestrator
    // but using the intersection-based tables
    throw new Error('Export functionality not yet implemented');
  }

  /**
   * Export the intersection-based network to GeoJSON
   */
  public async exportToGeoJSON(outputPath: string): Promise<void> {
    console.log(`💾 Exporting intersection-based network to GeoJSON: ${outputPath}`);
    
    const client = new Client(this.pgConfig);
    try {
      await client.connect();
      
      // Export trails (green)
      const trailsResult = await client.query(`
        SELECT 
          id,
          name,
          trail_type,
          surface,
          difficulty,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_AsGeoJSON(geometry) as geojson
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL
      `);
      
      // Export edges (magenta) - create straight lines between nodes
      const edgesResult = await client.query(`
        SELECT 
          e.source,
          e.target,
          e.length,
          ST_AsGeoJSON(ST_MakeLine(s.geom, t.geom)) as geojson
        FROM ${this.stagingSchema}.graph_network e
        JOIN ${this.stagingSchema}.graph_nodes s ON e.source = s.node_id
        JOIN ${this.stagingSchema}.graph_nodes t ON e.target = t.node_id
        WHERE e.source IS NOT NULL 
          AND e.target IS NOT NULL
          AND s.geom IS NOT NULL 
          AND t.geom IS NOT NULL
          AND ST_GeometryType(s.geom) = 'ST_Point'
          AND ST_GeometryType(t.geom) = 'ST_Point'
      `);
      
      // Export nodes (blue dots)
      const nodesResult = await client.query(`
        SELECT 
          node_id,
          ST_AsGeoJSON(geom) as geojson
        FROM ${this.stagingSchema}.graph_nodes
        WHERE geom IS NOT NULL
      `);
      
      // Create GeoJSON structure
      const geojson: any = {
        type: "FeatureCollection",
        features: []
      };
      
      // Add trails (green)
      trailsResult.rows.forEach((row, index) => {
        const feature = {
          type: "Feature",
          properties: {
            layer: "trails",
            color: "#00FF00", // Green
            id: row.id,
            name: row.name,
            trail_type: row.trail_type,
            surface: row.surface,
            difficulty: row.difficulty,
            length_km: row.length_km,
            elevation_gain: row.elevation_gain,
            elevation_loss: row.elevation_loss
          },
          geometry: JSON.parse(row.geojson)
        };
        geojson.features.push(feature);
      });
      
      // Add edges (magenta)
      edgesResult.rows.forEach((row, index) => {
        const feature = {
          type: "Feature",
          properties: {
            layer: "edges",
            color: "#FF00FF", // Magenta
            source: row.source,
            target: row.target,
            length: row.length
          },
          geometry: JSON.parse(row.geojson)
        };
        geojson.features.push(feature);
      });
      
      // Add nodes (blue dots)
      nodesResult.rows.forEach((row, index) => {
        const feature = {
          type: "Feature",
          properties: {
            layer: "nodes",
            color: "#0000FF", // Blue
            node_id: row.node_id
          },
          geometry: JSON.parse(row.geojson)
        };
        geojson.features.push(feature);
      });
      
      // Write to file
      const fs = require('fs');
      fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
      
      console.log(`✅ GeoJSON exported with ${geojson.features.length} features:`);
      console.log(`   - Trails (green): ${trailsResult.rows.length}`);
      console.log(`   - Edges (magenta): ${edgesResult.rows.length}`);
      console.log(`   - Nodes (blue): ${nodesResult.rows.length}`);
      
    } catch (error) {
      console.error('❌ Failed to export GeoJSON:', error);
      throw error;
    } finally {
      await client.end();
    }
  }

  /**
   * Clean up the intersection-based staging schema
   */
  public async cleanup(): Promise<void> {
    console.log(`🧹 Cleaning up intersection-based staging schema: ${this.stagingSchema}`);
    
    try {
      await this.pgClient.connect();
      
      const sql = `DROP SCHEMA IF EXISTS ${this.stagingSchema} CASCADE;`;
      await this.pgClient.query(sql);
      
      console.log('✅ Intersection-based staging schema cleaned up');
    } catch (error) {
      console.error('❌ Failed to cleanup intersection-based staging schema:', error);
      throw error;
    } finally {
      await this.pgClient.end();
    }
  }

  /**
   * Install base schema (same as main orchestrator)
   */
  private static async installSchema(client: Client): Promise<void> {
    console.log('📋 Installing base schema...');
    
    // Create the schema first
    await client.query('CREATE SCHEMA IF NOT EXISTS staging_intersection;');
    
    const schemaSql = getStagingSchemaSql('staging_intersection');
    await client.query(schemaSql);
    
    console.log('✅ Base schema installed');
  }

  /**
   * Copy region data to test database
   */
  private static async copyRegionDataToTest(client: Client, region: string, dataLimit: number): Promise<void> {
    console.log(`📊 Copying region data: ${region} (limit: ${dataLimit})`);
    
    // Use a simpler copy SQL that only copies the columns that exist
    const sql = `
      INSERT INTO staging_intersection.trails (
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, region, geometry
      )
      SELECT 
        app_uuid, osm_id, name, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, region, geometry
      FROM trails 
      WHERE region = $1 AND geometry IS NOT NULL
      LIMIT $2
    `;
    
    await client.query(sql, [region, dataLimit]);
    
    console.log('✅ Region data copied to test database');
  }

  /**
   * Get network statistics
   */
  public async getNetworkStats(): Promise<any> {
    const client = new Client(this.pgConfig);
    try {
      await client.connect();
      const stats = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${this.stagingSchema}.graph_nodes) as node_count,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.graph_network) as edge_count,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.trail_intersections) as intersection_count,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.working_trails) as trail_count;
      `);
      return stats.rows[0];
    } catch (error) {
      console.error('❌ Failed to get network stats:', error);
      throw error;
    } finally {
      await client.end();
    }
  }
} 