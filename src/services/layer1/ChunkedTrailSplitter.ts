import { Pool } from 'pg';

export interface ChunkedTrailSplitterConfig {
  stagingSchema: string;
  intersectionToleranceMeters?: number;
  minSegmentLengthMeters?: number;
  verbose?: boolean;
}

export interface ChunkInfo {
  chunk_id: number;
  trail_count: number;
}

export class ChunkedTrailSplitter {
  constructor(
    private pgClient: Pool,
    private config: ChunkedTrailSplitterConfig
  ) {}

  async splitTrailsInChunks(): Promise<{ chunksProcessed: number; totalSegmentsCreated: number }> {
    console.log('🔄 Starting chunked trail splitting...');
    
    // Step 1: Identify connected subnetworks and assign chunk_ids
    await this.assignChunkIds();
    
    // Step 2: Get list of chunks to process
    const chunks = await this.getChunksToProcess();
    
    console.log(`📊 Found ${chunks.length} chunks to process`);
    
    let totalSegmentsCreated = 0;
    
    // Step 3: Process each chunk separately
    for (const chunk of chunks) {
      console.log(`🔄 Processing chunk ${chunk.chunk_id} with ${chunk.trail_count} trails`);
      const segmentsCreated = await this.splitChunkTrails(chunk.chunk_id);
      totalSegmentsCreated += segmentsCreated;
      console.log(`✅ Chunk ${chunk.chunk_id} processed: ${segmentsCreated} segments created`);
    }
    
    console.log(`✅ Chunked trail splitting completed: ${chunks.length} chunks processed, ${totalSegmentsCreated} total segments created`);
    
    return {
      chunksProcessed: chunks.length,
      totalSegmentsCreated
    };
  }

  private async assignChunkIds(): Promise<void> {
    console.log('🔍 Identifying connected subnetworks and assigning chunk IDs...');
    
    // Use connectivity analysis to identify connected components
    const connectivityResult = await this.pgClient.query(`
      WITH trail_connectivity AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t2.app_uuid as trail2_id
        FROM ${this.config.stagingSchema}.trails t1
        JOIN ${this.config.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE (
          -- Physical intersections
          (ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint'))
          OR
          -- Endpoint proximity (within 1m)
          (ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.00001)
            OR ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.00001)
            OR ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.00001)
            OR ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.00001))
        )
      ),
      connected_components AS (
        WITH RECURSIVE component_search AS (
          SELECT 
            trail1_id as trail_uuid,
            ARRAY[trail1_id] as component_trails,
            1 as depth
          FROM trail_connectivity
          UNION ALL
          SELECT 
            ec.trail2_uuid,
            cs.component_trails || ec.trail2_uuid,
            cs.depth + 1
          FROM trail_connectivity ec
          JOIN component_search cs ON ec.trail1_id = ANY(cs.component_trails)
          WHERE ec.trail2_uuid != ALL(cs.component_trails)
            AND cs.depth < 100
        )
        SELECT DISTINCT component_trails
        FROM component_search
        WHERE depth = (
          SELECT MAX(depth) 
          FROM component_search cs2 
          WHERE cs2.component_trails @> component_search.component_trails
        )
      ),
      chunk_assignment AS (
        SELECT 
          ROW_NUMBER() OVER (ORDER BY ARRAY_LENGTH(component_trails, 1) DESC) as chunk_id,
          component_trails
        FROM connected_components
      )
      UPDATE ${this.config.stagingSchema}.trails 
      SET chunk_id = ca.chunk_id
      FROM chunk_assignment ca
      WHERE trails.app_uuid = ANY(ca.component_trails)
    `);
    
    // Assign chunk_id to isolated trails (trails not in any connected component)
    await this.pgClient.query(`
      WITH max_chunk_id AS (
        SELECT COALESCE(MAX(chunk_id), 0) as max_id FROM ${this.config.stagingSchema}.trails
      ),
      isolated_trails AS (
        SELECT app_uuid
        FROM ${this.config.stagingSchema}.trails
        WHERE chunk_id IS NULL
      )
      UPDATE ${this.config.stagingSchema}.trails 
      SET chunk_id = max_chunk_id.max_id + ROW_NUMBER() OVER (ORDER BY app_uuid)
      FROM max_chunk_id, isolated_trails
      WHERE trails.app_uuid = isolated_trails.app_uuid
    `);
    
    console.log('✅ Chunk IDs assigned to all trails');
  }

