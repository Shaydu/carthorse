#!/usr/bin/env node
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';
import { AtomicTrailInserter } from '../tools/carthorse-postgres-atomic-insert';

interface MigrationResult {
  totalTrails: number;
  processed: number;
  inserted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

class CotrexToPublicTrails {
  private pgClient: Pool;
  private atomicInserter: AtomicTrailInserter;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
    this.atomicInserter = new AtomicTrailInserter('trail_master_db');
  }

  async migrateCotrexToPublic(): Promise<MigrationResult> {
    console.log('🏔️ Migrating CPW trails to public.trails with elevation data...');
    
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
      
      // Test table access
      const tableTest = await this.pgClient.query("SELECT COUNT(*) FROM public.cotrex_trails LIMIT 1;");
      console.log(`🔍 Table access test: ${tableTest.rows[0].count} records found in public.cotrex_trails`);
      
      // Connect to atomic inserter for TIFF processing
      await this.atomicInserter.connect();
      console.log('✅ Connected to elevation processing system');

      // TIFF files are loaded automatically during connect()
      console.log('📊 TIFF elevation data loaded');

      // Get all CPW trails
      const cotrexTrails = await this.getCotrexTrails();
      result.totalTrails = cotrexTrails.length;
      
      console.log(`📊 Found ${result.totalTrails} CPW trails to migrate`);

      if (result.totalTrails === 0) {
        console.log('✅ No CPW trails found to migrate!');
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

  private async getCotrexTrails(): Promise<any[]> {
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

      // Calculate elevation using atomic inserter
      const elevationData = await this.atomicInserter.processTrailElevation(coordinates);

      // Build 3D LINESTRING Z WKT with actual elevation data
      const coordinates3D = coordinates.map((coord, i) => {
        const elevation = elevationData.elevations[i] !== undefined ? elevationData.elevations[i] : 0;
        return `${coord[0]} ${coord[1]} ${elevation}`;
      });
      const linestring3D = `LINESTRING Z (${coordinates3D.join(', ')})`;

      // Generate UUID for the trail
      const uuid = this.generateUUID();

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
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, ST_GeomFromText($10, 4326), $11, $12, $13, $14, $15, $16, $17, $18
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
        // Return [lng, lat] - we'll get elevation from TIFFs
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

  private async generateSummary(result: MigrationResult): Promise<void> {
    console.log('\n📊 Migration Summary:');
    console.log('====================');
    console.log(`Total CPW trails: ${result.totalTrails}`);
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
    console.log(`Boulder region trails: ${stats.boulder_trails}`);
    console.log(`With elevation data: ${stats.with_elevation}`);
    console.log(`With 3D geometry: ${stats.with_3d_geometry}`);

    // Show sample of newly inserted trails
    const sampleQuery = `
      SELECT name, osm_id, region, tags->>'trail_type' as trail_type, length_km, elevation_gain
      FROM public.trails 
      WHERE tags->>'source' = 'cotrex'
      ORDER BY created_at DESC
      LIMIT 5;
    `;

    const sampleResult = await this.pgClient.query(sampleQuery);
    
    console.log('\n📋 Sample of newly inserted CPW trails:');
    console.log('=======================================');
    sampleResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.name} (${row.osm_id})`);
      console.log(`   Type: ${row.trail_type}, Length: ${row.length_km?.toFixed(2)} km`);
      console.log(`   Elevation gain: ${row.elevation_gain || 'N/A'} ft`);
    });

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.slice(0, 10).forEach(error => console.log(`  - ${error}`));
      if (result.errors.length > 10) {
        console.log(`  ... and ${result.errors.length - 10} more errors`);
      }
    }
  }

  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

async function main(): Promise<void> {
  console.log('🏔️ CPW to Public Trails Migration Tool');
  console.log('======================================\n');
  
  const migrator = new CotrexToPublicTrails();
  
  try {
    const result = await migrator.migrateCotrexToPublic();
    console.log('\n✅ Migration complete!');
    console.log(`📊 Final results: ${result.inserted} inserted, ${result.skipped} skipped, ${result.failed} failed, ${result.errors.length} errors`);
  } finally {
    await migrator.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
