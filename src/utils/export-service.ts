import { Client } from 'pg';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { 
  createSqliteTables, 
  insertTrails, 
  insertRoutingNodes, 
  insertRoutingEdges, 
  insertRouteRecommendations,
  insertRegionMetadata, 
  buildRegionMeta, 
  insertSchemaVersion, 
  CARTHORSE_SCHEMA_VERSION 
} from './sqlite-export-helpers';

export interface ExportConfig {
  sqliteDbPath: string;
  maxDbSizeMB?: number;
  validate?: boolean;
  region: string;
}

export interface ExportResult {
  trailsExported: number;
  nodesExported: number;
  edgesExported: number;
  recommendationsExported?: number;
  dbSizeMB: number;
  isValid: boolean;
  errors: string[];
}

export class ExportService {
  private pgClient: Client;
  private config: ExportConfig;

  constructor(pgClient: Client, config: ExportConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Export database to SQLite
   */
  async exportDatabase(schemaName: string): Promise<ExportResult> {
    console.log(`📦 Exporting database to SQLite: ${this.config.sqliteDbPath}`);
    
    const result: ExportResult = {
      trailsExported: 0,
      nodesExported: 0,
      edgesExported: 0,
      dbSizeMB: 0,
      isValid: false,
      errors: []
    };

    try {
      // Create SQLite database
      const sqliteDb = new Database(this.config.sqliteDbPath);
      
      // Create tables
      createSqliteTables(sqliteDb);
      
      // Export trails filtered by region
      const trailsResult = await this.pgClient.query(`
        SELECT 
          app_uuid, name, region, osm_id, 'way' as osm_type, trail_type, surface as surface_type, 
          CASE 
            WHEN difficulty = 'unknown' THEN 'moderate'
            ELSE difficulty
          END as difficulty,
          ST_AsGeoJSON(geometry, 6, 1) as geojson,
          length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          created_at, updated_at
        FROM ${schemaName}.trails
        WHERE region = $1
        ORDER BY name
      `, [this.config.region]);
      
      if (trailsResult.rows.length === 0) {
        throw new Error('No trails found to export');
      }
      
      // Insert trails into SQLite
      insertTrails(sqliteDb, trailsResult.rows);
      result.trailsExported = trailsResult.rows.length;
      
      // Export routing nodes (if table exists)
      let nodesResult = { rows: [] };
      try {
        nodesResult = await this.pgClient.query(`
          SELECT 
            id, node_type, trail_id, trail_name,
            ST_AsGeoJSON(the_geom, 6, 1) as geojson,
            elevation, created_at
          FROM ${schemaName}.routing_nodes
          ORDER BY id
        `);
      } catch (error) {
        console.log(`⚠️  Routing nodes table not found in ${schemaName}, skipping nodes export`);
      }
      
      if (nodesResult.rows.length > 0) {
        insertRoutingNodes(sqliteDb, nodesResult.rows);
        result.nodesExported = nodesResult.rows.length;
      }
      
      // Export routing edges (if table exists)
      let edgesResult = { rows: [] };
      try {
        edgesResult = await this.pgClient.query(`
          SELECT 
            id, source, target, trail_id, trail_name,
            distance_km, elevation_gain, elevation_loss,
            ST_AsGeoJSON(geom, 6, 1) as geojson,
            created_at
          FROM ${schemaName}.routing_edges
          ORDER BY id
        `);
      } catch (error) {
        console.log(`⚠️  Routing edges table not found in ${schemaName}, skipping edges export`);
      }
      
      if (edgesResult.rows.length > 0) {
        insertRoutingEdges(sqliteDb, edgesResult.rows);
        result.edgesExported = edgesResult.rows.length;
      }

      // Export route recommendations (if table exists)
      let recommendationsResult = { rows: [] };
      try {
        recommendationsResult = await this.pgClient.query(`
          SELECT 
            route_uuid, region, input_distance_km, input_elevation_gain,
            recommended_distance_km, recommended_elevation_gain, recommended_elevation_loss,
            route_score, route_type, route_name, route_shape, trail_count,
            route_path, route_edges, request_hash, expires_at, created_at
          FROM ${schemaName}.route_recommendations
          ORDER BY created_at DESC
        `);
      } catch (error) {
        console.log(`⚠️  Route recommendations table not found in ${schemaName}, skipping recommendations export`);
      }
      
      if (recommendationsResult.rows.length > 0) {
        insertRouteRecommendations(sqliteDb, recommendationsResult.rows);
        result.recommendationsExported = recommendationsResult.rows.length;
      }
      
      // Export route trails (v14)
      let routeTrailsResult = { rows: [] };
      try {
        routeTrailsResult = await this.pgClient.query(`
          SELECT 
            route_uuid, trail_id, trail_name, segment_order,
            segment_distance_km, segment_elevation_gain, segment_elevation_loss,
            created_at
          FROM ${schemaName}.route_trails
          ORDER BY route_uuid, segment_order
        `);
      } catch (error) {
        console.log(`⚠️  Route trails table not found in ${schemaName}, skipping route trails export`);
      }
      
      if (routeTrailsResult.rows.length > 0) {
        // Insert route trails into SQLite
        const insertRouteTrails = sqliteDb.prepare(`
          INSERT INTO route_trails (
            route_uuid, trail_id, trail_name, segment_order,
            segment_distance_km, segment_elevation_gain, segment_elevation_loss,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const insertMany = sqliteDb.transaction((trails: any[]) => {
          for (const trail of trails) {
            insertRouteTrails.run(
              trail.route_uuid,
              trail.trail_id,
              trail.trail_name,
              trail.segment_order,
              trail.segment_distance_km,
              trail.segment_elevation_gain,
              trail.segment_elevation_loss,
              trail.created_at ? (typeof trail.created_at === 'string' ? trail.created_at : trail.created_at.toISOString()) : new Date().toISOString()
            );
          }
        });
        
        insertMany(routeTrailsResult.rows);
        console.log(`✅ Exported ${routeTrailsResult.rows.length} route trail segments`);
      }
      
      // Insert region metadata
      const regionMeta = buildRegionMeta(trailsResult.rows, this.config.region, {
        trailCount: result.trailsExported,
        nodeCount: result.nodesExported,
        edgeCount: result.edgesExported
      });
      insertRegionMetadata(sqliteDb, regionMeta);
      
      // Insert schema version
      insertSchemaVersion(sqliteDb, CARTHORSE_SCHEMA_VERSION);
      
      // Close SQLite database
      sqliteDb.close();
      
      // Check database size
      const stats = fs.statSync(this.config.sqliteDbPath);
      result.dbSizeMB = stats.size / (1024 * 1024);
      
      console.log(`✅ Export completed:`);
      console.log(`   - Trails: ${result.trailsExported}`);
      console.log(`   - Nodes: ${result.nodesExported}`);
      console.log(`   - Edges: ${result.edgesExported}`);
      if (result.recommendationsExported) {
        console.log(`   - Route Recommendations: ${result.recommendationsExported}`);
      }
      console.log(`   - Size: ${result.dbSizeMB.toFixed(2)} MB`);
      
      // Validate export if requested
      if (this.config.validate) {
        result.isValid = await this.validateExport();
      } else {
        result.isValid = true;
      }
      
    } catch (error) {
      const errorMsg = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`❌ ${errorMsg}`);
      result.errors.push(errorMsg);
      result.isValid = false;
    }
    
    return result;
  }

  /**
   * Export staging data to SQLite
   */
  async exportStagingData(schemaName: string): Promise<ExportResult> {
    console.log(`📦 Exporting staging data to SQLite: ${this.config.sqliteDbPath}`);
    
    const result: ExportResult = {
      trailsExported: 0,
      nodesExported: 0,
      edgesExported: 0,
      dbSizeMB: 0,
      isValid: false,
      errors: []
    };

    try {
      // Create SQLite database
      const sqliteDb = new Database(this.config.sqliteDbPath);
      
      // Create tables
      createSqliteTables(sqliteDb);
      
      // Check what tables exist in staging
      const tableCheck = (table: string) => {
        return this.pgClient.query(`
          SELECT COUNT(*) as count 
          FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = $2
        `, [schemaName, table]);
      };
      
      const rowCount = (table: string) => {
        return this.pgClient.query(`SELECT COUNT(*) as count FROM ${schemaName}.${table}`);
      };
      
      // Check if trails table exists
      const trailsExist = await tableCheck('trails');
      if (parseInt(trailsExist.rows[0].count) === 0) {
        throw new Error(`Trails table not found in schema ${schemaName}`);
      }
      
      // Export trails
      const trailsResult = await this.pgClient.query(`
        SELECT 
          app_uuid, name, region, osm_id, osm_type, 
          length_km, elevation_gain, elevation_loss, 
          max_elevation, min_elevation, avg_elevation,
          difficulty, surface_type, trail_type,
          ST_AsGeoJSON(geometry, 6, 1) as geojson,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          created_at, updated_at
        FROM ${schemaName}.trails
        ORDER BY name
      `);
      
      if (trailsResult.rows.length === 0) {
        console.warn('⚠️ No trails found in staging schema');
      } else {
        insertTrails(sqliteDb, trailsResult.rows);
        result.trailsExported = trailsResult.rows.length;
      }
      
      // Check and export routing nodes
      const nodesExist = await tableCheck('routing_nodes');
      if (parseInt(nodesExist.rows[0].count) > 0) {
        const nodesResult = await this.pgClient.query(`
          SELECT 
            id, node_type, trail_id, trail_name,
            ST_AsGeoJSON(geometry, 6, 1) as geojson,
            elevation, created_at
          FROM ${schemaName}.routing_nodes
          ORDER BY id
        `);
        
        if (nodesResult.rows.length > 0) {
          insertRoutingNodes(sqliteDb, nodesResult.rows);
          result.nodesExported = nodesResult.rows.length;
        }
      }
      
      // Check and export routing edges
      const edgesExist = await tableCheck('routing_edges');
      if (parseInt(edgesExist.rows[0].count) > 0) {
        const edgesResult = await this.pgClient.query(`
          SELECT 
            id, source, target, trail_id, trail_name,
            distance_km, elevation_gain, elevation_loss,
            ST_AsGeoJSON(geometry, 6, 1) as geojson,
            created_at
          FROM ${schemaName}.routing_edges
          ORDER BY id
        `);
        
        if (edgesResult.rows.length > 0) {
          insertRoutingEdges(sqliteDb, edgesResult.rows);
          result.edgesExported = edgesResult.rows.length;
        }
      }
      
      // Insert region metadata
      const regionMeta = buildRegionMeta(trailsResult.rows, this.config.region, {
        trailCount: result.trailsExported,
        nodeCount: result.nodesExported,
        edgeCount: result.edgesExported
      });
      insertRegionMetadata(sqliteDb, regionMeta);
      
      // Insert schema version
      insertSchemaVersion(sqliteDb, CARTHORSE_SCHEMA_VERSION);
      
      // Close SQLite database
      sqliteDb.close();
      
      // Check database size
      const stats = fs.statSync(this.config.sqliteDbPath);
      result.dbSizeMB = stats.size / (1024 * 1024);
      
      console.log(`✅ Staging export completed:`);
      console.log(`   - Trails: ${result.trailsExported}`);
      console.log(`   - Nodes: ${result.nodesExported}`);
      console.log(`   - Edges: ${result.edgesExported}`);
      console.log(`   - Size: ${result.dbSizeMB.toFixed(2)} MB`);
      
      result.isValid = true;
      
    } catch (error) {
      const errorMsg = `Staging export failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`❌ ${errorMsg}`);
      result.errors.push(errorMsg);
      result.isValid = false;
    }
    
    return result;
  }

  /**
   * Validate exported database
   */
  private async validateExport(): Promise<boolean> {
    console.log('🔍 Validating exported database...');
    
    try {
      const sqliteDb = new Database(this.config.sqliteDbPath);
      
      // Check if tables exist
      const tables = ['trails', 'routing_nodes', 'routing_edges', 'regions', 'schema_version'];
      for (const table of tables) {
        const result = sqliteDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number } | undefined;
        if (!result || result.count === 0) {
          console.error(`❌ Validation failed: Table ${table} is empty or missing`);
          sqliteDb.close();
          return false;
        }
      }
      
      // Check trail count
      const trailCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM trails').get() as { count: number } | undefined;
      if (!trailCount || trailCount.count === 0) {
        console.error('❌ Validation failed: No trails found in database');
        sqliteDb.close();
        return false;
      }
      
      // Check database size
      const stats = fs.statSync(this.config.sqliteDbPath);
      const dbSizeMB = stats.size / (1024 * 1024);
      
      if (this.config.maxDbSizeMB && dbSizeMB > this.config.maxDbSizeMB) {
        console.error(`❌ Validation failed: Database size ${dbSizeMB.toFixed(2)} MB exceeds limit ${this.config.maxDbSizeMB} MB`);
        sqliteDb.close();
        return false;
      }
      
      sqliteDb.close();
      console.log('✅ Database validation passed');
      return true;
      
    } catch (error) {
      console.error(`❌ Validation failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}