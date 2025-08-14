#!/usr/bin/env node
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';
import { AtomicTrailInserter } from './carthorse-postgres-atomic-insert';

interface MigrationResult {
  totalTrails: number;
  processed: number;
  inserted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

class CotrexToPublicTrailsBoulderOnly {
  private pgClient: Pool;
  private atomicInserter: AtomicTrailInserter;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
    this.atomicInserter = new AtomicTrailInserter('trail_master_db');
  }

  async migrateCotrexToPublic(): Promise<MigrationResult> {
    console.log('🏔️ Migrating Boulder-area CPW trails to public.trails...');
    
    const result: MigrationResult = {
      totalTrails: 0,
      processed: 0,
      inserted: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    try {
      // Test database connection
      const dbTest = await this.pgClient.query('SELECT current_database(), current_user, current_schema();');
      console.log(`🔍 Connected to database: ${dbTest.rows[0].current_database} as user: ${dbTest.rows[0].current_user} in schema: ${dbTest.rows[0].current_schema}`);
      
      // Connect to atomic inserter for TIFF processing
      await this.atomicInserter.connect();
      console.log('✅ Connected to elevation processing system');

      // Get Boulder-area CPW trails only
      const cotrexTrails = await this.getBoulderCotrexTrails();
      result.totalTrails = cotrexTrails.length;
      
      console.log(`📊 Found ${result.totalTrails} Boulder-area CPW trails to migrate`);

      if (result.totalTrails === 0) {
        console.log('✅ No Boulder-area CPW trails found to migrate!');
        return result;
      }

      // Process trails in batches
      const batchSize = 50;
      for (let i = 0; i < cotrexTrails.length; i += batchSize) {
        const batch = cotrexTrails.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(cotrexTrails.length / batchSize);
        
        console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} trails)...`);
        
        const batchResult = await this.processBatch(batch);
        result.processed += batchResult.processed;
        result.inserted += batchResult.inserted;
        result.skipped += batchResult.skipped;
        result.failed += batchResult.failed;
        result.errors.push(...batchResult.errors);
        
        console.log(`   ✅ Batch complete: ${batchResult.inserted} inserted, ${batchResult.skipped} skipped, ${batchResult.failed} failed`);
      }

      // Generate summary
      await this.generateSummary(result);

    } catch (error: any) {
      console.error('❌ Error during migration:', error.message);
      result.errors.push(error.message || 'Unknown error');
    } finally {
      await this.atomicInserter.disconnect();
    }

    return result;
  }

  private async getBoulderCotrexTrails(): Promise<any[]> {
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
        created_at
      FROM public.cotrex_trails
      WHERE ST_Intersects(geometry, ST_MakeEnvelope(-105.3, 39.9, -105.2, 40.1, 4326))
      ORDER BY id
    `;

    const result = await this.pgClient.query(query);
    return result.rows;
  }

  private async processBatch(trails: any[]): Promise<{ processed: number; inserted: number; skipped: number; failed: number; errors: string[] }> {
    const result: { processed: number; inserted: number; skipped: number; failed: number; errors: string[] } = { processed: 0, inserted: 0, skipped: 0, failed: 0, errors: [] };

    for (const trail of trails) {
      try {
        result.processed++;
        
        // Check if trail already exists in public.trails
        const exists = await this.checkTrailExists(trail);
        if (exists) {
          result.skipped++;
          continue;
        }

        const success = await this.processTrail(trail);
        if (success) {
          result.inserted++;
        } else {
          result.failed++;
        }
        
      } catch (error: any) {
        result.failed++;
        result.errors.push(`Error processing trail ${trail.cpw_objectid}: ${error.message || 'Unknown error'}`);
      }
    }

    return result;
  }

  private async checkTrailExists(trail: any): Promise<boolean> {
    // Check if a trail with similar name and location already exists
    const query = `
      SELECT COUNT(*) 
      FROM public.trails 
      WHERE name ILIKE $1 
        AND ST_DWithin(geometry, ST_GeomFromText($2, 4326), 100)
    `;
    
    const result = await this.pgClient.query(query, [
      `%${trail.name}%`,
      trail.geometry_text
    ]);
    
    return parseInt(result.rows[0].count) > 0;
  }

  private async processTrail(trail: any): Promise<boolean> {
    try {
      // Parse geometry to coordinates
      const coordinates = this.parseGeometryText(trail.geometry_text);
      if (coordinates.length === 0) {
        console.warn(`⚠️ No coordinates found for trail ${trail.cpw_objectid}`);
        return false;
      }

      // Calculate elevation using atomic inserter (TIFF lookup)
      const elevationData = await this.atomicInserter.processTrailElevation(coordinates);

      // Validate that we have at least some elevation data (will interpolate the rest)
      if (elevationData.elevations.filter(e => e !== undefined && e !== null && e > 0).length === 0) {
        console.warn(`⚠️ Skipping trail ${trail.cpw_objectid} - no valid elevation data found, will use default elevation`);
        // Use default elevation for all points
        elevationData.elevations = coordinates.map(() => 1600);
        elevationData.elevation_gain = 0;
        elevationData.elevation_loss = 0;
        elevationData.max_elevation = 1600;
        elevationData.min_elevation = 1600;
        elevationData.avg_elevation = 1600;
      }

      // Build 3D LINESTRING Z WKT with interpolated elevation data
      const coordinates3D = this.interpolateElevationData(coordinates, elevationData.elevations);
      const linestring3D = `LINESTRING Z (${coordinates3D.join(', ')})`;

      // Generate UUID for the trail
      const uuid = this.generateUUID();

      // Generate geometry hash
      const geometryHash = this.generateMD5Hash(linestring3D);

      // Insert into public.trails with CPW data
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
          geometry_hash,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, ST_GeomFromText($10, 4326), $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
      `;

      const values = [
        uuid,
        trail.name || 'Unknown CPW Trail',
        `cpw_${trail.cpw_objectid}`, // Use CPW object ID as OSM ID
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
        geometryHash,
        (trail.length_miles || 0) * 1.60934, // Convert miles to km
        elevationData.elevation_gain,
        elevationData.elevation_loss,
        elevationData.max_elevation,
        elevationData.min_elevation,
        elevationData.avg_elevation,
        trail.created_at || new Date(),
        new Date()
      ];

      await this.pgClient.query(insertQuery, values);
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error processing trail ${trail.cpw_objectid}:`, error.message);
      return false;
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
        // Return [lng, lat] - we'll get elevation from TIFFs later
        return [coords[0], coords[1]];
      });
    } catch (error) {
      console.error('Error parsing geometry:', error);
      return [];
    }
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private generateMD5Hash(text: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(text).digest('hex');
  }

  private interpolateElevationData(coordinates: number[][], elevations: number[]): string[] {
    const interpolatedCoordinates: string[] = [];
    
    for (let i = 0; i < coordinates.length; i++) {
      let elevation = elevations[i];
      
      // If elevation is missing, interpolate from nearby points
      if (elevation === undefined || elevation === null || elevation <= 0) {
        elevation = this.interpolateElevationFromNearby(coordinates, elevations, i);
      }
      
      const [lng, lat] = coordinates[i];
      interpolatedCoordinates.push(`${lng} ${lat} ${elevation}`);
    }
    
    return interpolatedCoordinates;
  }

  private interpolateElevationFromNearby(coordinates: number[][], elevations: number[], currentIndex: number): number {
    const currentCoord = coordinates[currentIndex];
    const validElevations: { distance: number; elevation: number }[] = [];
    
    // Find all valid elevations within a reasonable distance
    for (let i = 0; i < coordinates.length; i++) {
      if (i === currentIndex) continue;
      
      const elevation = elevations[i];
      if (elevation !== undefined && elevation !== null && elevation > 0) {
        const distance = this.calculateDistance(currentCoord, coordinates[i]);
        if (distance <= 1000) { // Within 1km
          validElevations.push({ distance, elevation });
        }
      }
    }
    
    if (validElevations.length === 0) {
      // No nearby valid elevations, use a default Boulder elevation
      return 1600;
    }
    
    // Sort by distance and use weighted average of closest points
    validElevations.sort((a, b) => a.distance - b.distance);
    
    // Use inverse distance weighting for interpolation
    const maxPoints = Math.min(5, validElevations.length);
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (let i = 0; i < maxPoints; i++) {
      const { distance, elevation } = validElevations[i];
      const weight = 1 / (distance + 1); // Add 1 to avoid division by zero
      totalWeight += weight;
      weightedSum += elevation * weight;
    }
    
    return Math.round(weightedSum / totalWeight);
  }

  private calculateDistance(coord1: number[], coord2: number[]): number {
    const [lng1, lat1] = coord1;
    const [lng2, lat2] = coord2;
    
    // Haversine formula for distance calculation
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
  }

  private async generateSummary(result: MigrationResult): Promise<void> {
    console.log('\n📊 Migration Summary:');
    console.log('====================');
    console.log(`Total Boulder CPW trails: ${result.totalTrails}`);
    console.log(`Processed: ${result.processed}`);
    console.log(`Successfully inserted: ${result.inserted}`);
    console.log(`Skipped (already exist): ${result.skipped}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Errors: ${result.errors.length}`);

    // Get updated statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN source = 'cotrex' THEN 1 END) as cotrex_trails,
        COUNT(CASE WHEN region = 'boulder' THEN 1 END) as boulder_trails,
        COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as with_elevation,
        COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as with_3d_geometry
      FROM public.trails;
    `;

    const statsResult = await this.pgClient.query(statsQuery);
    const stats = statsResult.rows[0];

    console.log('\n📈 Updated public.trails Statistics:');
    console.log(`Total trails: ${stats.total_trails}`);
    console.log(`CPW trails: ${stats.cotrex_trails}`);
    console.log(`Boulder trails: ${stats.boulder_trails}`);
    console.log(`Trails with elevation: ${stats.with_elevation}`);
    console.log(`Trails with 3D geometry: ${stats.with_3d_geometry}`);

    if (result.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      result.errors.slice(0, 10).forEach(error => console.log(`   - ${error}`));
      if (result.errors.length > 10) {
        console.log(`   ... and ${result.errors.length - 10} more errors`);
      }
    }
  }
}

// Main execution
async function main() {
  const migrator = new CotrexToPublicTrailsBoulderOnly();
  
  try {
    const result = await migrator.migrateCotrexToPublic();
    
    if (result.failed > 0) {
      console.error(`\n❌ Migration completed with ${result.failed} failures`);
      process.exit(1);
    } else {
      console.log(`\n✅ Migration completed successfully!`);
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
