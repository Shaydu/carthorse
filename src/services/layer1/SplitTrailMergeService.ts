import { Pool } from 'pg';

export interface SplitTrailMergeConfig {
  stagingSchema: string;
  verbose?: boolean;
}

export class SplitTrailMergeService {
  private pgClient: Pool;
  private config: SplitTrailMergeConfig;

  constructor(pgClient: Pool, config: SplitTrailMergeConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  private log(message: string) {
    if (this.config.verbose) {
      console.log(`[SplitTrailMerge] ${message}`);
    }
  }

  /**
   * Merge split trails back into the main trails table for export
   * This inserts all split trails from trails_split back into trails table,
   * then deletes the corresponding unsplit trails that the split ones came from.
   */
  async mergeSplitTrailsForExport(): Promise<number> {
    this.log('🔄 Merging split trails back into main trails table for export...');
    
    try {
      // Check if trails_split table exists
      const tableExistsResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'trails_split'
        ) as exists
      `, [this.config.stagingSchema]);
      
      if (!tableExistsResult.rows[0].exists) {
        this.log('⚠️ trails_split table does not exist, skipping merge');
        return 0;
      }

      // Get count of split trails
      const splitCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.trails_split
      `);
      const splitCount = parseInt(splitCountResult.rows[0].count);
      
      if (splitCount === 0) {
        this.log('⚠️ No split trails found in trails_split table');
        return 0;
      }

      this.log(`📋 Found ${splitCount} split trails to merge`);

      // Get the list of trails that were split (have multiple segments)
      const splitTrailsResult = await this.pgClient.query(`
        SELECT DISTINCT original_app_uuid, name
        FROM ${this.config.stagingSchema}.trails_split
        WHERE original_app_uuid IS NOT NULL
        ORDER BY name
      `);
      
      const splitTrails = splitTrailsResult.rows;
      this.log(`📋 Found ${splitTrails.length} trails that were split`);

      // Log which trails are being processed
      for (const trail of splitTrails) {
        this.log(`✂️ Processing split trail: ${trail.name} (${trail.original_app_uuid})`);
      }

      // Also log how many total trails we have before deletion
      const totalTrailsResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.trails
      `);
      const totalTrails = parseInt(totalTrailsResult.rows[0].count);
      this.log(`📋 Total trails before deletion: ${totalTrails}`);

      await this.pgClient.query('BEGIN');

      try {
        // Delete the parent trails that were split
        if (splitTrails.length > 0) {
          const parentUuids = splitTrails.map(t => `'${t.original_app_uuid}'`).join(',');
          await this.pgClient.query(`
            DELETE FROM ${this.config.stagingSchema}.trails 
            WHERE app_uuid IN (${parentUuids})
          `);
          this.log(`🗑️ Deleted ${splitTrails.length} parent trails`);
        }

        // Check for duplicate UUIDs in trails_split
        const duplicateCheck = await this.pgClient.query(`
          SELECT app_uuid, COUNT(*) as count
          FROM ${this.config.stagingSchema}.trails_split
          WHERE app_uuid IS NOT NULL
          GROUP BY app_uuid
          HAVING COUNT(*) > 1
        `);
        
        if (duplicateCheck.rowCount && duplicateCheck.rowCount > 0) {
          this.log(`⚠️ Found ${duplicateCheck.rowCount} duplicate UUIDs in trails_split`);
          for (const row of duplicateCheck.rows) {
            this.log(`⚠️ Duplicate UUID: ${row.app_uuid} (${row.count} times)`);
          }
        } else {
          this.log(`✅ No duplicate UUIDs found in trails_split`);
        }

        // Insert the split segments into the trails table
        const insertResult = await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.trails (
            app_uuid, id, name, region, trail_type, surface, difficulty,
            length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry
          )
          SELECT 
            app_uuid,
            segment_id as id,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            source,
            source_tags,
            geometry
          FROM ${this.config.stagingSchema}.trails_split
          WHERE ST_IsValid(geometry) 
            AND ST_GeometryType(geometry) = 'ST_LineString'
            AND ST_NumPoints(geometry) >= 2
            AND app_uuid IS NOT NULL
        `);
        
        const insertedCount = insertResult.rowCount || 0;
        this.log(`➕ Inserted ${insertedCount} split trail segments`);

        await this.pgClient.query('COMMIT');

        // Get final count
        const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.trails`);
        const totalCount = parseInt(finalCount.rows[0].count);
        
        this.log(`✅ Split trail merge complete: ${totalCount} total trails (${insertedCount} split segments)`);
        return insertedCount;
        
      } catch (error) {
        await this.pgClient.query('ROLLBACK');
        this.log(`❌ Error during split trail merge: ${error}`);
        throw error;
      }
      
    } catch (error) {
      this.log(`❌ Error during split trail merge: ${error}`);
      return 0;
    }
  }

  /**
   * Check if trails_split table exists and has data
   */
  async hasSplitTrails(): Promise<boolean> {
    try {
      const tableExistsResult = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'trails_split'
        ) as exists
      `, [this.config.stagingSchema]);
      
      if (!tableExistsResult.rows[0].exists) {
        return false;
      }

      const countResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.trails_split
      `);
      
      return parseInt(countResult.rows[0].count) > 0;
    } catch (error) {
      this.log(`❌ Error checking for split trails: ${error}`);
      return false;
    }
  }
}
