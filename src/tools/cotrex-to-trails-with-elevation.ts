#!/usr/bin/env ts-node
/**
 * COTREX to Trails Migration with Elevation Processing
 * 
 * This script migrates data from public.cotrex_trails to public.trails format,
 * using the AtomicTrailInserter to process elevation data and converting
 * length_miles to length_km.
 * 
 * Usage:
 *   npx ts-node src/tools/cotrex-to-trails-with-elevation.ts
 */

import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { AtomicTrailInserter } from './carthorse-postgres-atomic-insert';

// Load environment variables
dotenv.config();

interface CotrexTrail {
  id: number;
  cpw_objectid: number;
  name: string;
  trail_type: string;
  length_miles: number;
  difficulty: string;
  surface_type: string;
  geometry_text: string;
  created_at: Date;
  updated_at: Date;
}

interface MigrationResult {
  totalTrails: number;
  processed: number;
  inserted: number;
  skipped: number;
  failed: number;
  missingElevation: number;
  errors: string[];
  missingElevationTrails: string[];
}

class CotrexToTrailsWithElevation {
  private pgClient: Client;
  private atomicInserter: AtomicTrailInserter;
  private useElevation: boolean;

  constructor() {
    this.pgClient = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'trail_master_db',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });
    
    // Initialize AtomicTrailInserter with fallback elevation sources enabled
    this.atomicInserter = new AtomicTrailInserter(process.env.PGDATABASE || 'trail_master_db', true);
    this.useElevation = process.env.USE_ELEVATION !== 'false'; // Default to true unless explicitly disabled
  }

  async run(): Promise<void> {
    console.log('🚀 Starting COTREX to Trails migration with elevation processing');
    console.log('=' .repeat(60));
    console.log(`🗻 Elevation processing: ${this.useElevation ? 'ENABLED' : 'DISABLED'}`);

    try {
      await this.pgClient.connect();
      console.log('✅ Connected to PostgreSQL database');

      // Only connect to AtomicTrailInserter if we're using elevation
      if (this.useElevation) {
        await this.atomicInserter.connect();
        console.log('✅ Connected to AtomicTrailInserter');

        // Load TIFF files for elevation data
        try {
          await this.atomicInserter.loadTiffFiles();
          console.log('✅ Loaded elevation TIFF files');
        } catch (error) {
          console.warn('⚠️ Could not load TIFF files, elevation processing may be limited');
          console.warn('   Error:', error instanceof Error ? error.message : String(error));
        }
      } else {
        console.log('⏭️ Skipping AtomicTrailInserter connection (elevation disabled)');
      }

      // Verify tables exist
      // await this.verifyTables();

      // Get all COTREX trails
      const cotrexTrails = await this.getCotrexTrails();
      console.log(`📊 Found ${cotrexTrails.length} trails in public.cotrex_trails`);

      if (cotrexTrails.length === 0) {
        console.log('⚠️ No trails found in public.cotrex_trails');
        return;
      }

      // Process trails in batches
      const batchSize = 50;
      const result: MigrationResult = {
        totalTrails: cotrexTrails.length,
        processed: 0,
        inserted: 0,
        skipped: 0,
        failed: 0,
        missingElevation: 0,
        errors: [],
        missingElevationTrails: []
      };

      for (let i = 0; i < cotrexTrails.length; i += batchSize) {
        const batch = cotrexTrails.slice(i, i + batchSize);
        console.log(`\n🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(cotrexTrails.length / batchSize)} (${batch.length} trails)`);
        
        const batchResult = await this.processBatch(batch);
        
        result.processed += batchResult.processed;
        result.inserted += batchResult.inserted;
        result.skipped += batchResult.skipped;
        result.failed += batchResult.failed;
        result.missingElevation += batchResult.missingElevation;
        result.errors.push(...batchResult.errors);
        result.missingElevationTrails.push(...batchResult.missingElevationTrails);
      }

      // Generate summary
      await this.generateSummary(result);

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    } finally {
      await this.pgClient.end();
      if (this.useElevation) {
        await this.atomicInserter.disconnect();
      }
    }
  }

  private async verifyTables(): Promise<void> {
    // Check if public.cotrex_trails exists
    const cotrexExists = await this.pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'cotrex_trails'
      )
    `);
    
    if (!cotrexExists.rows[0].exists) {
      throw new Error('public.cotrex_trails table does not exist');
    }

    // Check if public.trails exists
    const trailsExists = await this.pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'trails'
      )
    `);
    
    if (!trailsExists.rows[0].exists) {
      throw new Error('public.trails table does not exist');
    }

    console.log('✅ Verified required tables exist');
  }

  private async getCotrexTrails(): Promise<CotrexTrail[]> {
    // PROCESSING ALL BOULDER REGION TRAILS (excluding paved surfaces)
    console.log('🚀 Processing all Boulder region COTREX trails (excluding paved surfaces)');
    const query = `
      SELECT 
        id,
        cpw_objectid,
        name,
        trail_type,
        length_miles,
        difficulty,
        surface_type,
        ST_AsText(geometry) as geometry_text,
        created_at,
        updated_at
      FROM public.cotrex_trails
      WHERE surface_type NOT IN ('paved', 'asphalt', 'road', 'concrete')
        AND ST_Intersects(geometry, ST_MakeEnvelope(-105.810425, 39.743763, -105.13293, 40.69283, 4326))
      ORDER BY id
    `;

    const result = await this.pgClient.query(query);
    if (result.rows.length === 0) {
      throw new Error('No non-paved trails found in Boulder region');
    }
    return result.rows;
  }

  private async processBatch(trails: CotrexTrail[]): Promise<{ processed: number; inserted: number; skipped: number; failed: number; missingElevation: number; errors: string[]; missingElevationTrails: string[] }> {
    const result = { processed: 0, inserted: 0, skipped: 0, failed: 0, missingElevation: 0, errors: [] as string[], missingElevationTrails: [] as string[] };

    for (const trail of trails) {
      try {
        result.processed++;
        
        // Check if trail already exists in public.trails
        const exists = await this.checkTrailExists(trail);
        if (exists) {
          result.skipped++;
          continue;
        }

        const trailResult = await this.processTrail(trail);
        if (trailResult === 'inserted') {
          result.inserted++;
        } else if (trailResult === 'missing_elevation') {
          result.missingElevation++;
          result.missingElevationTrails.push(`ID: ${trail.id}, Name: ${trail.name}, CPW_ObjectID: ${trail.cpw_objectid}`);
        } else {
          result.failed++;
        }
        
      } catch (error: any) {
        result.failed++;
        result.errors.push(`Error processing trail ${trail.id}: ${error.message || 'Unknown error'}`);
      }
    }

    return result;
  }

  private async checkTrailExists(trail: CotrexTrail): Promise<boolean> {
    // Check if a trail with the same COTREX OSM ID already exists
    const query = `
      SELECT COUNT(*) 
      FROM public.trails 
      WHERE osm_id = $1 AND source = 'cotrex'
    `;
    
    const result = await this.pgClient.query(query, [
      `cotrex_${trail.cpw_objectid}`
    ]);
    
    return parseInt(result.rows[0].count) > 0;
  }

  private async processTrail(trail: CotrexTrail): Promise<'inserted' | 'missing_elevation' | 'failed'> {
    try {
      // Parse geometry to coordinates
      const coordinates = this.parseGeometryText(trail.geometry_text);
      if (coordinates.length === 0) {
        console.warn(`⚠️ No coordinates found for trail ${trail.id}`);
        return 'failed';
      }

      let elevationData: any;
      let linestring3D: string;

      if (this.useElevation) {
        try {
          // Calculate elevation using atomic inserter
          elevationData = await this.atomicInserter.processTrailElevation(coordinates);

          // Check if we have sufficient elevation data
          const validElevations = elevationData.elevations.filter((elev: any) => elev !== undefined && elev > 0);
          if (validElevations.length < coordinates.length * 0.5) {
            // Less than 50% of coordinates have valid elevation data
            console.warn(`⚠️ Insufficient elevation data for trail ${trail.id} (${validElevations.length}/${coordinates.length} valid points)`);
            return 'missing_elevation';
          }

          // Build 3D LINESTRING Z WKT with actual elevation data
          const coordinates3D = coordinates.map((coord, i) => {
            const elevation = elevationData.elevations[i] !== undefined ? elevationData.elevations[i] : 0;
            return `${coord[0]} ${coord[1]} ${elevation}`;
          });
          linestring3D = `LINESTRING Z (${coordinates3D.join(', ')})`;
        } catch (error: any) {
          console.warn(`⚠️ Elevation processing failed for trail ${trail.id}: ${error.message}`);
          return 'missing_elevation';
        }
      } else {
        // Use 2D geometry without elevation processing
        elevationData = {
          elevation_gain: 0,
          elevation_loss: 0,
          max_elevation: 1000, // Default reasonable elevation
          min_elevation: 1000, // Default reasonable elevation
          avg_elevation: 1000  // Default reasonable elevation
        };
        linestring3D = trail.geometry_text;
      }

      // Generate UUID for the trail
      const uuid = uuidv4();

      // Convert length_miles to length_km
      const length_km = (trail.length_miles || 0) * 1.60934;

      // Generate geometry hash
      const geometryHash = this.generateGeometryHash(linestring3D);

      // Insert into public.trails with COTREX data
      const insertQuery = `
        INSERT INTO public.trails (
          app_uuid,
          name,
          osm_id,
          source,
          region,
          trail_type,
          surface,
          difficulty,
          source_tags,
          geometry,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          geometry_hash,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, ST_GeomFromText($10, 4326), $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        ON CONFLICT (osm_id) DO NOTHING
      `;

      const values = [
        uuid,
        trail.name || 'Unknown COTREX Trail',
        `cotrex_${trail.cpw_objectid}`, // Use COTREX object ID as OSM ID
        'cotrex', // Set source to cotrex
        'boulder', // Set region to boulder
        trail.trail_type || 'unknown',
        trail.surface_type || 'unknown',
        trail.difficulty || 'unknown',
        JSON.stringify({
          cpw_objectid: trail.cpw_objectid,
          trail_type: trail.trail_type,
          difficulty: trail.difficulty,
          surface_type: trail.surface_type,
          length_miles: trail.length_miles
        }),
        linestring3D,
        length_km, // Converted from miles to km
        elevationData.elevation_gain,
        elevationData.elevation_loss,
        elevationData.max_elevation,
        elevationData.min_elevation,
        elevationData.avg_elevation,
        geometryHash,
        trail.created_at || new Date(),
        new Date()
      ];

      await this.pgClient.query(insertQuery, values);
      return 'inserted';
      
    } catch (error: any) {
      console.error(`❌ Error processing trail ${trail.id}:`, error.message);
      return 'failed';
    }
  }

  private parseGeometryText(geometryText: string): number[][] {
    try {
      // Parse LINESTRING Z format: "LINESTRING Z (x1 y1 z1, x2 y2 z2, ...)"
      const match = geometryText.match(/LINESTRING\s*Z?\s*\(([^)]+)\)/i);
      if (!match) {
        return [];
      }

      const coordPairs = match[1].split(',').map(pair => pair.trim());
      return coordPairs.map(pair => {
        const coords = pair.split(/\s+/).map(Number);
        // Return [lng, lat] - we'll get elevation from TIFFs
        return [coords[0], coords[1]];
      });
    } catch (error) {
      console.error('Error parsing geometry:', error);
      return [];
    }
  }

  private generateGeometryHash(geometryWkt: string): string {
    // Simple hash function for geometry - you might want to use a more sophisticated hash
    const crypto = require('crypto');
    return crypto.createHash('md5').update(geometryWkt).digest('hex');
  }

  private async generateSummary(result: MigrationResult): Promise<void> {
    console.log('\n📊 Migration Summary:');
    console.log('====================');
    console.log(`Total COTREX trails: ${result.totalTrails}`);
    console.log(`Processed: ${result.processed}`);
    console.log(`Successfully inserted: ${result.inserted}`);
    console.log(`Skipped (already exist): ${result.skipped}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Missing elevation data: ${result.missingElevation}`);
    console.log(`Errors: ${result.errors.length}`);

    // Get updated statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN source = 'cotrex' THEN 1 END) as cotrex_trails,
        COUNT(CASE WHEN region = 'boulder' THEN 1 END) as boulder_trails,
        AVG(length_km) as avg_length_km,
        AVG(elevation_gain) as avg_elevation_gain,
        AVG(elevation_loss) as avg_elevation_loss
      FROM public.trails
    `;
    
    const stats = await this.pgClient.query(statsQuery);
    const trailStats = stats.rows[0];
    
    console.log('\n📈 Database Statistics:');
    console.log('======================');
    console.log(`Total trails: ${trailStats.total_trails}`);
    console.log(`COTREX trails: ${trailStats.cotrex_trails}`);
    console.log(`Boulder trails: ${trailStats.boulder_trails}`);
    console.log(`Average length: ${parseFloat(trailStats.avg_length_km).toFixed(2)} km`);
    console.log(`Average elevation gain: ${parseFloat(trailStats.avg_elevation_gain).toFixed(1)} m`);
    console.log(`Average elevation loss: ${parseFloat(trailStats.avg_elevation_loss).toFixed(1)} m`);

    if (result.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      console.log('=====================');
      result.errors.slice(0, 10).forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
      if (result.errors.length > 10) {
        console.log(`... and ${result.errors.length - 10} more errors`);
      }
    }

    // Write missing elevation trails to log file
    if (result.missingElevationTrails.length > 0) {
      const fs = require('fs');
      const logContent = `# COTREX Trails Missing Elevation Data\n# Generated: ${new Date().toISOString()}\n# Total trails with missing elevation: ${result.missingElevationTrails.length}\n\n${result.missingElevationTrails.join('\n')}\n`;
      
      fs.writeFileSync('cotrex-missing-elevation-data.log', logContent);
      console.log(`\n📝 Missing elevation trails logged to: cotrex-missing-elevation-data.log`);
      console.log(`   Total trails with missing elevation: ${result.missingElevationTrails.length}`);
    }
  }
}

// Run the migration
if (require.main === module) {
  const migrator = new CotrexToTrailsWithElevation();
  migrator.run()
    .then(() => {
      console.log('✅ Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}
