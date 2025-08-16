import { Pool } from 'pg';

export interface TrailProcessingConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  bbox?: number[];
  sourceFilter?: string;
  toleranceMeters?: number;
}

export interface TrailProcessingResult {
  trailsCopied: number;
  trailsCleaned: number;
  gapsFixed: number;
  overlapsRemoved: number;
  trailsSplit: number;
  connectivityMetrics?: any;
}

export class TrailProcessingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: TrailProcessingConfig;

  constructor(config: TrailProcessingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
    
    console.log('🔧 TrailProcessingService config:', {
      region: config.region,
      bbox: config.bbox,
      toleranceMeters: config.toleranceMeters
    });
  }

  /**
   * Process Layer 1: Clean trail network using the working approach from test-nodefirst-topology.ts
   */
  async processTrails(): Promise<TrailProcessingResult> {
    console.log('🛤️ LAYER 1: TRAILS - Building clean trail network with enhanced intersection detection...');
    
    const result: TrailProcessingResult = {
      trailsCopied: 0,
      trailsCleaned: 0,
      gapsFixed: 0,
      overlapsRemoved: 0,
      trailsSplit: 0
    };

    // Step 1: Create staging environment
    await this.createStagingEnvironment();
    
    // Step 2: Copy trail data with bbox filter
    result.trailsCopied = await this.copyTrailData();
    
    // Step 3: Enhanced intersection detection and splitting (from working test file)
    result.trailsSplit = await this.enhancedIntersectionDetectionAndSplitting();
    
    // Step 4: Clean up trails
    result.trailsCleaned = await this.cleanupTrails();
    
    // Step 5: Analyze Layer 1 connectivity
    result.connectivityMetrics = await this.analyzeLayer1Connectivity();
    
    console.log('✅ LAYER 1 COMPLETE: Clean trail network ready');
    console.log(`📊 Layer 1 Results: ${result.trailsCopied} trails copied, ${result.trailsCleaned} cleaned, ${result.trailsSplit} trails split at intersections`);
    
    return result;
  }

  /**
   * Create staging environment
   */
  private async createStagingEnvironment(): Promise<void> {
    console.log('📋 Creating staging environment...');
    
    // Create staging schema
    await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.stagingSchema}`);
    
    // Create trails table
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        osm_id TEXT,
        name TEXT,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        length_km NUMERIC,
        elevation_gain NUMERIC,
        elevation_loss NUMERIC,
        max_elevation NUMERIC,
        min_elevation NUMERIC,
        avg_elevation NUMERIC,
        bbox_min_lng NUMERIC,
        bbox_max_lng NUMERIC,
        bbox_min_lat NUMERIC,
        bbox_max_lat NUMERIC,
        source TEXT,
        source_tags JSONB,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create intersection points table
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        intersection_point GEOMETRY(POINT, 4326),
        intersection_point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters NUMERIC,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('✅ Staging environment created');
  }

  /**
   * Copy trail data with bbox filter
   */
  private async copyTrailData(): Promise<number> {
    console.log('📋 Copying trail data...');
    
    // Build source query
    let sourceQuery = `SELECT * FROM public.trails WHERE source = 'cotrex'`;
    
    if (this.config.bbox && this.config.bbox.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = this.config.bbox;
      sourceQuery += ` AND ST_Intersects(geometry, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`;
    }
    
    if (this.config.sourceFilter) {
      sourceQuery += ` AND ${this.config.sourceFilter}`;
    }
    
    // Copy trails
    const result = await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry
      )
      SELECT 
        app_uuid, osm_id, name, region, trail_type, surface, difficulty,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, source, source_tags, geometry
      FROM public.trails 
      WHERE ${this.config.sourceFilter ? this.config.sourceFilter : "source = 'cotrex'"}
        ${this.config.bbox && this.config.bbox.length === 4 ? 
          `AND ST_Intersects(geometry, ST_MakeEnvelope(${this.config.bbox[0]}, ${this.config.bbox[1]}, ${this.config.bbox[2]}, ${this.config.bbox[3]}, 4326))` : 
          ''
        }
    `);
    
    const copiedCount = result.rowCount || 0;
    console.log(`✅ Copied ${copiedCount} trails`);
    
    return copiedCount;
  }

  /**
   * Enhanced intersection detection and splitting using the working approach from test-nodefirst-topology.ts
   */
  private async enhancedIntersectionDetectionAndSplitting(): Promise<number> {
    console.log('🔗 Enhanced intersection detection and splitting...');
    
    const tolerance = this.config.toleranceMeters ? this.config.toleranceMeters / 111000 : 0.0001; // ~10m default
    const dedupTolerance = tolerance * 0.01; // 1% of tolerance for deduplication
    
    console.log(`🔍 Using tolerance: ${tolerance} (~${Math.round(tolerance * 111000)}m)`);
    console.log(`🔍 Deduplication tolerance: ${dedupTolerance} (~${Math.round(dedupTolerance * 111000)}m)`);
    
    // Step 1: Create all intersection points with improved deduplication
    await this.createIntersectionPoints(tolerance, dedupTolerance);
    
    // Step 2: Split all trails at all intersections in one step
    await this.splitAllTrailsAtIntersections(tolerance);
    
    // Step 3: Create final segments for pgRouting
    await this.createFinalSegments();
    
    // Get final count
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_segments`);
    return parseInt(finalCount.rows[0].count);
  }

  /**
   * Create intersection points with improved deduplication
   */
  private async createIntersectionPoints(tolerance: number, dedupTolerance: number): Promise<void> {
    console.log('   🔍 Creating intersection points with improved deduplication...');
    
    // Create intersection points table
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.t_intersections AS
      WITH exact_intersections AS (
        SELECT (ST_Dump(ST_Intersection(a.geometry, b.geometry))).geom AS geometry
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id < b.id
        WHERE ST_Crosses(a.geometry, b.geometry) -- Trails that cross each other
      ),
      tolerance_intersections AS (
        SELECT ST_ClosestPoint(a.geometry, b.geometry) AS geometry
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id < b.id
        WHERE ST_DWithin(a.geometry, b.geometry, ${tolerance}) -- Current tolerance
          AND NOT ST_Crosses(a.geometry, b.geometry)      -- But not exactly crossing
      ),
      endpoint_intersections AS (
        -- Detect when one trail's endpoint is very close to another trail's line
        SELECT ST_ClosestPoint(a.geometry, ST_EndPoint(b.geometry)) AS geometry
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id != b.id
        WHERE ST_DWithin(a.geometry, ST_EndPoint(b.geometry), ${tolerance}) -- Endpoint within tolerance
          AND NOT ST_Intersects(a.geometry, ST_EndPoint(b.geometry))  -- But not exactly intersecting
        UNION
        SELECT ST_ClosestPoint(a.geometry, ST_StartPoint(b.geometry)) AS geometry
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id != b.id
        WHERE ST_DWithin(a.geometry, ST_StartPoint(b.geometry), ${tolerance}) -- Startpoint within tolerance
          AND NOT ST_Intersects(a.geometry, ST_StartPoint(b.geometry))  -- But not exactly intersecting
      ),
      all_intersection_points AS (
        SELECT geometry FROM exact_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
        UNION ALL
        SELECT geometry FROM tolerance_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
        UNION ALL
        SELECT geometry FROM endpoint_intersections WHERE ST_GeometryType(geometry) = 'ST_Point'
      )
      SELECT DISTINCT ST_ClosestPoint(t.geometry, ip.geometry) AS geometry
      FROM all_intersection_points ip
      JOIN ${this.stagingSchema}.trails t ON ST_DWithin(t.geometry, ip.geometry, ${tolerance})
    `);

    // Add ST_Node intersection points
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.t_intersections (geometry)
      WITH trail_pairs AS (
        SELECT 
          a.id as trail_a_id,
          a.name as trail_a_name,
          a.geometry as trail_a_geom,
          b.id as trail_b_id,
          b.name as trail_b_name,
          b.geometry as trail_b_geom
        FROM ${this.stagingSchema}.trails a
        JOIN ${this.stagingSchema}.trails b ON a.id < b.id
        WHERE ST_DWithin(a.geometry, b.geometry, ${tolerance}) -- Only process trails within tolerance
      ),
      noded_intersections AS (
        SELECT 
          tp.trail_a_id,
          tp.trail_a_name,
          tp.trail_b_id,
          tp.trail_b_name,
          (ST_Dump(ST_Node(ST_UnaryUnion(ST_Collect(ARRAY[tp.trail_a_geom, tp.trail_b_geom]))))).geom AS intersection_point
        FROM trail_pairs tp
      ),
      valid_intersections AS (
        SELECT 
          trail_a_id,
          trail_a_name,
          trail_b_id,
          trail_b_name,
          intersection_point
        FROM noded_intersections
        WHERE ST_GeometryType(intersection_point) = 'ST_Point'
          AND ST_Intersects(intersection_point, (SELECT geometry FROM ${this.stagingSchema}.trails WHERE id = trail_a_id))
          AND ST_Intersects(intersection_point, (SELECT geometry FROM ${this.stagingSchema}.trails WHERE id = trail_b_id))
      )
      SELECT DISTINCT intersection_point AS geometry
      FROM valid_intersections
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.stagingSchema}.t_intersections existing
        WHERE ST_DWithin(existing.geometry, intersection_point, ${dedupTolerance}) -- Avoid duplicates
      )
    `);

    // Count raw intersection points
    const rawIntersectionCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.t_intersections`);
    console.log(`   📊 Created ${rawIntersectionCount.rows[0].count} raw intersection points`);

    // IMPROVED DEDUPLICATION: Use a more aggressive approach
    console.log('   🔧 Applying improved deduplication...');
    
    // Create deduplicated intersection points by selecting one point per grid cell
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.t_intersections_dedup AS
      SELECT DISTINCT ON (ST_SnapToGrid(geometry, ${dedupTolerance})) 
        geometry
      FROM ${this.stagingSchema}.t_intersections
      ORDER BY ST_SnapToGrid(geometry, ${dedupTolerance}), geometry
    `);
    
    await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.t_intersections`);
    await this.pgClient.query(`ALTER TABLE ${this.stagingSchema}.t_intersections_dedup RENAME TO t_intersections`);
    
    // Count deduplicated intersection points
    const dedupIntersectionCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.t_intersections`);
    console.log(`   📊 After deduplication: ${dedupIntersectionCount.rows[0].count} intersection points`);
    console.log(`   📊 Removed ${rawIntersectionCount.rows[0].count - dedupIntersectionCount.rows[0].count} duplicate points`);
  }

  /**
   * Split all trails at all intersections in one step (simplified approach)
   */
  private async splitAllTrailsAtIntersections(tolerance: number): Promise<void> {
    console.log('   🔗 Splitting all trails at all intersections...');
    
    // Create split table using the prototype's approach
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.split AS
      SELECT 
        b.id AS orig_id,
        b.name,
        b.id as original_trail_id,
        b.source,
        b.surface,
        b.difficulty,
        b.trail_type,
        'intersection_split' as split_type,
        0 as distance_to_main,
        dump.geom AS geom
      FROM ${this.stagingSchema}.trails b
      CROSS JOIN ${this.stagingSchema}.t_intersections ti,
      LATERAL ST_Dump(ST_Split(
        b.geometry,
        ti.geometry
      )) AS dump
      WHERE ST_GeometryType(dump.geom) = 'ST_LineString'
        AND ST_Length(dump.geom::geography) > 1
        AND ST_DWithin(dump.geom, ti.geometry, ${tolerance})  -- Only include segments near intersection points
    `);

    // Count final segments
    const segmentCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.split`);
    console.log(`   📊 All intersection splitting: ${segmentCount.rows[0].count} segments created`);
  }

  /**
   * Create final segments for pgRouting
   */
  private async createFinalSegments(): Promise<void> {
    console.log('   🔧 Creating final segments for pgRouting...');
    
    // Materialize clean segments with metadata (2D for pgRouting)
    console.log('   🔧 Materializing clean segments (2D for pgRouting)...');
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails_segments AS
      SELECT 
        row_number() OVER () AS id,
        orig_id as app_uuid,
        name,
        trail_type,
        ST_Length(geom::geography) / 1000.0 as length_km,
        0.0 as elevation_gain,
        0.0 as elevation_loss,
        surface,
        difficulty,
        split_type,
        distance_to_main,
        geom as the_geom
      FROM ${this.stagingSchema}.split
      WHERE GeometryType(geom) IN ('LINESTRING','MULTILINESTRING')
    `);

    // Toss micro-slivers
    console.log('   🔧 Removing micro-slivers...');
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails_segments
      WHERE length_km < 0.001  -- Remove segments shorter than 1 meter
    `);

    // Remove duplicate segments (same start and end points)
    console.log('   🔧 Removing duplicate segments...');
    await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails_segments
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY 
                     ST_AsText(ST_StartPoint(the_geom)),
                     ST_AsText(ST_EndPoint(the_geom))
                   ORDER BY id
                 ) as rn
          FROM ${this.stagingSchema}.trails_segments
        ) t
        WHERE t.rn > 1
      )
    `);

    // Add source/target columns for pgRouting
    console.log('   🔧 Adding pgRouting columns...');
    await this.pgClient.query(`
      ALTER TABLE ${this.stagingSchema}.trails_segments 
      ADD COLUMN source BIGINT,
      ADD COLUMN target BIGINT
    `);

    // Make it routable with pgRouting
    console.log('   🔧 Creating pgRouting topology...');
    
    try {
      const topologyResult = await this.pgClient.query(`
        SELECT pgr_createTopology('${this.stagingSchema}.trails_segments', 0.0001, 'the_geom', 'id', 'source', 'target')
      `);
      console.log(`   📊 Topology creation result: ${JSON.stringify(topologyResult.rows[0])}`);
    } catch (error) {
      console.log(`   ❌ Topology creation failed: ${(error as Error).message}`);
      
      // Try with a larger tolerance
      try {
        const topologyResult2 = await this.pgClient.query(`
          SELECT pgr_createTopology('${this.stagingSchema}.trails_segments', 0.001, 'the_geom', 'id', 'source', 'target')
        `);
        console.log(`   📊 Topology creation with larger tolerance: ${JSON.stringify(topologyResult2.rows[0])}`);
      } catch (error2) {
        console.log(`   ❌ Topology creation with larger tolerance also failed: ${(error2 as Error).message}`);
      }
    }

    // Check results
    console.log('   📊 Checking results...');
    
    const finalSegmentCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_segments`);
    console.log(`   📊 Total segments: ${finalSegmentCount.rows[0].count}`);

    // Check if topology was created successfully
    try {
      const vertexCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_segments_vertices_pgr`);
      console.log(`   📊 Total vertices: ${vertexCount.rows[0].count}`);

      const isolatedEdges = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${this.stagingSchema}.trails_segments 
        WHERE source IS NULL OR target IS NULL
      `);
      console.log(`   📊 Isolated edges: ${isolatedEdges.rows[0].count}`);
    } catch (error) {
      console.log(`   ⚠️ Topology not available: ${(error as Error).message}`);
    }
  }

  /**
   * Clean up trails (remove invalid geometries, short segments)
   */
  private async cleanupTrails(): Promise<number> {
    console.log('🧹 Cleaning up trails...');
    
    // Remove invalid geometries
    const invalidResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE geometry IS NULL OR NOT ST_IsValid(geometry)
    `);
    console.log(`   Removed ${invalidResult.rowCount || 0} invalid geometries`);

    // Remove very short segments (less than 1 meter)
    const shortResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_Length(geometry::geography) < 1.0
    `);
    console.log(`   Removed ${shortResult.rowCount || 0} short segments (< 1m)`);

    // Remove trails with too few points
    const fewPointsResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_NumPoints(geometry) < 2
    `);
    console.log(`   Removed ${fewPointsResult.rowCount || 0} trails with < 2 points`);

    // Fix "not simple" geometries (loops)
    const notSimpleResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_MakeValid(geometry)
      WHERE NOT ST_IsSimple(geometry)
    `);
    console.log(`   Fixed ${notSimpleResult.rowCount || 0} non-simple geometries`);

    // Get final count
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    console.log(`   Final trail count: ${finalCount.rows[0].count}`);
    
    return (invalidResult.rowCount || 0) + (shortResult.rowCount || 0) + (fewPointsResult.rowCount || 0);
  }

  /**
   * Analyze Layer 1 connectivity
   */
  private async analyzeLayer1Connectivity(): Promise<any> {
    console.log('🔍 Analyzing Layer 1 connectivity...');
    
    try {
      // Check if topology was created successfully
      const topologyExists = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = 'trails_segments_vertices_pgr'
        )
      `, [this.stagingSchema]);
      
      if (!topologyExists.rows[0].exists) {
        console.log('   ⚠️ No topology available for connectivity analysis');
        return { topologyCreated: false };
      }
      
      // Get connectivity metrics
      const vertexCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_segments_vertices_pgr`);
      const edgeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails_segments`);
      const isolatedEdges = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${this.stagingSchema}.trails_segments 
        WHERE source IS NULL OR target IS NULL
      `);
      
      const connectivityMetrics = {
        topologyCreated: true,
        vertices: parseInt(vertexCount.rows[0].count),
        edges: parseInt(edgeCount.rows[0].count),
        isolatedEdges: parseInt(isolatedEdges.rows[0].count),
        connectedEdges: parseInt(edgeCount.rows[0].count) - parseInt(isolatedEdges.rows[0].count)
      };
      
      console.log(`   📊 Connectivity metrics:`, connectivityMetrics);
      return connectivityMetrics;
      
    } catch (error) {
      console.error('   ❌ Error during connectivity analysis:', error);
      return { topologyCreated: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
