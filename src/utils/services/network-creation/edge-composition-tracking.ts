import { Pool, PoolClient } from 'pg';

export interface TrailSegment {
  split_trail_id: number;
  original_trail_uuid: string;
  trail_name: string;
  segment_start_distance: number;
  segment_end_distance: number;
  segment_sequence: number;
  segment_percentage: number;
  composition_type: 'direct' | 'merged' | 'connector';
}

export interface EdgeComposition {
  edge_id: number;
  segments: TrailSegment[];
}

export class EdgeCompositionTracking {
  private stagingSchema: string;
  private pgClient: Pool | PoolClient;

  constructor(stagingSchema: string, pgClient: Pool | PoolClient) {
    this.stagingSchema = stagingSchema;
    this.pgClient = pgClient;
  }

  /**
   * Create the edge_trail_composition table
   */
  async createCompositionTable(): Promise<void> {
    console.log('📋 Creating edge_trail_composition table...');
    
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.edge_trail_composition (
        edge_id BIGINT NOT NULL,
        split_trail_id BIGINT NOT NULL,
        original_trail_uuid TEXT NOT NULL,
        trail_name TEXT NOT NULL,
        segment_start_distance DOUBLE PRECISION DEFAULT 0.0,
        segment_end_distance DOUBLE PRECISION DEFAULT 0.0,
        segment_sequence INTEGER DEFAULT 1,
        segment_percentage DOUBLE PRECISION DEFAULT 100.0,
        composition_type TEXT DEFAULT 'direct' CHECK (composition_type IN ('direct', 'merged', 'connector')),
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (edge_id, split_trail_id)
      )
    `);

    // Create indexes for efficient querying
    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_edge_composition_edge_id 
      ON ${this.stagingSchema}.edge_trail_composition(edge_id)
    `);

    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_edge_composition_trail_uuid 
      ON ${this.stagingSchema}.edge_trail_composition(original_trail_uuid)
    `);

    console.log('✅ Created edge_trail_composition table with indexes');
  }

  /**
   * Initialize composition tracking when ways_noded is created from split_trails_noded
   */
  async initializeCompositionFromSplitTrails(): Promise<number> {
    console.log('🔄 Initializing edge composition from split trails...');
    
    const result = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.edge_trail_composition (
        edge_id, split_trail_id, original_trail_uuid, trail_name,
        segment_start_distance, segment_end_distance, segment_sequence,
        segment_percentage, composition_type
      )
      SELECT 
        wn.id as edge_id,
        stn.id as split_trail_id,
        stn.app_uuid as original_trail_uuid,
        stn.name as trail_name,
        0.0 as segment_start_distance,
        stn.length_km as segment_end_distance,
        1 as segment_sequence,
        100.0 as segment_percentage,
        'direct' as composition_type
      FROM ${this.stagingSchema}.ways_noded wn
              JOIN ${this.stagingSchema}.split_trails_noded stn ON wn.original_trail_id = stn.original_trail_id
      ON CONFLICT (edge_id, split_trail_id) DO NOTHING
    `);

    console.log(`✅ Initialized composition for ${result.rowCount} edge-trail relationships`);
    return result.rowCount || 0;
  }

  /**
   * Initialize composition tracking when ways_noded is created from ways_split
   */
  async initializeCompositionFromWaysSplit(): Promise<number> {
    console.log('🔄 Initializing edge composition from ways_split...');
    
    const result = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.edge_trail_composition (
        edge_id, split_trail_id, original_trail_uuid, trail_name,
        segment_start_distance, segment_end_distance, segment_sequence,
        segment_percentage, composition_type
      )
      SELECT 
        wn.id as edge_id,
        ws.original_trail_id as split_trail_id,
        ws.app_uuid as original_trail_uuid,
        ws.name as trail_name,
        0.0 as segment_start_distance,
        ws.length_km as segment_end_distance,
        1 as segment_sequence,
        100.0 as segment_percentage,
        'direct' as composition_type
      FROM ${this.stagingSchema}.ways_noded wn
      JOIN ${this.stagingSchema}.ways_split ws ON wn.id = ws.id
      ON CONFLICT (edge_id, split_trail_id) DO NOTHING
    `);

    console.log(`✅ Initialized composition for ${result.rowCount} edge-trail relationships`);
    return result.rowCount || 0;
  }

  /**
   * Initialize composition tracking when ways_noded is created directly from ways_2d
   */
  async initializeCompositionFromWays2d(): Promise<number> {
    console.log('🔄 Initializing edge composition from ways_2d...');
    
    const result = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.edge_trail_composition (
        edge_id, split_trail_id, original_trail_uuid, trail_name,
        segment_start_distance, segment_end_distance, segment_sequence,
        segment_percentage, composition_type
      )
      SELECT 
        wn.id as edge_id,
        w2.original_trail_id as split_trail_id,
        w2.app_uuid as original_trail_uuid,
        w2.name as trail_name,
        0.0 as segment_start_distance,
        w2.length_km as segment_end_distance,
        1 as segment_sequence,
        100.0 as segment_percentage,
        'direct' as composition_type
      FROM ${this.stagingSchema}.ways_noded wn
              JOIN ${this.stagingSchema}.ways_2d w2 ON wn.original_trail_id = w2.original_trail_id
      ON CONFLICT (edge_id, split_trail_id) DO NOTHING
    `);

    console.log(`✅ Initialized composition for ${result.rowCount} edge-trail relationships`);
    return result.rowCount || 0;
  }

  /**
   * Update composition when edges are merged (e.g., degree-2 chains)
   */
  async updateCompositionForMergedEdge(
    newEdgeId: number,
    sourceEdgeIds: number[],
    compositionType: 'merged' | 'connector' = 'merged'
  ): Promise<void> {
    console.log(`🔄 Updating composition for merged edge ${newEdgeId} from edges [${sourceEdgeIds.join(', ')}]`);
    
    // Get all trail segments from source edges
    const sourceSegments = await this.pgClient.query(`
      SELECT 
        split_trail_id, original_trail_uuid, trail_name,
        segment_start_distance, segment_end_distance, segment_sequence,
        segment_percentage, composition_type
      FROM ${this.stagingSchema}.edge_trail_composition
      WHERE edge_id = ANY($1)
      ORDER BY edge_id, segment_sequence
    `, [sourceEdgeIds]);

    if (sourceSegments.rows.length === 0) {
      console.warn(`⚠️ No composition data found for source edges [${sourceEdgeIds.join(', ')}]`);
      return;
    }

    // Calculate new sequence numbers for the merged edge
    const mergedSegments = sourceSegments.rows.map((segment: any, index: number) => ({
      ...segment,
      segment_sequence: index + 1
    }));

    // Insert new composition records
    const insertPromises = mergedSegments.map((segment: any) => 
      this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.edge_trail_composition (
          edge_id, split_trail_id, original_trail_uuid, trail_name,
          segment_start_distance, segment_end_distance, segment_sequence,
          segment_percentage, composition_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (edge_id, split_trail_id) DO UPDATE SET
          segment_sequence = EXCLUDED.segment_sequence,
          composition_type = EXCLUDED.composition_type
      `, [
        newEdgeId, segment.split_trail_id, segment.original_trail_uuid, segment.trail_name,
        segment.segment_start_distance, segment.segment_end_distance, segment.segment_sequence,
        segment.segment_percentage, compositionType
      ])
    );

    await Promise.all(insertPromises);

    // Remove composition records for the source edges
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.edge_trail_composition
      WHERE edge_id = ANY($1)
    `, [sourceEdgeIds]);

    console.log(`✅ Updated composition for merged edge ${newEdgeId} with ${mergedSegments.length} trail segments`);
  }

  /**
   * Get composition for a specific edge
   */
  async getEdgeComposition(edgeId: number): Promise<TrailSegment[]> {
    const result = await this.pgClient.query(`
      SELECT 
        split_trail_id, original_trail_uuid, trail_name,
        segment_start_distance, segment_end_distance, segment_sequence,
        segment_percentage, composition_type
      FROM ${this.stagingSchema}.edge_trail_composition
      WHERE edge_id = $1
      ORDER BY segment_sequence
    `, [edgeId]);

    return result.rows;
  }

  /**
   * Get composition summary for route reporting
   */
  async getRouteComposition(edgeIds: number[]): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT 
        original_trail_uuid,
        trail_name,
        COUNT(*) as segment_count,
        SUM(segment_percentage) as total_percentage,
        MIN(segment_start_distance) as min_distance,
        MAX(segment_end_distance) as max_distance,
        STRING_AGG(composition_type, ', ' ORDER BY composition_type) as composition_types
      FROM ${this.stagingSchema}.edge_trail_composition
      WHERE edge_id = ANY($1)
      GROUP BY original_trail_uuid, trail_name
      ORDER BY total_percentage DESC
    `, [edgeIds]);

    return result.rows;
  }

  /**
   * Validate composition data integrity
   */
  async validateComposition(): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];

    // Check for edges without composition data
    const edgesWithoutComposition = await this.pgClient.query(`
      SELECT wn.id, wn.name
      FROM ${this.stagingSchema}.ways_noded wn
      LEFT JOIN ${this.stagingSchema}.edge_trail_composition etc ON wn.id = etc.edge_id
      WHERE etc.edge_id IS NULL
    `);

    if (edgesWithoutComposition.rows.length > 0) {
      issues.push(`${edgesWithoutComposition.rows.length} edges without composition data`);
    }

    // Check for orphaned composition records
    const orphanedComposition = await this.pgClient.query(`
      SELECT etc.edge_id
      FROM ${this.stagingSchema}.edge_trail_composition etc
      LEFT JOIN ${this.stagingSchema}.ways_noded wn ON etc.edge_id = wn.id
      WHERE wn.id IS NULL
    `);

    if (orphanedComposition.rows.length > 0) {
      issues.push(`${orphanedComposition.rows.length} orphaned composition records`);
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }
}
