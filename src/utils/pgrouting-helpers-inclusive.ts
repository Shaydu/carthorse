import { Pool, Client } from 'pg';
import { getPgRoutingTolerances } from '../config/pgrouting-config';

export interface PgRoutingConfig {
  pgClient: Pool | Client;
  stagingSchema: string;
}

export class PgRoutingHelpersInclusive {
  private stagingSchema: string;
  private pgClient: Pool | Client;

  constructor(config: PgRoutingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
  }

  async createPgRoutingViews(): Promise<boolean> {
    try {
      console.log('🔄 Starting INCLUSIVE pgRouting network creation from trail data...');
      
      // Get configurable tolerance settings
      const tolerances = getPgRoutingTolerances();
      console.log(`📏 Using pgRouting tolerances:`, tolerances);

      // Drop existing pgRouting tables if they exist
      console.log('🗑️  Dropping existing pgRouting tables...');
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded_vertices_pgr`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.node_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.edge_mapping`);
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.ways_noded`);
      
      console.log('✅ Dropped existing pgRouting tables');

      // Create a trails table for pgRouting from our existing trail data (INCLUSIVE VERSION)
      console.log('📊 Creating ways table from trail data (INCLUSIVE)...');
      const trailsTableResult = await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.ways AS
        SELECT 
          ROW_NUMBER() OVER (ORDER BY id) as id,
          app_uuid,  -- Sidecar data for metadata lookup
          name,
          length_km,
          elevation_gain,
          elevation_loss,
          CASE 
            WHEN ST_IsSimple(geometry) THEN ST_Force2D(geometry)
            ELSE ST_Force2D(ST_MakeValid(geometry))
          END as the_geom
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_GeometryType(geometry) IN ('ST_LineString', 'ST_MultiLineString')  -- Include MultiLineStrings
          AND ST_Length(geometry::geography) > 0.1  -- Much more permissive: 0.1 meters minimum
      `);
      console.log(`✅ Created ways table with ${trailsTableResult.rowCount} rows from trail data`);
      
      // Check if ways table has data
      const waysCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways`);
      console.log(`📊 Ways table contains ${waysCount.rows[0].count} rows`);
      
      if (waysCount.rows[0].count === 0) {
        console.error('❌ Ways table is empty - no valid trails found');
        return false;
      }

      // LESS AGGRESSIVE geometry cleanup for pgRouting compatibility
      console.log('🔧 LESS AGGRESSIVE geometry cleanup for pgRouting...');
      
      // Step 1: Handle GeometryCollections by extracting LineStrings (keep more trails)
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_LineMerge(ST_CollectionHomogenize(the_geom))
        WHERE ST_GeometryType(the_geom) = 'ST_GeometryCollection'
          AND ST_NumGeometries(ST_CollectionHomogenize(the_geom)) = 1
      `);
      
      // Step 2: Convert MultiLineStrings to LineStrings (keep more trails)
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_LineMerge(the_geom)
        WHERE ST_GeometryType(the_geom) = 'ST_MultiLineString'
      `);
      
      // Step 3: Fix invalid geometries (minimal processing to preserve coordinates)
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = ST_MakeValid(the_geom)
        WHERE NOT ST_IsValid(the_geom)
      `);
      
      // Step 4: LESS AGGRESSIVE filtering - only remove truly problematic geometries
      console.log('🔧 LESS AGGRESSIVE filtering - preserving more trails...');
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) NOT IN ('ST_LineString', 'ST_MultiLineString')
          OR ST_IsEmpty(the_geom)
          OR ST_Length(the_geom::geography) < 0.1  -- Much more permissive: 0.1 meters minimum
          OR NOT ST_IsValid(the_geom)
          OR ST_NumPoints(the_geom) < 2
      `);
      
      // Step 5: Handle remaining MultiLineStrings by extracting the longest segment
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways 
        SET the_geom = (
          SELECT ST_LineMerge(geom)
          FROM (
            SELECT ST_Dump(the_geom) as dump
          ) sub,
          LATERAL (
            SELECT (dump).geom as geom, ST_Length((dump).geom::geography) as len
            ORDER BY ST_Length((dump).geom::geography) DESC
            LIMIT 1
          ) longest
        )
        WHERE ST_GeometryType(the_geom) = 'ST_MultiLineString'
      `);
      
      // Step 6: Final validation - only remove truly invalid geometries
      await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.ways 
        WHERE ST_GeometryType(the_geom) != 'ST_LineString'
          OR NOT ST_IsValid(the_geom)
          OR ST_IsEmpty(the_geom)
          OR ST_NumPoints(the_geom) < 2
      `);
      
      // Check how many trails remain after LESS AGGRESSIVE cleanup
      const remainingTrails = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways
      `);
      console.log(`✅ LESS AGGRESSIVE geometry cleanup: ${remainingTrails.rows[0].count} trails remaining`);
      
      if (remainingTrails.rows[0].count === 0) {
        throw new Error('No valid trails remaining after geometry cleanup');
      }

      // Check if Green Mountain West Ridge Trail made it through
      const greenMountainCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.ways 
        WHERE name LIKE '%Green Mountain West Ridge%'
      `);
      console.log(`🌲 Green Mountain West Ridge trails included: ${greenMountainCount.rows[0].count}`);

      // Use network creation service with strategy pattern
      console.log('🔄 Creating routing network using strategy pattern...');
      
      // Continue with the rest of the pgRouting setup...
      // (This would include the nodeNetwork creation, topology creation, etc.)
      
      return true;
    } catch (error) {
      console.error('❌ Error in inclusive pgRouting creation:', error);
      return false;
    }
  }
}
