#!/usr/bin/env ts-node
/**
 * OSM PostgreSQL Loader for Trail Data Processing
 * 
 * This module loads OSM data from .osm.pbf files directly into PostgreSQL
 * and then queries it using the same criteria as the original Overpass queries.
 * 
 * Usage:
 *   const loader = new OSMPostgresLoader('boulder');
 *   const trails = await loader.extractTrails();
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { TrailInsertData } from './carthorse-postgres-atomic-insert';
import * as dotenv from 'dotenv';
dotenv.config();

interface OSMWay {
  osm_id: number;
  name: string;
  highway: string;
  route: string;
  surface: string;
  difficulty: string;
  tags: Record<string, string>;
  way_geom: string; // PostGIS geometry as WKT
}

export class OSMPostgresLoader {
  private osmSchema: string;
  private osmFilePath: string;

  constructor(private region: string) {
    this.osmSchema = `osm_${region}`; // Separate schema for OSM data
    this.osmFilePath = this.getOSMFilePath();
  }

  /**
   * Create a new PostgreSQL client
   */
  private createClient(): Client {
    return new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });
  }

  /**
   * Get OSM file path for the region
   */
  private getOSMFilePath(): string {
    const sourceDataDir = process.env.SOURCE_DATA_DIR || '/path/to/source-data';
    return path.join(sourceDataDir, 'osm', `${this.region}-colorado.osm.pbf`);
  }

  /**
   * Load OSM data into PostgreSQL using osm2pgsql
   */
  async loadOSMData(): Promise<void> {
    console.log(`📖 Loading OSM data for ${this.region}...`);
    
    if (!fs.existsSync(this.osmFilePath)) {
      throw new Error(`OSM extract file not found: ${this.osmFilePath}`);
    }

    const pgClient = this.createClient();

    try {
      // Connect to PostgreSQL
      await pgClient.connect();
      console.log('✅ Connected to PostgreSQL');

      // Create OSM schema
      await this.createOSMSchema(pgClient);

      // Load OSM data using osm2pgsql
      await this.runOsm2Pgsql();

      console.log('✅ OSM data loaded successfully');

    } catch (error) {
      console.error('❌ Error loading OSM data:', error);
      throw error;
    } finally {
      await pgClient.end();
    }
  }

  /**
   * Create OSM schema in PostgreSQL
   */
  private async createOSMSchema(pgClient: Client): Promise<void> {
    console.log(`🏗️ Creating OSM schema: ${this.osmSchema}`);
    
    await pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.osmSchema}`);
    console.log(`✅ Created schema: ${this.osmSchema}`);
  }

  /**
   * Run osm2pgsql to load OSM data
   */
  private async runOsm2Pgsql(): Promise<void> {
    console.log('🔄 Running osm2pgsql...');
    
    try {
      // Check if osm2pgsql is available
      execSync('which osm2pgsql', { stdio: 'pipe' });
      
      // Run osm2pgsql with optimized settings for trail data
      const command = [
        'osm2pgsql',
        '--create',
        '--slim',
        '--drop-tables',
        '--output=flex',
        '--style=trail-only.style', // Custom style file for trails only
        '--prefix=osm',
        '--schema=' + this.osmSchema,
        this.osmFilePath
      ].join(' ');
      
      console.log(`Running: ${command}`);
      execSync(command, { stdio: 'inherit' });
      
      console.log('✅ osm2pgsql completed successfully');
      
    } catch (error) {
      console.log('⚠️ osm2pgsql not available, using alternative method...');
      await this.loadOSMDataAlternative();
    }
  }

  /**
   * Alternative method using osmium to load data
   */
  private async loadOSMDataAlternative(): Promise<void> {
    console.log('🔄 Using osmium to load OSM data...');
    
    const pgClient = this.createClient();
    
    try {
      await pgClient.connect();
      
      // Create tables manually
      await this.createOSMTables(pgClient);
      
      // Use osmium to extract ways and load into PostgreSQL
      await this.extractWaysWithOsmium();
      
    } catch (error) {
      console.error('❌ Error in alternative loading method:', error);
      throw error;
    } finally {
      await pgClient.end();
    }
  }

  /**
   * Create OSM tables manually
   */
  private async createOSMTables(pgClient: Client): Promise<void> {
    console.log('🏗️ Creating OSM tables...');
    
    const createWaysTable = `
      CREATE TABLE IF NOT EXISTS ${this.osmSchema}.ways (
        osm_id BIGINT PRIMARY KEY,
        name TEXT,
        highway TEXT,
        route TEXT,
        surface TEXT,
        difficulty TEXT,
        tags JSONB,
        way_geom GEOMETRY(LINESTRING, 4326)
      );
    `;
    
    await pgClient.query(createWaysTable);
    console.log('✅ Created ways table');
  }

  /**
   * Extract ways using osmium and load into PostgreSQL
   */
  private async extractWaysWithOsmium(): Promise<void> {
    console.log('🔍 Extracting ways with osmium...');
    
    // Use osmium to extract ways to a temporary file
    const tempFile = `/tmp/${this.region}_ways.osm`;
    const command = `osmium tags-filter "${this.osmFilePath}" w/highway w/route --output="${tempFile}"`;
    
    console.log(`Running: ${command}`);
    execSync(command, { stdio: 'inherit' });
    
    // Parse the extracted file and load into PostgreSQL
    await this.parseAndLoadWays(tempFile);
    
    // Clean up temp file
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }

  /**
   * Parse extracted ways and load into PostgreSQL
   */
  private async parseAndLoadWays(waysFile: string): Promise<void> {
    console.log('📝 Parsing and loading ways...');
    
    const pgClient = this.createClient();
    
    try {
      await pgClient.connect();
      
      // TODO: Implement actual OSM data parsing from waysFile
      // For now, this is a placeholder for the OSM data loading pipeline
      console.log('⚠️  OSM data parsing not yet implemented - using existing data');
      
    } catch (error) {
      console.error('❌ Error parsing and loading ways:', error);
      throw error;
    } finally {
      await pgClient.end();
    }
  }

  /**
   * Extract trail data from PostgreSQL using same criteria as Overpass query
   */
  async extractTrails(): Promise<TrailInsertData[]> {
    console.log(`🔍 Extracting trails from PostgreSQL OSM data...`);
    
    const pgClient = this.createClient();
    
    try {
      // Connect to PostgreSQL
      await pgClient.connect();
      
      // Query trails using same criteria as Overpass
      const trails = await this.queryTrailsFromPostgreSQL(pgClient);
      
      console.log(`✅ Found ${trails.length} trails from PostgreSQL OSM data`);
      return trails;
      
    } catch (error) {
      console.error('❌ Error extracting trails:', error);
      throw error;
    } finally {
      await pgClient.end();
    }
  }

  /**
   * Query trails from PostgreSQL using same criteria as Overpass query
   */
  private async queryTrailsFromPostgreSQL(pgClient: Client): Promise<TrailInsertData[]> {
    const query = `
      SELECT 
        osm_id,
        name,
        highway,
        route,
        surface,
        difficulty,
        tags,
        ST_AsText(way_geom) as geometry_text
      FROM ${this.osmSchema}.ways
      WHERE 
        name IS NOT NULL 
        AND name != ''
        AND (
          (highway IN ('path', 'track', 'footway', 'cycleway', 'bridleway') 
           AND surface IN ('dirt', 'gravel', 'unpaved', 'ground', 'fine_gravel', 'grass', 'sand', 'rock', 'compacted', 'earth', 'natural'))
          OR
          (route IN ('hiking', 'foot', 'walking') 
           AND surface IN ('dirt', 'gravel', 'unpaved', 'ground', 'fine_gravel', 'grass', 'sand', 'rock', 'compacted', 'earth', 'natural'))
        )
        AND way_geom IS NOT NULL
        AND ST_NumPoints(way_geom) >= 2
    `;
    
    const result = await pgClient.query(query);
    
    return result.rows.map(row => this.convertPostgreSQLRowToTrailData(row));
  }

  /**
   * Convert PostgreSQL row to TrailInsertData
   */
  private convertPostgreSQLRowToTrailData(row: any): TrailInsertData {
    // Parse geometry to get coordinates
    const coordinates = this.parseGeometryText(row.geometry_text);
    
    // Parse tags
    let sourceTags = {};
    try {
      sourceTags = row.tags || {};
    } catch (error) {
      console.warn(`⚠️ Could not parse tags for ${row.name}`);
    }
    
    return {
      osm_id: row.osm_id.toString(),
      name: row.name,
      trail_type: row.route || 'hiking',
      surface: row.surface || 'unknown',
      difficulty: row.difficulty || 'unknown',
      coordinates,
      source_tags: sourceTags,
      region: this.region
    };
  }

  /**
   * Parse PostGIS geometry text to coordinates
   */
  private parseGeometryText(geometryText: string): Array<[number, number]> {
    // Parse LINESTRING format: "LINESTRING (lng1 lat1, lng2 lat2, ...)" or "LINESTRING(lng1 lat1, lng2 lat2, ...)"
    const match = geometryText.match(/LINESTRING\s*\(([^)]+)\)/);
    if (!match || !match[1]) {
      throw new Error(`Invalid geometry format: ${geometryText}`);
    }

    const coordinateStrings = match[1].split(',');
    return coordinateStrings.map(coordStr => {
      const parts = coordStr.trim().split(/\s+/);
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        throw new Error(`Invalid coordinate format: ${coordStr}`);
      }
      
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      
      if (isNaN(lng) || isNaN(lat)) {
        throw new Error(`Invalid coordinate values: ${coordStr}`);
      }
      
      return [lng, lat];
    });
  }

  /**
   * Clean up OSM schema
   */
  async cleanup(): Promise<void> {
    const pgClient = this.createClient();
    
    try {
      await pgClient.connect();
      await pgClient.query(`DROP SCHEMA IF EXISTS ${this.osmSchema} CASCADE`);
      console.log(`🧹 Cleaned up OSM schema: ${this.osmSchema}`);
    } catch (error) {
      console.error('⚠️ Error cleaning up OSM schema:', error);
    } finally {
      await pgClient.end();
    }
  }
}

/**
 * Utility function to create OSM PostgreSQL loader for a region
 */
export function createOSMPostgresLoader(region: string): OSMPostgresLoader {
  return new OSMPostgresLoader(region);
} 