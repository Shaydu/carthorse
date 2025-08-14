#!/usr/bin/env node
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';
import { AtomicTrailInserter } from '../inserters/AtomicTrailInserter';

interface ElevationResult {
  totalTrails: number;
  processed: number;
  updated: number;
  failed: number;
  errors: string[];
}

class CotrexElevationProcessor {
  private pgClient: Pool;
  private atomicInserter: AtomicTrailInserter;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
    this.atomicInserter = new AtomicTrailInserter(process.env.PGDATABASE || 'trail_master_db');
  }

  async addElevationToCotrexTrails(): Promise<ElevationResult> {
    console.log('🏔️ Adding elevation data to CPW trails...');
    
    const result: ElevationResult = {
      totalTrails: 0,
      processed: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    try {
      // Connect to atomic inserter for TIFF processing
      await this.atomicInserter.connect();
      console.log('✅ Connected to elevation processing system');

      // Load TIFF metadata
      await this.atomicInserter.loadTiffMetadata();
      console.log('📊 Loaded TIFF elevation data');

      // Get trails that need elevation data
      const trailsNeedingElevation = await this.getTrailsNeedingElevation();
      result.totalTrails = trailsNeedingElevation.length;
      
      console.log(`📊 Found ${result.totalTrails} trails that need elevation data`);

      if (result.totalTrails === 0) {
        console.log('✅ All CPW trails already have elevation data!');
        return result;
      }

      // Process trails in batches
      const batchSize = 50;
      for (let i = 0; i < trailsNeedingElevation.length; i += batchSize) {
        const batch = trailsNeedingElevation.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(trailsNeedingElevation.length / batchSize);
        
        console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} trails)...`);
        
        const batchResult = await this.processBatch(batch);
        result.processed += batchResult.processed;
        result.updated += batchResult.updated;
        result.failed += batchResult.failed;
        result.errors.push(...batchResult.errors);
        
        console.log(`   ✅ Batch complete: ${batchResult.updated} updated, ${batchResult.failed} failed`);
      }

      // Generate summary
      await this.generateSummary(result);

    } catch (error: any) {
      console.error('❌ Error processing elevation:', error.message);
      result.errors.push(error.message || 'Unknown error');
    } finally {
      await this.atomicInserter.disconnect();
    }

    return result;
  }

  private async getTrailsNeedingElevation(): Promise<any[]> {
    const query = `
      SELECT 
        id,
        cpw_objectid,
        name,
        ST_AsText(geometry) as geometry_text,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation
      FROM cotrex.trails
      WHERE elevation_gain IS NULL 
         OR elevation_loss IS NULL 
         OR max_elevation IS NULL 
         OR min_elevation IS NULL 
         OR avg_elevation IS NULL
         OR ST_NDims(geometry) < 3
      ORDER BY id
    `;

    const result = await this.pgClient.query(query);
    return result.rows;
  }

  private async processBatch(trails: any[]): Promise<{ processed: number; updated: number; failed: number; errors: string[] }> {
    const result = { processed: 0, updated: 0, failed: 0, errors: [] };

    for (const trail of trails) {
      try {
        result.processed++;
        
        const success = await this.processTrailElevation(trail);
        if (success) {
          result.updated++;
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

  private async processTrailElevation(trail: any): Promise<boolean> {
    try {
      // Parse geometry to coordinates
      const coordinates = this.parseGeometryText(trail.geometry_text);
      if (coordinates.length === 0) {
        console.warn(`⚠️ No coordinates found for trail ${trail.cpw_objectid}`);
        return false;
      }

      // Calculate elevation using atomic inserter
      const elevationData = await this.atomicInserter.processTrailElevation(coordinates);

      // Build 3D LINESTRING Z WKT
      const coordinates3D = coordinates.map((coord, i) => {
        const elevation = elevationData.elevations[i] !== undefined ? elevationData.elevations[i] : null;
        return elevation !== null ? `${coord[0]} ${coord[1]} ${elevation}` : `${coord[0]} ${coord[1]}`;
      });
      const linestring3D = `LINESTRING Z (${coordinates3D.join(', ')})`;

      // Update trail with elevation data and 3D geometry
      await this.pgClient.query(`
        UPDATE cotrex.trails 
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

      return true;
      
    } catch (error: any) {
      console.error(`❌ Error processing trail ${trail.cpw_objectid}:`, error.message);
      return false;
    }
  }

  private parseGeometryText(geometryText: string): number[][] {
    try {
      // Parse LINESTRING format: "LINESTRING (x1 y1, x2 y2, ...)"
      const match = geometryText.match(/LINESTRING\s*\(([^)]+)\)/i);
      if (!match) {
        return [];
      }

      const coordPairs = match[1].split(',').map(pair => pair.trim());
      return coordPairs.map(pair => {
        const [x, y] = pair.split(/\s+/).map(Number);
        return [x, y];
      });
    } catch (error) {
      console.error('Error parsing geometry:', error);
      return [];
    }
  }

  private async generateSummary(result: ElevationResult): Promise<void> {
    console.log('\n📊 Elevation Processing Summary:');
    console.log('===============================');
    console.log(`Total trails needing elevation: ${result.totalTrails}`);
    console.log(`Processed: ${result.processed}`);
    console.log(`Successfully updated: ${result.updated}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Errors: ${result.errors.length}`);

    // Get updated statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as with_elevation_gain,
        COUNT(CASE WHEN elevation_loss IS NOT NULL THEN 1 END) as with_elevation_loss,
        COUNT(CASE WHEN max_elevation IS NOT NULL THEN 1 END) as with_max_elevation,
        COUNT(CASE WHEN min_elevation IS NOT NULL THEN 1 END) as with_min_elevation,
        COUNT(CASE WHEN avg_elevation IS NOT NULL THEN 1 END) as with_avg_elevation,
        COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as with_3d_geometry,
        AVG(elevation_gain) as avg_elevation_gain,
        AVG(elevation_loss) as avg_elevation_loss,
        AVG(max_elevation) as avg_max_elevation,
        AVG(min_elevation) as avg_min_elevation
      FROM cotrex.trails;
    `;

    const statsResult = await this.pgClient.query(statsQuery);
    const stats = statsResult.rows[0];

    console.log('\n📈 Updated Database Statistics:');
    console.log(`Total trails: ${stats.total_trails}`);
    console.log(`With elevation gain: ${stats.with_elevation_gain} (${((stats.with_elevation_gain/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With elevation loss: ${stats.with_elevation_loss} (${((stats.with_elevation_loss/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With max elevation: ${stats.with_max_elevation} (${((stats.with_max_elevation/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With min elevation: ${stats.with_min_elevation} (${((stats.with_min_elevation/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With avg elevation: ${stats.with_avg_elevation} (${((stats.with_avg_elevation/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With 3D geometry: ${stats.with_3d_geometry} (${((stats.with_3d_geometry/stats.total_trails)*100).toFixed(1)}%)`);
    
    if (stats.avg_elevation_gain) {
      console.log(`\n📊 Average Elevation Data:`);
      console.log(`Average elevation gain: ${parseFloat(stats.avg_elevation_gain).toFixed(1)} ft`);
      console.log(`Average elevation loss: ${parseFloat(stats.avg_elevation_loss).toFixed(1)} ft`);
      console.log(`Average max elevation: ${parseFloat(stats.avg_max_elevation).toFixed(1)} ft`);
      console.log(`Average min elevation: ${parseFloat(stats.avg_min_elevation).toFixed(1)} ft`);
    }

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
  console.log('🏔️ CPW Trail Elevation Processor');
  console.log('================================\n');
  
  const processor = new CotrexElevationProcessor();
  
  try {
    const result = await processor.addElevationToCotrexTrails();
    console.log('\n✅ Elevation processing complete!');
    console.log(`📊 Final results: ${result.updated} updated, ${result.failed} failed, ${result.errors.length} errors`);
  } finally {
    await processor.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
