#!/usr/bin/env ts-node

import { Client } from 'pg';
import { AtomicTrailInserter, TrailInsertData } from './carthorse-postgres-atomic-insert';
import * as dotenv from 'dotenv';
dotenv.config();

interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface OverpassTrail {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements: OverpassTrail[];
}

class BoulderAtomicInserter {
  private pgClient: Client;
  private atomicInserter: AtomicTrailInserter;

  constructor() {
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

  async getBoulderBbox(): Promise<BBox> {
    console.log('🗺️ Getting Boulder bbox from regions table...');
    
    const result = await this.pgClient.query(`
      SELECT bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      FROM regions 
      WHERE region_key = 'boulder'
    `);
    
    if (result.rows.length === 0) {
      throw new Error('Boulder region not found in regions table');
    }
    
    const bbox = result.rows[0];
    console.log(`✅ Boulder bbox: ${bbox.bbox_min_lng}, ${bbox.bbox_min_lat}, ${bbox.bbox_max_lng}, ${bbox.bbox_max_lat}`);
    
    return {
      minLng: bbox.bbox_min_lng,
      maxLng: bbox.bbox_max_lng,
      minLat: bbox.bbox_min_lat,
      maxLat: bbox.bbox_max_lat
    };
  }

  buildOverpassQuery(bbox: BBox): string {
    return `
[out:json][timeout:60];
(
  way["highway"~"^(path|track|footway|cycleway|bridleway)$"]["name"~"."]["surface"~"^(dirt|gravel|unpaved|ground|fine_gravel|grass|sand|rock|compacted|earth|natural)$"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
  way["route"~"^(hiking|foot|walking)$"]["name"~"."]["surface"~"^(dirt|gravel|unpaved|ground|fine_gravel|grass|sand|rock|compacted|earth|natural)$"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
);
out geom tags;
`;
  }

  async queryOverpass(bbox: BBox): Promise<OverpassTrail[]> {
    console.log('🌐 Querying Overpass API for Boulder trails...');
    
    const query = this.buildOverpassQuery(bbox);
    console.log('📝 Overpass query:', query);
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`
    });
    
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }
    
    const data: OverpassResponse = await response.json();
    console.log(`✅ Found ${data.elements.length} trails from Overpass API`);
    
    return data.elements;
  }

  convertOverpassTrailToInsertData(trail: OverpassTrail): TrailInsertData | null {
    if (!trail.geometry || trail.geometry.length < 2) {
      console.log(`⚠️ Skipping trail ${trail.id} - insufficient geometry`);
      return null;
    }
    
    if (!trail.tags?.name) {
      console.log(`⚠️ Skipping trail ${trail.id} - no name`);
      return null;
    }
    
    // Convert geometry to coordinates array
    const coordinates = trail.geometry.map(point => [point.lon, point.lat]);
    
    return {
      osm_id: trail.id.toString(),
      name: trail.tags.name,
      trail_type: trail.tags.route || 'hiking',
      surface: trail.tags.surface || 'unknown',
      difficulty: trail.tags.difficulty || 'unknown',
      coordinates,
      source_tags: trail.tags || {},
      region: 'boulder'
    };
  }

  async processBoulderTrails(): Promise<void> {
    console.log('🚀 Starting Boulder atomic insertion...');
    
    try {
      // Get Boulder bbox from regions table
      const bbox = await this.getBoulderBbox();
      
      // Query Overpass API
      const overpassTrails = await this.queryOverpass(bbox);
      
      // Convert and process trails
      let processed = 0;
      let inserted = 0;
      let skipped = 0;
      let failed = 0;
      
      for (const overpassTrail of overpassTrails) {
        processed++;
        
        try {
          const trailData = this.convertOverpassTrailToInsertData(overpassTrail);
          
          if (!trailData) {
            skipped++;
            continue;
          }
          
          console.log(`\n📍 Processing trail ${processed}/${overpassTrails.length}: ${trailData.name}`);
          
          const result = await this.atomicInserter.insertTrailAtomically(trailData);
          
          if (result.success) {
            inserted++;
            console.log(`✅ Inserted: ${trailData.name}`);
          } else {
            failed++;
            console.log(`❌ Failed: ${trailData.name} - ${result.error}`);
            if (result.validation_errors) {
              console.log(`   Validation errors: ${result.validation_errors.join(', ')}`);
            }
          }
          
        } catch (error) {
          failed++;
          console.error(`❌ Error processing trail: ${error}`);
        }
      }
      
      console.log(`\n📊 Boulder processing complete:`);
      console.log(`   - Processed: ${processed} trails`);
      console.log(`   - Inserted: ${inserted} trails`);
      console.log(`   - Skipped: ${skipped} trails`);
      console.log(`   - Failed: ${failed} trails`);
      
    } catch (error) {
      console.error('❌ Boulder processing failed:', error);
      throw error;
    }
  }
}

async function main() {
  const inserter = new BoulderAtomicInserter();
  
  try {
    await inserter.connect();
    await inserter.processBoulderTrails();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await inserter.disconnect();
  }
}

if (require.main === module) {
  main();
} 