  private async getChunksToProcess(): Promise<ChunkInfo[]> {
    const result = await this.pgClient.query(`
      SELECT 
        chunk_id,
        COUNT(*) as trail_count
      FROM ${this.config.stagingSchema}.trails
      WHERE chunk_id IS NOT NULL
      GROUP BY chunk_id
      ORDER BY chunk_id
    `);
    
    return result.rows;
  }

  private async splitChunkTrails(chunkId: number): Promise<number> {
    if (this.config.verbose) {
      console.log(`🔄 Splitting trails in chunk ${chunkId}...`);
    }
    
    // Create temporary table for this chunk's trails
    await this.pgClient.query(`
      CREATE TEMP TABLE temp_chunk_${chunkId}_trails AS
      SELECT 
        app_uuid,
        name, trail_type, surface, difficulty,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      FROM ${this.config.stagingSchema}.trails
      WHERE chunk_id = $1
        AND geometry IS NOT NULL AND ST_IsValid(geometry)
    `, [chunkId]);
    
    // Apply ST_Node() to only this chunk's trails
    const splitSql = `
      WITH chunk_geometries AS (
        SELECT 
          app_uuid,
          name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          geometry
        FROM temp_chunk_${chunkId}_trails
      ),
      noded_geometries AS (
        -- Apply ST_Node to ONLY this chunk's geometries
        SELECT ST_Node(ST_Collect(geometry)) as noded_geom
        FROM chunk_geometries
      ),
      split_segments AS (
        -- Extract individual segments from the noded geometry
        SELECT 
          t.app_uuid as original_trail_uuid,
          t.name, t.trail_type, t.surface, t.difficulty,
          t.elevation_gain, t.elevation_loss, t.max_elevation, t.min_elevation, t.avg_elevation,
          dumped.geom as segment_geom,
          COUNT(*) OVER (PARTITION BY t.app_uuid) as segment_count
        FROM chunk_geometries t,
        LATERAL ST_Dump((SELECT noded_geom FROM noded_geometries)) as dumped
        WHERE ST_IsValid(dumped.geom) 
          AND dumped.geom IS NOT NULL
          AND ST_NumPoints(dumped.geom) >= 2
          AND ST_StartPoint(dumped.geom) != ST_EndPoint(dumped.geom)
          AND ST_Intersects(t.geometry, dumped.geom)
      ),
      segments_to_insert AS (
        SELECT
          CASE 
            WHEN segment_count > 1 THEN gen_random_uuid()
            ELSE original_trail_uuid
          END as app_uuid,
          CASE 
            WHEN segment_count > 1 THEN original_trail_uuid
            ELSE NULL
          END as original_trail_uuid,
          $1 as chunk_id,  -- Preserve chunk_id
          name, trail_type, surface, difficulty,
          ST_XMin(segment_geom) as bbox_min_lng, ST_XMax(segment_geom) as bbox_max_lng,
          ST_YMin(segment_geom) as bbox_min_lat, ST_YMax(segment_geom) as bbox_max_lat,
          ST_Length(segment_geom::geography) / 1000.0 as length_km,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          segment_geom as geometry
        FROM split_segments
      )
      -- Delete original trails in this chunk
      DELETE FROM ${this.config.stagingSchema}.trails WHERE chunk_id = $1;
      
      -- Insert split segments
      INSERT INTO ${this.config.stagingSchema}.trails (
        app_uuid, original_trail_uuid, chunk_id, name, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry
      )
      SELECT * FROM segments_to_insert;
    `;
    
    const result = await this.pgClient.query(splitSql, [chunkId]);
    
    // Get count of segments created
    const countResult = await this.pgClient.query(`
      SELECT COUNT(*) as segment_count 
      FROM ${this.config.stagingSchema}.trails 
      WHERE chunk_id = $1
    `, [chunkId]);
    
    const segmentsCreated = parseInt(countResult.rows[0].segment_count);
    
    // Clean up temporary table
    await this.pgClient.query(`DROP TABLE temp_chunk_${chunkId}_trails`);
    
    return segmentsCreated;
  }
}
