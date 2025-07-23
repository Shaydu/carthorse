import Database from 'better-sqlite3';
import { createSpatiaLiteTables, insertTrails, insertRoutingNodes, insertRoutingEdges, insertRegionMetadata, buildRegionMeta, insertSchemaVersion } from './spatialite-export-helpers';
import { createSqliteTables, insertTrails as insertTrailsSqlite, insertRoutingNodes as insertRoutingNodesSqlite, insertRoutingEdges as insertRoutingEdgesSqlite, insertRegionMetadata as insertRegionMetadataSqlite, buildRegionMeta as buildRegionMetaSqlite, insertSchemaVersion as insertSchemaVersionSqlite } from './sqlite-export-helpers';

/**
 * Export strategy interface for different database formats
 */
export interface ExportStrategy {
  name: string;
  createTables(db: Database.Database): void;
  insertTrails(db: Database.Database, trails: any[]): void;
  insertRoutingNodes(db: Database.Database, nodes: any[]): void;
  insertRoutingEdges(db: Database.Database, edges: any[]): void;
  insertRegionMetadata(db: Database.Database, region: string, bbox: any, trailCount: number): void;
  insertSchemaVersion(db: Database.Database, version: string): void;
}

/**
 * SpatiaLite export strategy - includes spatial geometry columns
 */
export class SpatiaLiteExportStrategy implements ExportStrategy {
  name = 'SpatiaLite';

  createTables(db: Database.Database): void {
    createSpatiaLiteTables(db);
  }

  insertTrails(db: Database.Database, trails: any[]): void {
    insertTrails(db, trails);
  }

  insertRoutingNodes(db: Database.Database, nodes: any[]): void {
    insertRoutingNodes(db, nodes);
  }

  insertRoutingEdges(db: Database.Database, edges: any[]): void {
    insertRoutingEdges(db, edges);
  }

  insertRegionMetadata(db: Database.Database, region: string, bbox: any, trailCount: number): void {
    insertRegionMetadata(db, region, bbox, trailCount);
  }

  insertSchemaVersion(db: Database.Database, version: string): void {
    insertSchemaVersion(db, version);
  }
}

/**
 * SQLite export strategy - no spatial geometry columns, just coordinates
 */
export class SqliteExportStrategy implements ExportStrategy {
  name = 'SQLite';

  createTables(db: Database.Database): void {
    createSqliteTables(db);
  }

  insertTrails(db: Database.Database, trails: any[]): void {
    insertTrailsSqlite(db, trails);
  }

  insertRoutingNodes(db: Database.Database, nodes: any[]): void {
    insertRoutingNodesSqlite(db, nodes);
  }

  insertRoutingEdges(db: Database.Database, edges: any[]): void {
    insertRoutingEdgesSqlite(db, edges);
  }

  insertRegionMetadata(db: Database.Database, region: string, bbox: any, trailCount: number): void {
    insertRegionMetadataSqlite(db, region, bbox, trailCount);
  }

  insertSchemaVersion(db: Database.Database, version: string): void {
    insertSchemaVersionSqlite(db, version);
  }
}

/**
 * Export strategy factory
 */
export class ExportStrategyFactory {
  static create(useSqlite: boolean): ExportStrategy {
    if (useSqlite) {
      return new SqliteExportStrategy();
    } else {
      return new SpatiaLiteExportStrategy();
    }
  }
}

/**
 * Export orchestrator that uses the strategy pattern
 */
export class ExportOrchestrator {
  private strategy: ExportStrategy;

  constructor(strategy: ExportStrategy) {
    this.strategy = strategy;
  }

  /**
   * Export data to the target database using the selected strategy
   */
  exportData(
    db: Database.Database,
    trails: any[],
    nodes: any[],
    edges: any[],
    region: string,
    bbox: any,
    trailCount: number,
    schemaVersion: string = '1.0.0'
  ): void {
    console.log(`📊 Exporting to ${this.strategy.name}...`);
    
    // Create tables
    this.strategy.createTables(db);
    
    // Insert data
    this.strategy.insertTrails(db, trails);
    this.strategy.insertRoutingNodes(db, nodes);
    this.strategy.insertRoutingEdges(db, edges);
    this.strategy.insertRegionMetadata(db, region, bbox, trailCount);
    this.strategy.insertSchemaVersion(db, schemaVersion);
    
    console.log(`✅ Export to ${this.strategy.name} completed successfully`);
  }
} 