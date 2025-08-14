import { Pool } from 'pg';
import { AtomicTrailInserter } from './carthorse-postgres-atomic-insert';

interface CotrexTrail {
  id: number;
  name: string;
  trail_type: string;
  surface_type: string;
  difficulty: string;
  geometry: string;
  length_miles: number;
}

class CotrexToPublicTrailsBoulderBbox {
  private pgClient: Pool;
  private atomicInserter: AtomicTrailInserter;

  constructor() {
    this.pgClient = new Pool({
      host: 'localhost',
      port: 5432,
      user: 'carthorse',
      password: '',
      database: 'trail_master_db',
    });

    this.atomicInserter = new AtomicTrailInserter('trail_master_db');
  }

  async run(): Promise<void> {
    console.log('🏔️ COTREX to Public Trails Migration (Boulder Bbox with Elevation)');
    console.log('==================================================================');

    try {
      // Connect to database
      await this.pgClient.connect();
      await this.atomicInserter.connect();
      console.log('✅ Connected to database');

      // Load TIFF files for elevation data
      await this.atomicInserter.loadTiffFiles();
      console.log('✅ Loaded TIFF files for elevation lookup');

      // Get Boulder bbox from public.trails
      const boulderBbox = await this.getBoulderBbox();
      console.log(`🗺️ Boulder bbox: ${boulderBbox.min_lng}, ${boulderBbox.min_lat}, ${boulderBbox.max_lng}, ${boulderBbox.max_lat}`);

      // Get COTREX trails within Boulder bbox
      const cotrexTrails = await this.getCotrexTrailsInBbox(boulderBbox);
      console.log(`📊 Found ${cotrexTrails.length} COTREX trails within Boulder bbox`);

      // Insert trails using AtomicTrailInserter
      let successCount = 0;
      let errorCount = 0;

      for (const trail of cotrexTrails) {
        try {
          const success = await this.insertTrailWithAtomicInserter(trail);
          if (success) {
            successCount++;
            if (successCount % 100 === 0) {
              console.log(`✅ Processed ${successCount} trails...`);
            }
          } else {
            errorCount++;
          }
        } catch (error) {
          console.error(`❌ Error processing trail ${trail.name}:`, error instanceof Error ? error.message : String(error));
          errorCount++;
        }
      }

      console.log(`\n🎯 Migration completed:`);
      console.log(`   ✅ Successfully inserted: ${successCount} trails`);
      console.log(`   ❌ Failed to insert: ${errorCount} trails`);
      console.log(`   📊 Total processed: ${cotrexTrails.length} trails`);

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    } finally {
      await this.atomicInserter.disconnect();
      await this.pgClient.end();
    }
  }

  private async getBoulderBbox(): Promise<{min_lng: number, min_lat: number, max_lng: number, max_lat: number}> {
    const result = await this.pgClient.query(`
      SELECT 
        ST_XMin(ST_Extent(geometry)) as min_lng,
        ST_YMin(ST_Extent(geometry)) as min_lat,
        ST_XMax(ST_Extent(geometry)) as max_lng,
        ST_YMax(ST_Extent(geometry)) as max_lat
      FROM public.trails 
      WHERE region = 'boulder'
    `);
    
    return result.rows[0];
  }

  private async getCotrexTrailsInBbox(bbox: {min_lng: number, min_lat: number, max_lng: number, max_lat: number}): Promise<CotrexTrail[]> {
    const result = await this.pgClient.query(`
      SELECT 
        id,
        name,
        trail_type,
        surface_type,
        difficulty,
        ST_AsText(geometry) as geometry,
        length_miles
      FROM public.cotrex_trails
      WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      ORDER BY id
    `, [bbox.min_lng, bbox.min_lat, bbox.max_lng, bbox.max_lat]);

    return result.rows;
  }

  private async insertTrailWithAtomicInserter(trail: CotrexTrail): Promise<boolean> {
    try {
      // Parse geometry to get coordinates
      const coordinates = this.parseGeometryText(trail.geometry);
      if (coordinates.length === 0) {
        console.error(`❌ Failed to parse geometry for trail: ${trail.name}`);
        return false;
      }

      // Convert length_miles to length_km
      const length_km = trail.length_miles ? trail.length_miles * 1.60934 : undefined;

      // Use AtomicTrailInserter to insert the trail with provided length
      const trailData = {
        osm_id: `cotrex_${trail.id}`,
        name: trail.name,
        trail_type: trail.trail_type,
        surface: trail.surface_type, // map surface_type to surface
        difficulty: trail.difficulty,
        coordinates: coordinates,
        region: 'boulder',
        source_tags: { source: 'cotrex', cotrex_id: trail.id.toString() },
        length_km: length_km, // Use the converted length from COTREX data
        source: 'cotrex' // Set the source to cotrex
      };

      const result = await this.atomicInserter.insertTrailAtomically(trailData);
      
      if (result.success) {
        return true;
      } else {
        if (result.error && result.error.includes('outside TIFF coverage')) {
          console.log(`⚠️  Skipped trail ${trail.name}: ${result.error}`);
          return false; // Return false but don't count as error
        } else {
          console.error(`❌ Failed to insert trail ${trail.name}: ${result.error}`);
          return false;
        }
      }
    } catch (error) {
      console.error(`❌ Error inserting trail ${trail.name}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private parseGeometryText(geometryText: string): number[][] {
    try {
      const match = geometryText.match(/LINESTRING Z? \(([^)]+)\)/i);
      if (!match) {
        console.error(`❌ Invalid geometry format: ${geometryText}`);
        return [];
      }
      const coordinates = match[1].split(',').map(coord => {
        const parts = coord.trim().split(/\s+/);
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (isNaN(lng) || isNaN(lat)) {
          console.error(`❌ Invalid coordinate: ${coord}`);
          return null;
        }
        return [lng, lat];
      }).filter(coord => coord !== null) as number[][];
      return coordinates;
    } catch (error) {
      console.error(`❌ Error parsing geometry: ${geometryText}`, error);
      return [];
    }
  }
}

// Run the migration
if (require.main === module) {
  const migrator = new CotrexToPublicTrailsBoulderBbox();
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
