#!/usr/bin/env ts-node

import { Client } from 'pg';
import { AtomicTrailInserter } from './carthorse-postgres-atomic-insert';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface ElevationStats {
  total_trails: number;
  trails_with_elevation: number;
  trails_missing_elevation: number;
}

class ElevationProcessor {
  private pgClient: Client;
  private atomicInserter: AtomicTrailInserter;
  private region: string;

  constructor(region: string) {
    this.region = region;
    this.pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'postgres',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });
    
    this.atomicInserter = new AtomicTrailInserter(process.env.PGDATABASE || 'postgres');
  }

  async connect(): Promise<void> {
    await this.pgClient.connect();
    await this.atomicInserter.connect();
    console.log('✅ Connected to PostgreSQL');
  }

  async disconnect(): Promise<void> {
    await this.pgClient.end();
    await this.atomicInserter.disconnect();
    console.log('🔒 Disconnected from PostgreSQL');
  }

  async getElevationStats(): Promise<ElevationStats> {
    const result = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN elevation_gain > 0 THEN 1 END) as trails_with_elevation,
        COUNT(CASE WHEN elevation_gain IS NULL OR elevation_gain = 0 THEN 1 END) as trails_missing_elevation
      FROM trails 
      WHERE region = $1
    `, [this.region]);
    
    return result.rows[0];
  }

  async processMissingElevation(): Promise<void> {
    console.log(`🚀 Processing missing elevation data for region: ${this.region}`);
    
    // Get current stats
    const stats = await this.getElevationStats();
    console.log(`📊 Current elevation coverage:`);
    console.log(`   Total trails: ${stats.total_trails}`);
    console.log(`   With elevation: ${stats.trails_with_elevation} (${(stats.trails_with_elevation/stats.total_trails*100).toFixed(1)}%)`);
    console.log(`   Missing elevation: ${stats.trails_missing_elevation} (${(stats.trails_missing_elevation/stats.total_trails*100).toFixed(1)}%)`);
    
    if (stats.trails_missing_elevation === 0) {
      console.log('✅ All trails already have elevation data!');
      return;
    }

    // Get trails missing elevation
    const result = await this.pgClient.query(`
      SELECT id, osm_id, name, ST_AsText(geometry) as geometry_text
      FROM trails 
      WHERE region = $1 
        AND (elevation_gain IS NULL OR elevation_gain = 0)
      ORDER BY id
    `, [this.region]);

    const trails = result.rows;
    console.log(`🎯 Processing ${trails.length} trails with missing elevation...`);

    let processed = 0;
    let updated = 0;
    let failed = 0;

    for (const trail of trails) {
      try {
        processed++;
        
        if (processed % 50 === 0) {
          console.log(`⏳ Progress: ${processed}/${trails.length} trails processed`);
        }

        // Parse geometry to coordinates
        const coordinates = this.parseGeometryText(trail.geometry_text);
        if (coordinates.length === 0) {
          console.log(`⚠️ Skipping trail ${trail.name}: No valid geometry`);
          failed++;
          continue;
        }

        // Calculate elevation using atomic inserter
        const elevationData = await this.atomicInserter.processTrailElevation(coordinates);

        // Build 3D LINESTRING Z WKT
        const coordinates3D = coordinates.map((coord, i) => {
          // Use the filled elevation if available, otherwise fallback to 0
          const elevation = elevationData.elevations[i] ?? 0;
          return `${coord[0]} ${coord[1]} ${elevation}`;
        });
        const linestring3D = `LINESTRING Z (${coordinates3D.join(', ')})`;

        // Update trail with elevation data and 3D geometry
        await this.pgClient.query(`
          UPDATE trails 
          SET 
            elevation_gain = $1,
            elevation_loss = $2,
            max_elevation = $3,
            min_elevation = $4,
            avg_elevation = $5,
            geometry = ST_GeomFromText($6, 4326),
            updated_at = NOW()
          WHERE id = $7
        `, [
          elevationData.elevation_gain,
          elevationData.elevation_loss,
          elevationData.max_elevation,
          elevationData.min_elevation,
          elevationData.avg_elevation,
          linestring3D,
          trail.id
        ]);

        updated++;
        
      } catch (error) {
        console.error(`❌ Error processing trail ${trail.name}:`, error.message);
        failed++;
      }
    }

    console.log(`\n📊 Elevation processing complete:`);
    console.log(`   - Processed: ${processed} trails`);
    console.log(`   - Updated: ${updated} trails`);
    console.log(`   - Failed: ${failed} trails`);

    // Show final stats
    const finalStats = await this.getElevationStats();
    console.log(`\n📈 Final elevation coverage:`);
    console.log(`   Total trails: ${finalStats.total_trails}`);
    console.log(`   With elevation: ${finalStats.trails_with_elevation} (${(finalStats.trails_with_elevation/finalStats.total_trails*100).toFixed(1)}%)`);
    console.log(`   Missing elevation: ${finalStats.trails_missing_elevation} (${(finalStats.trails_missing_elevation/finalStats.total_trails*100).toFixed(1)}%)`);
  }

  private parseGeometryText(geometryText: string): number[][] {
    // Parse PostGIS LINESTRING or LINESTRING Z format: "LINESTRING(lng1 lat1, lng2 lat2, ...)" or "LINESTRING Z(lng1 lat1 z1, lng2 lat2 z2, ...)"
    const match = geometryText.match(/LINESTRING Z?\(([^)]+)\)/);
    if (!match) {
      return [];
    }
    
    const coordPairs = match[1].split(',').map(pair => pair.trim());
    return coordPairs.map(pair => {
      const coords = pair.split(' ').map(Number);
      // Return [lng, lat] - ignore Z coordinate for elevation processing
      return [coords[0], coords[1]];
    });
  }
}

async function main() {
  const region = process.argv[2] || 'boulder';
  
  if (!region) {
    console.error('❌ Please specify a region: node carthorse-elevation-processor.ts <region>');
    process.exit(1);
  }

  const processor = new ElevationProcessor(region);
  
  try {
    await processor.connect();
    await processor.processMissingElevation();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await processor.disconnect();
  }
}

if (require.main === module) {
  main();
} 