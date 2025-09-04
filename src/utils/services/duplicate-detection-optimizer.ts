import { Pool } from 'pg';

export interface DuplicateDetectionConfig {
  toleranceLevels: {
    bbox: number;      // Bounding box intersection tolerance
    proximity: number; // ST_DWithin tolerance for proximity check
    precision: number; // Final precision tolerance for exact match
  };
  enableSpatialClustering: boolean;
  enableLengthComparison: boolean;
  maxResults?: number;
}

export interface DuplicateDetectionResult {
  duplicatesFound: number;
  executionTimeMs: number;
  duplicatesToRemove: Array<{
    uuidToDelete: string;
    nameToDelete: string;
    reason: string;
    distanceMeters: number;
    length1: number;
    length2: number;
  }>;
}

export class DuplicateDetectionOptimizer {
  private pgClient: Pool;
  private config: DuplicateDetectionConfig;

  constructor(pgClient: Pool, config?: Partial<DuplicateDetectionConfig>) {
    this.pgClient = pgClient;
    this.config = {
      toleranceLevels: {
        bbox: 0.002,      // ~200m bounding box tolerance
        proximity: 0.001, // ~100m proximity tolerance
        precision: 0.00001 // ~1m precision tolerance
      },
      enableSpatialClustering: false,
      enableLengthComparison: true,
      maxResults: 1000,
      ...config
    };
  }

