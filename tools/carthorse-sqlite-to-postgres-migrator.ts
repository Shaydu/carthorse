#!/usr/bin/env ts-node

import { Client } from 'pg';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

interface SQLiteTrail {
  id: number;
  app_uuid: string;
  osm_id: string;
  source: string;
  name: string;
  trail_type: string;
  surface: string;
  difficulty: string;
  elevation_gain: number;
  max_elevation: number;
  min_elevation: number;
  avg_elevation: number;
  length_km: number;
  source_tags: string;
  created_at: number;
  updated_at: number;
  bbox_min_lng: number;
  bbox_max_lng: number;
  bbox_min_lat: number;
  bbox_max_lat: number;
  geometry: Buffer;
  elevation_loss: number;
}

interface SQLiteElevationPoint {
  id: number;
  lat: number;
  lng: number;
  elevation: number;
  source_file: string;
  created_at: number;
}

class SQLiteToPostgresMigrator {
  private sqliteDb: Database.Database;
  private postgresClient: Client;
  private region: string;

  constructor(sqlitePath: string, region: string) {
    this.sqliteDb = new Database(sqlitePath);
    this.region = region;
    
    this.postgresClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });
  }

  async connect(): Promise<void> {
    await this.postgresClient.connect();
    console.log('✅ Connected to PostgreSQL master database');
  }

  async disconnect(): Promise<void> {
    this.sqliteDb.close();
    await this.postgresClient.end();
    console.log('🔒 Disconnected from databases');
  }

  async migrateTrails(): Promise<void> {
    console.log(`🔄 Migrating trails from SQLite to PostgreSQL for region: ${this.region}`);
    
    const trails = this.sqliteDb.prepare(`
      SELECT * FROM trails 
      WHERE bbox_min_lat >= ? AND bbox_max_lat <= ? 
      AND bbox_min_lng >= ? AND bbox_max_lng <= ?
    `).all(
      this.getRegionBounds().minLat,
      this.getRegionBounds().maxLat,
      this.getRegionBounds().minLng,
      this.getRegionBounds().maxLng
    ) as SQLiteTrail[];

    console.log(`📊 Found ${trails.length} trails in region ${this.region}`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const trail of trails) {
      try {
        // Check if trail already exists in PostgreSQL
        const existing = await this.postgresClient.query(
          'SELECT app_uuid FROM trails WHERE app_uuid = $1',
          [trail.app_uuid]
        );

        if (existing.rows.length > 0) {
          console.log(`⏭️  Skipping duplicate: ${trail.name} (${trail.osm_id})`);
          skipped++;
          continue;
        }

        // Convert SpatiaLite geometry to PostGIS
        const geometry = this.convertSpatiaLiteToPostGIS(trail.geometry);
        
        if (!geometry) {
          console.log(`⚠️  Skipping trail with invalid geometry: ${trail.name}`);
          skipped++;
          continue;
        }

        // Insert into PostgreSQL
        await this.postgresClient.query(`
          INSERT INTO trails (
            app_uuid, osm_id, source, name, trail_type, surface, difficulty,
            elevation_gain, max_elevation, min_elevation, avg_elevation,
            length_km, source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            geometry, elevation_loss, region
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, ST_GeomFromWKB($18, 4326), $19, $20)
        `, [
          trail.app_uuid,
          trail.osm_id,
          trail.source,
          trail.name,
          trail.trail_type,
          trail.surface,
          trail.difficulty,
          trail.elevation_gain,
          trail.max_elevation,
          trail.min_elevation,
          trail.avg_elevation,
          trail.length_km,
          trail.source_tags,
          trail.bbox_min_lng,
          trail.bbox_max_lng,
          trail.bbox_min_lat,
          trail.bbox_max_lat,
          geometry,
          trail.elevation_loss,
          this.region
        ]);

        migrated++;
        
        if (migrated % 100 === 0) {
          console.log(`📈 Progress: ${migrated}/${trails.length} trails migrated`);
        }

      } catch (error) {
        console.error(`❌ Error migrating trail ${trail.name}:`, error);
        errors++;
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`📊 Summary:`);
    console.log(`   - Migrated: ${migrated} trails`);
    console.log(`   - Skipped: ${skipped} trails`);
    console.log(`   - Errors: ${errors} trails`);
    console.log(`   - Region: ${this.region}`);
  }

  private convertSpatiaLiteToPostGIS(spatiaLiteGeometry: Buffer): Buffer | null {
    try {
      // SpatiaLite and PostGIS both use WKB format, but we need to ensure compatibility
      // For now, we'll use the raw buffer and let PostGIS handle it
      return spatiaLiteGeometry;
    } catch (error) {
      console.error('Error converting geometry:', error);
      return null;
    }
  }

  private getRegionBounds() {
    const bounds = {
      boulder: {
        minLat: 39.78208,
        maxLat: 40.52739,
        minLng: -105.67025,
        maxLng: -105.16744
      },
      seattle: {
        minLat: 47.5,
        maxLat: 47.8,
        minLng: -122.5,
        maxLng: -122.2
      }
    };
    
    return bounds[this.region as keyof typeof bounds] || bounds.boulder;
  }

  async migrateElevationPoints(): Promise<void> {
    console.log('🗻 Migrating elevation points...');
    
    const points = this.sqliteDb.prepare('SELECT * FROM elevation_points').all() as SQLiteElevationPoint[];
    console.log(`📊 Found ${points.length} elevation points`);

    let migrated = 0;
    let skipped = 0;

    for (const point of points) {
      try {
        // Check if point already exists
        const existing = await this.postgresClient.query(
          'SELECT id FROM elevation_points WHERE lat = $1 AND lng = $2',
          [point.lat, point.lng]
        );

        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        // Insert into PostgreSQL
        await this.postgresClient.query(`
          INSERT INTO elevation_points (lat, lng, elevation, source_file, created_at)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          point.lat,
          point.lng,
          point.elevation,
          point.source_file,
          point.created_at ? new Date(point.created_at * 1000) : new Date() // Convert Unix timestamp or use current date
        ]);

        migrated++;
        
        if (migrated % 1000 === 0) {
          console.log(`📈 Progress: ${migrated}/${points.length} elevation points migrated`);
        }

      } catch (error) {
        console.error(`❌ Error migrating elevation point:`, error);
      }
    }

    console.log(`✅ Elevation points migration complete: ${migrated} migrated, ${skipped} skipped`);
  }

  async showPostgresStats(): Promise<void> {
    try {
      const stats = await this.postgresClient.query('SELECT * FROM calculate_trail_stats()');
      const row = stats.rows[0];
      
      console.log(`\n📊 PostgreSQL Database Statistics:`);
      console.log(`   - Total trails: ${row.total_trails}`);
      console.log(`   - Total length: ${row.total_length_km.toFixed(1)} km`);
      console.log(`   - Avg elevation gain: ${row.avg_elevation_gain.toFixed(0)} m`);
      console.log(`   - Regions: ${row.regions_count}`);
      
      // Show trails by region
      const regionStats = await this.postgresClient.query(`
        SELECT region, COUNT(*) as count, 
               SUM(length_km) as total_length,
               AVG(elevation_gain) as avg_gain
        FROM trails 
        GROUP BY region 
        ORDER BY count DESC
      `);
      
      console.log(`\n🗺️ Trails by Region:`);
      for (const row of regionStats.rows) {
        console.log(`   - ${row.region}: ${row.count} trails, ${row.total_length.toFixed(1)} km, ${row.avg_gain.toFixed(0)}m avg gain`);
      }
      
    } catch (error) {
      console.error('❌ Failed to get PostgreSQL stats:', error);
    }
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  
  const sqlitePath = args.find(arg => arg.startsWith('--sqlite='))?.split('=')[1];
  const region = args.find(arg => arg.startsWith('--region='))?.split('=')[1] || 'boulder';
  
  if (!sqlitePath) {
    console.error('❌ Please specify SQLite database path: --sqlite=path/to/database.db');
    process.exit(1);
  }
  
  if (!fs.existsSync(sqlitePath)) {
    console.error(`❌ SQLite database not found: ${sqlitePath}`);
    process.exit(1);
  }
  
  const migrator = new SQLiteToPostgresMigrator(sqlitePath, region);
  
  try {
    await migrator.connect();
    await migrator.migrateTrails();
    await migrator.migrateElevationPoints();
    await migrator.showPostgresStats();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrator.disconnect();
  }
}

if (require.main === module) {
  main();
}

export { SQLiteToPostgresMigrator }; 