  /**
   * Automatically create optimized indexes for a staging schema
   */
  async createOptimizedIndexes(schemaName: string): Promise<{
    success: boolean;
    indexesCreated: string[];
    errors: string[];
  }> {
    const indexesCreated: string[] = [];
    const errors: string[] = [];

    try {
      console.log(`🔧 Creating optimized indexes for schema: ${schemaName}`);

      // 1. Composite spatial index for bounding box + geometry operations
      try {
        await this.pgClient.query(`
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schemaName}_trails_bbox_geom 
          ON ${schemaName}.trails 
          USING gist (ST_Envelope(geometry), geometry)
        `);
        indexesCreated.push(`idx_${schemaName}_trails_bbox_geom`);
        console.log(`  ✅ Created composite spatial index`);
      } catch (error) {
        const errorMsg = `Failed to create composite spatial index: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        console.log(`  ❌ ${errorMsg}`);
      }

      // 2. Index on name for faster name matching
      try {
        await this.pgClient.query(`
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schemaName}_trails_name 
          ON ${schemaName}.trails (name)
        `);
        indexesCreated.push(`idx_${schemaName}_trails_name`);
        console.log(`  ✅ Created name index`);
      } catch (error) {
        const errorMsg = `Failed to create name index: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        console.log(`  ❌ ${errorMsg}`);
      }

      // 3. Index on app_uuid for faster lookups
      try {
        await this.pgClient.query(`
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schemaName}_trails_uuid 
          ON ${schemaName}.trails (app_uuid)
        `);
        indexesCreated.push(`idx_${schemaName}_trails_uuid`);
        console.log(`  ✅ Created UUID index`);
      } catch (error) {
        const errorMsg = `Failed to create UUID index: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        console.log(`  ❌ ${errorMsg}`);
      }

      // 4. Index for geometry validity checks
      try {
        await this.pgClient.query(`
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${schemaName}_trails_valid_geom 
          ON ${schemaName}.trails (id) 
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        `);
        indexesCreated.push(`idx_${schemaName}_trails_valid_geom`);
        console.log(`  ✅ Created valid geometry index`);
      } catch (error) {
        const errorMsg = `Failed to create valid geometry index: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        console.log(`  ❌ ${errorMsg}`);
      }

      console.log(`✅ Index creation completed for schema: ${schemaName}`);
      return { success: errors.length === 0, indexesCreated, errors };

    } catch (error) {
      const errorMsg = `Failed to create indexes for schema ${schemaName}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
      return { success: false, indexesCreated, errors };
    }
  }

  /**
   * Generate optimized duplicate detection query for any schema
   */
  generateOptimizedQuery(schemaName: string, queryType: 'basic' | 'aggressive' | 'index-optimized' = 'index-optimized'): string {
    const { toleranceLevels } = this.config;

    switch (queryType) {
      case 'basic':
        return this.generateBasicQuery(schemaName, toleranceLevels);
      case 'aggressive':
        return this.generateAggressiveQuery(schemaName, toleranceLevels);
      case 'index-optimized':
      default:
        return this.generateIndexOptimizedQuery(schemaName, toleranceLevels);
    }
  }

  /**
   * Execute optimized duplicate detection query
   */
  async executeDuplicateDetection(schemaName: string, queryType: 'basic' | 'aggressive' | 'index-optimized' = 'index-optimized'): Promise<DuplicateDetectionResult> {
    const startTime = Date.now();
    
    try {
      console.log(`🔍 Executing ${queryType} duplicate detection on schema: ${schemaName}`);
      
      const query = this.generateOptimizedQuery(schemaName, queryType);
      const result = await this.pgClient.query(query);
      
      const executionTimeMs = Date.now() - startTime;
      const duplicatesFound = result.rows.length;
      
      console.log(`✅ Duplicate detection completed in ${executionTimeMs}ms`);
      console.log(`📊 Found ${duplicatesFound} duplicates`);
      
      return {
        duplicatesFound,
        executionTimeMs,
        duplicatesToRemove: result.rows.map(row => ({
          uuidToDelete: row.uuid_to_delete,
          nameToDelete: row.name_to_delete,
          reason: row.reason || 'Duplicate trail - keeping longer version',
          distanceMeters: row.distance_meters || 0,
          length1: row.length1 || 0,
          length2: row.length2 || 0
        }))
      };

    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      console.error(`❌ Duplicate detection failed after ${executionTimeMs}ms:`, error);
      throw error;
    }
  }

  /**
   * Generate basic 3-level optimized query
   */
  private generateBasicQuery(schemaName: string, toleranceLevels: DuplicateDetectionConfig['toleranceLevels']): string {
    return `
      WITH level1_candidates AS (
        -- Level 1: Bounding box intersection (fastest)
        SELECT DISTINCT
          t1.id as id1, t1.app_uuid as uuid1, t1.name as name1,
          t2.id as id2, t2.app_uuid as uuid2, t2.name as name2
        FROM ${schemaName}.trails t1
        JOIN ${schemaName}.trails t2 ON t1.id < t2.id
        WHERE t1.name = t2.name  -- Name must match
          AND ST_Intersects(
            ST_Envelope(t1.geometry), 
            ST_Envelope(t2.geometry)
          )
      ),
      level2_candidates AS (
        -- Level 2: ST_DWithin with proximity tolerance (medium speed)
        SELECT 
          l1.id1, l1.uuid1, l1.name1,
          l1.id2, l1.uuid2, l1.name2,
          t1.geometry as geom1,
          t2.geometry as geom2
        FROM level1_candidates l1
        JOIN ${schemaName}.trails t1 ON l1.id1 = t1.id
        JOIN ${schemaName}.trails t2 ON l1.id2 = t2.id
        WHERE ST_DWithin(t1.geometry, t2.geometry, ${toleranceLevels.proximity})
      ),
      level3_exact_matches AS (
        -- Level 3: Precise comparison only for close candidates (slow, but limited)
        SELECT 
          l2.id1, l2.uuid1, l2.name1,
          l2.id2, l2.uuid2, l2.name2,
          ST_Length(l2.geom1::geography) as length1,
          ST_Length(l2.geom2::geography) as length2,
          ST_Distance(l2.geom1, l2.geom2) as distance_meters,
          ST_DWithin(l2.geom1, l2.geom2, ${toleranceLevels.precision}) as is_exact_match
        FROM level2_candidates l2
        WHERE ST_DWithin(l2.geom1, l2.geom2, ${toleranceLevels.precision})
      ),
      duplicates_to_remove AS (
        SELECT 
          id1, uuid1, name1, length1,
          id2, uuid2, name2, length2,
          distance_meters,
          CASE 
            WHEN length1 > length2 THEN uuid2
            WHEN length2 > length1 THEN uuid1
            ELSE LEAST(uuid1, uuid2)
          END as uuid_to_delete,
          CASE 
            WHEN length1 > length2 THEN name2
            WHEN length2 > length1 THEN name1
            ELSE LEAST(name1, name2)
          END as name_to_delete,
          'Basic 3-level optimization' as detection_method
        FROM level3_exact_matches
        WHERE is_exact_match = true
      )
      SELECT 
        uuid_to_delete,
        name_to_delete,
        'Duplicate trail - keeping longer version' as reason,
        distance_meters,
        length1,
        length2
      FROM duplicates_to_remove
      ORDER BY distance_meters ASC, length1 DESC
      ${this.config.maxResults ? `LIMIT ${this.config.maxResults}` : ''};
    `;
  }

  /**
   * Generate aggressive spatial clustering query
   */
  private generateAggressiveQuery(schemaName: string, toleranceLevels: DuplicateDetectionConfig['toleranceLevels']): string {
    return `
      WITH spatial_clusters AS (
        -- Group trails into spatial clusters using ST_ClusterDBSCAN
        SELECT 
          id,
          app_uuid,
          name,
          geometry,
          ST_ClusterDBSCAN(geometry, ${toleranceLevels.proximity}, 1) OVER () as cluster_id
        FROM ${schemaName}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      cluster_candidates AS (
        -- Only compare trails within the same spatial cluster
        SELECT DISTINCT
          c1.id as id1, c1.app_uuid as uuid1, c1.name as name1,
          c2.id as id2, c2.app_uuid as uuid2, c2.name as name2
        FROM spatial_clusters c1
        JOIN spatial_clusters c2 ON 
          c1.cluster_id = c2.cluster_id
          AND c1.id < c2.id
          AND c1.name = c2.name
      ),
      distance_filtered AS (
        -- Apply ST_DWithin with multiple tolerance levels
        SELECT 
          cc.id1, cc.uuid1, cc.name1,
          cc.id2, cc.uuid2, cc.name2,
          t1.geometry as geom1,
          t2.geometry as geom2,
          ST_DWithin(t1.geometry, t2.geometry, ${toleranceLevels.proximity}) as within_proximity,
          ST_DWithin(t1.geometry, t2.geometry, ${toleranceLevels.precision}) as within_precision
        FROM cluster_candidates cc
        JOIN ${schemaName}.trails t1 ON cc.id1 = t1.id
        JOIN ${schemaName}.trails t2 ON cc.id2 = t2.id
        WHERE ST_DWithin(t1.geometry, t2.geometry, ${toleranceLevels.proximity})
      ),
      final_duplicates AS (
        -- Final selection with length comparison
        SELECT 
          df.id1, df.uuid1, df.name1,
          df.id2, df.uuid2, df.name2,
          ST_Length(df.geom1::geography) as length1,
          ST_Length(df.geom2::geography) as length2,
          ST_Distance(df.geom1, df.geom2) as distance_meters,
          CASE 
            WHEN ST_Length(df.geom1::geography) > ST_Length(df.geom2::geography) THEN df.uuid2
            WHEN ST_Length(df.geom2::geography) > ST_Length(df.geom1::geography) THEN df.uuid1
            ELSE LEAST(df.uuid1, df.uuid2)
          END as uuid_to_delete,
          CASE 
            WHEN ST_Length(df.geom1::geography) > ST_Length(df.geom2::geography) THEN df.name2
            WHEN ST_Length(df.geom2::geography) > ST_Length(df.geom1::geography) THEN df.name1
            ELSE LEAST(df.name1, df.name2)
          END as name_to_delete,
          'Spatial clustering optimization' as detection_method
        FROM distance_filtered df
        WHERE df.within_precision = true
      )
      SELECT 
        uuid_to_delete,
        name_to_delete,
        'Duplicate trail - keeping longer version' as reason,
        distance_meters,
        length1,
        length2
      FROM final_duplicates
      ORDER BY distance_meters ASC, length1 DESC
      ${this.config.maxResults ? `LIMIT ${this.config.maxResults}` : ''};
    `;
  }

  /**
   * Generate index-optimized query with bounding box pre-filtering
   */
  private generateIndexOptimizedQuery(schemaName: string, toleranceLevels: DuplicateDetectionConfig['toleranceLevels']): string {
    return `
      WITH bbox_candidates AS (
        -- Level 1: Ultra-fast bounding box intersection using spatial index
        SELECT DISTINCT
          t1.id as id1, t1.app_uuid as uuid1, t1.name as name1,
          t2.id as id2, t2.app_uuid as uuid2, t2.name as name2
        FROM ${schemaName}.trails t1
        JOIN ${schemaName}.trails t2 ON t1.id < t2.id
        WHERE t1.name = t2.name
          AND ST_Intersects(
            ST_Envelope(t1.geometry), 
            ST_Envelope(t2.geometry)
          )
          AND ST_DWithin(
            ST_Envelope(t1.geometry), 
            ST_Envelope(t2.geometry), 
            ${toleranceLevels.bbox}
          )
      ),
      proximity_filtered AS (
        -- Level 2: Apply ST_DWithin with spatial index
        SELECT 
          bc.id1, bc.uuid1, bc.name1,
          bc.id2, bc.uuid2, bc.name2,
          t1.geometry as geom1,
          t2.geometry as geom2,
          ST_DWithin(t1.geometry, t2.geometry, ${toleranceLevels.proximity}) as within_proximity
        FROM bbox_candidates bc
        JOIN ${schemaName}.trails t1 ON bc.id1 = t1.id
        JOIN ${schemaName}.trails t2 ON bc.id2 = t2.id
        WHERE ST_DWithin(t1.geometry, t2.geometry, ${toleranceLevels.proximity})
      ),
      precision_filtered AS (
        -- Level 3: High precision filtering only for close candidates
        SELECT 
          pf.*,
          ST_DWithin(pf.geom1, pf.geom2, ${toleranceLevels.precision}) as within_precision
        FROM proximity_filtered pf
      ),
      length_calculated AS (
        -- Level 4: Calculate lengths only for final candidates
        SELECT 
          pf.*,
          CASE 
            WHEN pf.within_precision THEN 
              ST_Length(pf.geom1::geography)
            ELSE NULL
          END as length1,
          CASE 
            WHEN pf.within_precision THEN 
              ST_Length(pf.geom2::geography)
            ELSE NULL
          END as length2
        FROM precision_filtered pf
        WHERE pf.within_precision = true
      ),
      duplicates_final AS (
        -- Final selection with business logic
        SELECT 
          lc.id1, lc.uuid1, lc.name1,
          lc.id2, lc.uuid2, lc.name2,
          lc.length1, lc.length2,
          ST_Distance(lc.geom1, lc.geom2) as distance_meters,
          CASE 
            WHEN lc.length1 > lc.length2 THEN lc.uuid2
            WHEN lc.length2 > lc.length1 THEN lc.uuid1
            ELSE LEAST(lc.uuid1, lc.uuid2)
          END as uuid_to_delete,
          CASE 
            WHEN lc.length1 > lc.length2 THEN lc.name2
            WHEN lc.length2 > lc.length1 THEN lc.name1
            ELSE LEAST(lc.name1, lc.name2)
          END as name_to_delete,
          'Bounding box optimized' as detection_method
        FROM length_calculated lc
        WHERE lc.length1 IS NOT NULL 
          AND lc.length2 IS NOT NULL
      )
      SELECT 
        uuid_to_delete,
        name_to_delete,
        'Duplicate trail - keeping longer version' as reason,
        distance_meters,
        length1,
        length2
      FROM duplicates_final
      ORDER BY distance_meters ASC, length1 DESC
      ${this.config.maxResults ? `LIMIT ${this.config.maxResults}` : ''};
    `;
  }

  /**
   * Get performance statistics for a schema
   */
  async getPerformanceStats(schemaName: string): Promise<{
    tableSize: string;
    rowCount: number;
    indexCount: number;
    hasOptimizedIndexes: boolean;
  }> {
    try {
      // Get table size and row count
      const tableStats = await this.pgClient.query(`
        SELECT 
          n_live_tup as row_count,
          pg_size_pretty(pg_total_relation_size($1 || '.trails')) as table_size
        FROM pg_stat_user_tables 
        WHERE schemaname = $1 AND relname = 'trails'
      `, [schemaName]);

      // Get index count
      const indexStats = await this.pgClient.query(`
        SELECT COUNT(*) as index_count
        FROM pg_indexes 
        WHERE schemaname = $1 
          AND tablename = 'trails' 
          AND indexname LIKE 'idx_%'
      `, [schemaName]);

      // Check if optimized indexes exist
      const optimizedIndexes = await this.pgClient.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE schemaname = $1 
          AND tablename = 'trails' 
          AND indexname IN (
            'idx_' || $1 || '_trails_bbox_geom',
            'idx_' || $1 || '_trails_name',
            'idx_' || $1 || '_trails_uuid'
          )
      `, [schemaName]);

      return {
        tableSize: tableStats.rows[0]?.table_size || 'Unknown',
        rowCount: tableStats.rows[0]?.row_count || 0,
        indexCount: indexStats.rows[0]?.index_count || 0,
        hasOptimizedIndexes: optimizedIndexes.rows.length >= 3
      };

    } catch (error) {
      console.error(`Failed to get performance stats for schema ${schemaName}:`, error);
      return {
        tableSize: 'Unknown',
        rowCount: 0,
        indexCount: 0,
        hasOptimizedIndexes: false
      };
    }
  }
}
