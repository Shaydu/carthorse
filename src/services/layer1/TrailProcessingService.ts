import { Pool } from 'pg';

export interface TrailProcessingConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  bbox?: number[];
  sourceFilter?: string;
  usePgRoutingSplitting?: boolean; // Use PgRoutingSplittingService instead of legacy splitting
  splittingMethod?: 'postgis' | 'pgrouting'; // 'postgis' for ST_Node, 'pgrouting' for modern pgRouting functions
}

export interface TrailProcessingResult {
  trailsCopied: number;
  trailsCleaned: number;
  gapsFixed: number;
  overlapsRemoved: number;
  trailsSplit: number;
  connectivityMetrics?: any; // Layer 1 connectivity analysis results
}

export class TrailProcessingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: TrailProcessingConfig;

  constructor(config: TrailProcessingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
    
    // Debug logging for configuration
    console.log('🔧 TrailProcessingService config:', {
      usePgRoutingSplitting: config.usePgRoutingSplitting,
      splittingMethod: config.splittingMethod,
      region: config.region,
      bbox: config.bbox
    });
  }

  /**
   * Process Layer 1: Clean trail network
   */
  async processTrails(): Promise<TrailProcessingResult> {
    console.log('🛤️ LAYER 1: TRAILS - Building clean trail network...');
    
    const result: TrailProcessingResult = {
      trailsCopied: 0,
      trailsCleaned: 0,
      gapsFixed: 0,
      overlapsRemoved: 0,
      trailsSplit: 0
    };

    // Step 1: Create staging environment
    await this.createStagingEnvironment();
    
    // Step 2: Copy trail data with bbox filter (no intersection detection during copy)
    result.trailsCopied = await this.copyTrailData();
    
    // Step 3: Detect and fix T-intersection gaps by snapping endpoints (after all trails are copied)
    console.log('🔍 About to call detectAndFixTIntersectionGaps()...');
    result.gapsFixed = await this.detectAndFixTIntersectionGaps();
    console.log(`🔍 detectAndFixTIntersectionGaps() completed with ${result.gapsFixed} gaps fixed`);
    
    // Step 3.5: Clean up geometries after T-intersection snapping to prevent linear intersection issues
    await this.cleanupGeometriesAfterSnapping();
    
    // Step 4: Clean up trails (remove invalid geometries, short segments)
    result.trailsCleaned = await this.cleanupTrails();
    
    // Step 4: Fill gaps in trail network (if enabled in config)
    result.gapsFixed = await this.fillTrailGaps();
    
    // Step 5: Remove duplicates/overlaps while preserving all trails
    result.overlapsRemoved = await this.deduplicateTrails();
    
    // Step 6: Split trails at all intersections
    result.trailsSplit = await this.splitTrailsAtIntersections();
    
    // Step 7: Deduplicate overlapping trail segments (ensure each coordinate is covered by only one trail)
    result.overlapsRemoved += await this.deduplicateOverlappingTrails();
    
    // Step 8: Analyze Layer 1 connectivity - looking for near misses and spatial relationships
    result.connectivityMetrics = await this.analyzeLayer1Connectivity();
    
    console.log('✅ LAYER 1 COMPLETE: Clean trail network ready');
    console.log(`📊 Layer 1 Results: ${result.trailsCopied} trails copied, ${result.trailsCleaned} cleaned, ${result.gapsFixed} gaps fixed, ${result.overlapsRemoved} overlaps removed, ${result.trailsSplit} trails split at intersections`);
    
    return result;
  }

  /**
   * Create staging environment
   */
  private async createStagingEnvironment(): Promise<void> {
    console.log('🏗️ Creating staging environment...');
    
    // Create staging schema if it doesn't exist
    await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${this.stagingSchema}`);
    
    // Drop and recreate trails table in staging schema - use 3D geometry to preserve elevation data
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.stagingSchema}.trails`);
    await this.pgClient.query(`
      CREATE TABLE ${this.stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        old_id INTEGER,
        app_uuid TEXT,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        region TEXT,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        source TEXT,
        source_tags JSONB,
        osm_id TEXT
      )
    `);
    
    // Create spatial index
    await this.pgClient.query(`CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_geom ON ${this.stagingSchema}.trails USING GIST(geometry)`);
    
    console.log(`✅ Staging environment created: ${this.stagingSchema}.trails`);
  }

  /**
   * Copy trail data with bbox filter and intersection detection
   */
  private async copyTrailData(): Promise<number> {
    console.log('📊 Copying trail data with intersection detection...');
    
    let bboxParams: any[] = [];
    let bboxFilter = '';
    let bboxFilterWithAlias = '';
    
    if (this.config.bbox && this.config.bbox.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = this.config.bbox;
      
      // Expand bbox by 0.01 degrees (~1km) to include connected trail segments
      const expansion = 0.01;
      const expandedMinLng = minLng - expansion;
      const expandedMaxLng = maxLng + expansion;
      const expandedMinLat = minLat - expansion;
      const expandedMaxLat = maxLat + expansion;
      
      bboxParams = [expandedMinLng, expandedMinLat, expandedMaxLng, expandedMaxLat];
      bboxFilter = `AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      bboxFilterWithAlias = `AND p.geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      
      console.log(`🗺️ Using expanded bbox filter: [${expandedMinLng}, ${expandedMinLat}, ${expandedMaxLng}, ${expandedMaxLat}] (original: [${minLng}, ${minLat}, ${maxLng}, ${maxLat}])`);
    } else {
      console.log('🗺️ Using region filter (no bbox specified)');
      bboxFilter = `AND region = $1`;
      bboxFilterWithAlias = `AND p.region = $1`;
      bboxParams = [this.config.region];
    }
    
    // Add source filter if specified
    let sourceFilter = '';
    let sourceParams: any[] = [];
    if (this.config.sourceFilter) {
      sourceFilter = `AND source = $${bboxParams.length + 1}`;
      sourceParams = [this.config.sourceFilter];
      console.log(`🔍 Using source filter: ${this.config.sourceFilter}`);
    }

    // First, check how many trails should be copied
    const expectedTrailsQuery = `
      SELECT COUNT(*) as count FROM public.trails 
      WHERE geometry IS NOT NULL ${bboxFilter} ${sourceFilter}
    `;
    const expectedTrailsResult = await this.pgClient.query(expectedTrailsQuery, [...bboxParams, ...sourceParams]);
    const expectedCount = parseInt(expectedTrailsResult.rows[0].count);
    console.log(`📊 Expected trails to copy: ${expectedCount}`);

    // Create intersection detection table with proper 3D support
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.intersection_points (
        id SERIAL PRIMARY KEY,
        intersection_point GEOMETRY(POINT, 4326),
        intersection_point_3d GEOMETRY(POINTZ, 4326),
        connected_trail_ids TEXT[],
        connected_trail_names TEXT[],
        node_type TEXT,
        distance_meters DOUBLE PRECISION
      )
    `);

    // Copy trails one by one and detect intersections
    const trailsQuery = `
      SELECT app_uuid, name, trail_type, surface, difficulty,
             geometry, length_km, elevation_gain, elevation_loss,
             max_elevation, min_elevation, avg_elevation, region,
             bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
             source, source_tags, osm_id
      FROM public.trails
      WHERE geometry IS NOT NULL ${bboxFilter} ${sourceFilter}
      ORDER BY app_uuid
    `;
    
    const trailsResult = await this.pgClient.query(trailsQuery, [...bboxParams, ...sourceParams]);
    const trails = trailsResult.rows;
    
    let copiedCount = 0;
    let intersectionCount = 0;
    
    for (const trail of trails) {
      // Insert the trail
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, trail_type, surface, difficulty,
          geometry, length_km, elevation_gain, elevation_loss,
          max_elevation, min_elevation, avg_elevation, region,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        ) VALUES ($1, $2, $3, $4, $5, ST_Force3D($6), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      `, [
        trail.app_uuid, trail.name, trail.trail_type, trail.surface, trail.difficulty,
        trail.geometry, trail.length_km, trail.elevation_gain, trail.elevation_loss,
        trail.max_elevation, trail.min_elevation, trail.avg_elevation, trail.region,
        trail.bbox_min_lng, trail.bbox_max_lng, trail.bbox_min_lat, trail.bbox_max_lat,
        trail.source, trail.source_tags, trail.osm_id
      ]);
      
      copiedCount++;
      
      // Enhanced intersection detection with proper T/Y intersection identification
      const intersectionQuery = `
        WITH current_trail AS (
          SELECT $1::text as app_uuid, $2 as name, $3 as geometry
        ),
        existing_trails AS (
          SELECT app_uuid, name, geometry 
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid != $1::text
        ),
        true_intersections AS (
          SELECT 
            ST_Force2D(ST_Intersection(ct.geometry::geometry, et.geometry::geometry)) as intersection_point,
            ST_Force3D(ST_Intersection(ct.geometry::geometry, et.geometry::geometry)) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            'intersection' as node_type,
            0.0 as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_Intersects(ct.geometry::geometry, et.geometry::geometry)
          WHERE ST_GeometryType(ST_Intersection(ct.geometry::geometry, et.geometry::geometry)) = 'ST_Point'
        ),
        t_intersections AS (
          -- T-intersections: where trail endpoints are close to other trails
          SELECT 
            ST_Force2D(ST_ClosestPoint(ct.geometry::geometry, ST_StartPoint(et.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(ct.geometry::geometry, ST_StartPoint(et.geometry::geometry))) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            't_intersection' as node_type,
            ST_Distance(ct.geometry::geography, ST_StartPoint(et.geometry)::geography) as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_DWithin(ct.geometry::geography, ST_StartPoint(et.geometry)::geography, $4)
          WHERE ST_Distance(ct.geometry::geography, ST_StartPoint(et.geometry)::geography) > 0
            AND ST_Distance(ct.geometry::geography, ST_StartPoint(et.geometry)::geography) <= $4
          UNION ALL
          SELECT 
            ST_Force2D(ST_ClosestPoint(ct.geometry::geometry, ST_EndPoint(et.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(ct.geometry::geometry, ST_EndPoint(et.geometry::geometry))) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            't_intersection' as node_type,
            ST_Distance(ct.geometry::geography, ST_EndPoint(et.geometry)::geography) as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_DWithin(ct.geometry::geography, ST_EndPoint(et.geometry)::geography, $4)
          WHERE ST_Distance(ct.geometry::geography, ST_EndPoint(et.geometry)::geography) > 0
            AND ST_Distance(ct.geometry::geography, ST_EndPoint(et.geometry)::geography) <= $4
          UNION ALL
          -- Also check if current trail's endpoints are close to existing trails
          SELECT 
            ST_Force2D(ST_ClosestPoint(et.geometry::geometry, ST_StartPoint(ct.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(et.geometry::geometry, ST_StartPoint(ct.geometry::geometry))) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            't_intersection' as node_type,
            ST_Distance(et.geometry::geography, ST_StartPoint(ct.geometry)::geography) as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_DWithin(et.geometry::geography, ST_StartPoint(ct.geometry)::geography, $4)
          WHERE ST_Distance(et.geometry::geography, ST_StartPoint(ct.geometry)::geography) > 0
            AND ST_Distance(et.geometry::geography, ST_StartPoint(ct.geometry)::geography) <= $4
          UNION ALL
          SELECT 
            ST_Force2D(ST_ClosestPoint(et.geometry::geometry, ST_EndPoint(ct.geometry::geometry))) as intersection_point,
            ST_Force3D(ST_ClosestPoint(et.geometry::geometry, ST_EndPoint(ct.geometry::geometry))) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            't_intersection' as node_type,
            ST_Distance(et.geometry::geography, ST_EndPoint(ct.geometry)::geography) as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_DWithin(et.geometry::geography, ST_EndPoint(ct.geometry)::geography, $4)
          WHERE ST_Distance(et.geometry::geography, ST_EndPoint(ct.geometry)::geography) > 0
            AND ST_Distance(et.geometry::geography, ST_EndPoint(ct.geometry)::geography) <= $4
        ),
        y_intersections AS (
          -- Y-intersections: where trails meet at acute angles (not perpendicular)
          SELECT 
            ST_Force2D(ST_Intersection(ct.geometry::geometry, et.geometry::geometry)) as intersection_point,
            ST_Force3D(ST_Intersection(ct.geometry::geometry, et.geometry::geometry)) as intersection_point_3d,
            ARRAY[ct.app_uuid, et.app_uuid] as connected_trail_ids,
            ARRAY[ct.name, et.name] as connected_trail_names,
            'y_intersection' as node_type,
            0.0 as distance_meters
          FROM current_trail ct
          JOIN existing_trails et ON ST_Intersects(ct.geometry::geometry, et.geometry::geometry)
          WHERE ST_GeometryType(ST_Intersection(ct.geometry::geometry, et.geometry::geometry)) = 'ST_Point'
            AND ABS(ST_Azimuth(ST_StartPoint(ct.geometry), ST_EndPoint(ct.geometry)) - 
                   ST_Azimuth(ST_StartPoint(et.geometry), ST_EndPoint(et.geometry))) BETWEEN 15 AND 165
        )
        SELECT * FROM true_intersections
        UNION ALL
        SELECT * FROM t_intersections
        UNION ALL
        SELECT * FROM y_intersections
      `;
      
      // Load Layer 1 configuration for tolerances
      const { loadConfig } = await import('../../utils/config-loader');
      const config = loadConfig();
      
      const intersectionConfig = config.layer1_trails.intersectionDetection;
      const toleranceMeters = intersectionConfig.tIntersectionToleranceMeters;
      const intersectionResult = await this.pgClient.query(intersectionQuery, [
        trail.app_uuid, trail.name, trail.geometry, toleranceMeters
      ]);
      
      // Insert detected intersections with proper column mapping
      for (const intersection of intersectionResult.rows) {
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.intersection_points (
            intersection_point, intersection_point_3d, connected_trail_ids, 
            connected_trail_names, node_type, distance_meters
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          intersection.intersection_point,        // 2D geometry
          intersection.intersection_point_3d,     // 3D geometry
          intersection.connected_trail_ids,
          intersection.connected_trail_names,
          intersection.node_type,
          intersection.distance_meters
        ]);
        intersectionCount++;
      }
      
      if (copiedCount % 100 === 0) {
        console.log(`   📊 Progress: ${copiedCount}/${trails.length} trails copied, ${intersectionCount} intersections detected`);
      }
    }
    
    console.log(`📊 Copy result: ${copiedCount} trails copied, ${intersectionCount} intersections detected`);
    return copiedCount;
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
   * Fill gaps in trail network (using configurable settings)
   */
  private async fillTrailGaps(): Promise<number> {
    console.log('🔗 Filling gaps in trail network...');
    
    try {
      // Load route discovery configuration
      const { RouteDiscoveryConfigLoader } = await import('../../config/route-discovery-config-loader');
      const routeConfig = RouteDiscoveryConfigLoader.getInstance().loadConfig();
      
      // Check if gap filling is disabled
      if (routeConfig.trailGapFilling.toleranceMeters <= 0 || routeConfig.trailGapFilling.maxConnectors <= 0) {
        console.log('   ⏭️ Gap filling disabled in config - skipping connector creation');
        console.log('   ✅ Trail gap filling completed (disabled)');
        return 0;
      }
      
      // Use the existing TrailGapFillingService
      const { TrailGapFillingService } = await import('../../utils/services/network-creation/trail-gap-filling-service');
      const trailGapService = new TrailGapFillingService(this.pgClient, this.stagingSchema);
      
      // Get gap filling configuration from route discovery config
      const gapConfig = {
        toleranceMeters: routeConfig.trailGapFilling.toleranceMeters,
        maxConnectorsToCreate: routeConfig.trailGapFilling.maxConnectors,
        minConnectorLengthMeters: routeConfig.trailGapFilling.minConnectorLengthMeters
      };
      
      console.log(`   🔍 Gap filling config: ${gapConfig.toleranceMeters}m tolerance, max ${gapConfig.maxConnectorsToCreate} connectors`);
      
      const gapResult = await trailGapService.detectAndFillTrailGaps(gapConfig);
      console.log(`   ✅ Trail gap filling completed: ${gapResult.connectorTrailsCreated} connectors created`);
      
      return gapResult.connectorTrailsCreated;
      
    } catch (error) {
      console.error('   ❌ Error during trail gap filling:', error);
      return 0;
    }
  }

  /**
   * Remove duplicates/overlaps while preserving all trails
   */
  private async deduplicateTrails(): Promise<number> {
    console.log('🔄 Removing duplicate trails...');
    
    try {
      const { TrailDeduplicationService } = await import('../../utils/services/network-creation/trail-deduplication-service');
      const dedupService = new TrailDeduplicationService(this.pgClient, this.stagingSchema);
      
      const duplicatesRemoved = await dedupService.deduplicateTrails();
      console.log(`   🗑️ Removed ${duplicatesRemoved} duplicate trails`);
      
      // Get final stats
      const stats = await dedupService.getTrailStats();
      console.log(`   📊 Final trail stats: ${stats.totalTrails} trails, ${stats.totalLength.toFixed(3)}km total length`);
      
      return duplicatesRemoved;
      
    } catch (error) {
      console.error('   ❌ Error during trail deduplication:', error);
      return 0;
    }
  }

  /**
   * Split trails at intersections using either modern PostGIS ST_Node() or legacy approach
   */
  private async splitTrailsAtIntersections(): Promise<number> {
    console.log('🔗 Splitting trails at all intersections...');
    
    // Check if PgRoutingSplitting is enabled
    if (this.config.usePgRoutingSplitting) {
      console.log('   🚀 Using PgRoutingSplittingService approach...');
      return await this.splitTrailsWithModernApproach();
    } else {
      console.log('   🔄 Using legacy splitting approach...');
      return await this.splitTrailsWithLegacyApproach();
    }
  }

  /**
   * PgRouting splitting approach using PgRoutingSplittingService
   */
  private async splitTrailsWithModernApproach(): Promise<number> {
    try {
      const { PgRoutingSplittingService } = await import('./PgRoutingSplittingService');
      
      // Load Layer 1 config to get proper tolerance settings
      const { loadConfig } = await import('../../utils/config-loader');
      const config = loadConfig();
      const intersectionTolerance = config.layer1_trails?.intersectionDetection?.trueIntersectionToleranceMeters ?? 1.0;
      
      console.log(`   🔧 Using intersection tolerance from Layer 1 config: ${intersectionTolerance}m`);
      
      const splittingService = new PgRoutingSplittingService({
        stagingSchema: this.stagingSchema,
        pgClient: this.pgClient,
        toleranceMeters: 0.00001, // ~1 meter in degrees
        minSegmentLengthMeters: 1.0,
        preserveOriginalTrails: false,
        intersectionTolerance: intersectionTolerance // Use tolerance from Layer 1 config
      });

      // Use the specified splitting method
      let result;
      if (this.config.splittingMethod === 'postgis') {
        // Use PostGIS ST_Node approach
        result = await splittingService.splitTrailsAtIntersections();
      } else {
        // Default to pgRouting functions (better for near-miss scenarios)
        result = await splittingService.splitTrailsWithPgRouting();
      }

      if (!result.success) {
        throw new Error(`PgRouting splitting failed: ${result.error}`);
      }

      // Detect intersection points for analysis
      await splittingService.detectIntersectionPoints();

      // Get statistics
      const stats = await splittingService.getSplitStatistics();
      console.log(`   📊 PgRouting splitting statistics:`, stats);

      return result.splitSegmentCount;

    } catch (error) {
      console.error('   ❌ Error during PgRouting trail splitting:', error);
      throw error;
    }
  }

  /**
   * Legacy splitting approach (original implementation)
   */
  private async splitTrailsWithLegacyApproach(): Promise<number> {
    try {
      // Get initial trail count
      const initialCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      const initialCount = parseInt(initialCountResult.rows[0].count);
      
      console.log(`   📊 Initial trails: ${initialCount}`);
      
      // Step 1: Create backup of original trails
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_backup AS 
        SELECT * FROM ${this.stagingSchema}.trails
      `);
      
      // Step 2: First, handle true intersections (Y-intersections) using ST_Node
      console.log('   🔗 Step 1: Splitting at true intersections (Y-intersections)...');
      
      // Ensure all lines are single LINESTRINGs
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_exploded AS
        SELECT 
          (ST_Dump(geometry)).geom AS geometry,
          id,
          app_uuid,
          osm_id,
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
          source_tags
        FROM ${this.stagingSchema}.trails_backup
      `);
      
      // Split at true intersections using ST_Node
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_split_step1 AS
        SELECT 
          (ST_Dump(ST_Node(ST_Union(geometry)))).geom AS geometry
        FROM ${this.stagingSchema}.trails_exploded
      `);
      
      // Add metadata to step 1 results
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.trails_split_step1 
        ADD COLUMN id SERIAL PRIMARY KEY,
        ADD COLUMN app_uuid TEXT,
        ADD COLUMN osm_id TEXT,
        ADD COLUMN name TEXT,
        ADD COLUMN region TEXT,
        ADD COLUMN trail_type TEXT,
        ADD COLUMN surface TEXT,
        ADD COLUMN difficulty TEXT,
        ADD COLUMN length_km DOUBLE PRECISION,
        ADD COLUMN elevation_gain DOUBLE PRECISION,
        ADD COLUMN elevation_loss DOUBLE PRECISION,
        ADD COLUMN max_elevation DOUBLE PRECISION,
        ADD COLUMN min_elevation DOUBLE PRECISION,
        ADD COLUMN avg_elevation DOUBLE PRECISION,
        ADD COLUMN bbox_min_lng DOUBLE PRECISION,
        ADD COLUMN bbox_max_lng DOUBLE PRECISION,
        ADD COLUMN bbox_min_lat DOUBLE PRECISION,
        ADD COLUMN bbox_max_lat DOUBLE PRECISION,
        ADD COLUMN source TEXT,
        ADD COLUMN source_tags JSONB,
        ADD COLUMN split_length_km DOUBLE PRECISION
      `);
      
      // Calculate lengths for step 1
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.trails_split_step1 
        SET split_length_km = ST_Length(geometry::geography) / 1000.0
        WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = 'ST_LineString'
      `);
      
      // Step 3: Now handle T-intersections by splitting at proximity points
      console.log('   🔗 Step 2: Splitting at T-intersections (proximity points)...');
      
      // Get T-intersection points from our intersection_points table
      const tIntersectionResult = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${this.stagingSchema}.intersection_points 
        WHERE node_type = 't_intersection'
      `);
      const tIntersectionCount = parseInt(tIntersectionResult.rows[0].count);
      console.log(`   📊 Found ${tIntersectionCount} T-intersection points`);
      
      if (tIntersectionCount > 0) {
        // Split trails at T-intersection points
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails_split_step2 AS
          WITH t_intersection_points AS (
            SELECT 
              intersection_point_3d as point,
              connected_trail_ids,
              node_type
            FROM ${this.stagingSchema}.intersection_points
            WHERE node_type = 't_intersection' AND intersection_point_3d IS NOT NULL
          ),
          split_at_t_intersections AS (
            SELECT 
              t.id,
              t.app_uuid,
              t.osm_id,
              t.name,
              t.region,
              t.trail_type,
              t.surface,
              t.difficulty,
              t.length_km,
              t.elevation_gain,
              t.elevation_loss,
              t.max_elevation,
              t.min_elevation,
              t.avg_elevation,
              t.bbox_min_lng,
              t.bbox_max_lng,
              t.bbox_min_lat,
              t.bbox_max_lat,
              t.source,
              t.source_tags,
              (ST_Dump(ST_Split(t.geometry, ip.point))).geom as split_geometry,
              (ST_Dump(ST_Split(t.geometry, ip.point))).path[1] as segment_order,
              ip.node_type
            FROM ${this.stagingSchema}.trails_split_step1 t
            JOIN t_intersection_points ip ON t.app_uuid = ANY(ip.connected_trail_ids)
            WHERE ST_IsValid(t.geometry) AND ST_GeometryType(t.geometry) = 'ST_LineString'
          ),
          unsplit_trails AS (
            SELECT 
              t.id,
              t.app_uuid,
              t.osm_id,
              t.name,
              t.region,
              t.trail_type,
              t.surface,
              t.difficulty,
              t.length_km,
              t.elevation_gain,
              t.elevation_loss,
              t.max_elevation,
              t.min_elevation,
              t.avg_elevation,
              t.bbox_min_lng,
              t.bbox_max_lng,
              t.bbox_min_lat,
              t.bbox_max_lat,
              t.source,
              t.source_tags,
              t.geometry as split_geometry,
              1 as segment_order,
              'no_t_intersection' as node_type
            FROM ${this.stagingSchema}.trails_split_step1 t
            WHERE t.app_uuid NOT IN (
              SELECT DISTINCT unnest(connected_trail_ids) 
              FROM ${this.stagingSchema}.intersection_points 
              WHERE node_type = 't_intersection'
            )
          )
          SELECT 
            gen_random_uuid() as new_app_uuid,
            id,
            app_uuid as original_app_uuid,
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
            split_geometry as geometry,
            segment_order,
            node_type,
            ST_Length(split_geometry::geography) as segment_length_meters
          FROM (
            SELECT * FROM split_at_t_intersections
            UNION ALL
            SELECT * FROM unsplit_trails
          ) all_segments
          WHERE ST_IsValid(split_geometry)
            AND ST_GeometryType(split_geometry) = 'ST_LineString'
            AND ST_Length(split_geometry::geography) >= 1.0  -- Minimum 1 meter
          ORDER BY original_app_uuid, segment_order
        `);
        
        // Replace trails table with final split segments
        await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails`);
        
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails AS
          SELECT 
            new_app_uuid as app_uuid,
            id,
            original_app_uuid,
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
            geometry,
            segment_length_meters / 1000.0 as length_km
          FROM ${this.stagingSchema}.trails_split_step2
        `);
        
        // Clean up step 2 table
        await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_split_step2`);
      } else {
        // No T-intersections, just use step 1 results
        await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails`);
        
        await this.pgClient.query(`
          CREATE TABLE ${this.stagingSchema}.trails AS
          SELECT 
            gen_random_uuid() as app_uuid,
            id,
            app_uuid as original_app_uuid,
            name,
            region,
            trail_type,
            surface,
            difficulty,
            split_length_km as length_km,
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
          FROM ${this.stagingSchema}.trails_split_step1
          WHERE ST_IsValid(geometry) 
            AND ST_GeometryType(geometry) = 'ST_LineString'
            AND split_length_km > 0.001  -- Filter out segments shorter than 1 meter
        `);
      }
      
      // Step 4: Clean up temporary tables
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_exploded`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_split_step1`);
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_backup`);
      
      // Get final count
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      const finalCount = parseInt(finalCountResult.rows[0].count);
      
      const segmentsCreated = finalCount - initialCount;
      console.log(`   ✅ Trail splitting complete: ${initialCount} → ${finalCount} segments (+${segmentsCreated})`);
      
      return segmentsCreated;
      
    } catch (error) {
      console.error('   ❌ Error during trail splitting:', error);
      throw error;
    }
  }



  /**
   * Deduplicate overlapping trail segments to ensure each coordinate is covered by only one trail
   */
  private async deduplicateOverlappingTrails(): Promise<number> {
    console.log('🔄 Deduplicating overlapping trail segments...');
    
    try {
      // Get initial count
      const initialCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      const initialCount = parseInt(initialCountResult.rows[0].count);
      
      // Create backup of current trails
      await this.pgClient.query(`
        CREATE TABLE ${this.stagingSchema}.trails_backup_2 AS 
        SELECT * FROM ${this.stagingSchema}.trails
      `);
      
      // Find and remove overlapping segments, keeping the best representative for each unique geometry
      const deduplicationResult = await this.pgClient.query(`
        WITH overlapping_segments AS (
          -- Find segments that have any overlap
          SELECT 
            t1.app_uuid as trail1_id,
            t1.name as trail1_name,
            t1.geometry as trail1_geom,
            ST_Length(t1.geometry::geography) as trail1_length,
            t2.app_uuid as trail2_id,
            t2.name as trail2_name,
            t2.geometry as trail2_geom,
            ST_Length(t2.geometry::geography) as trail2_length,
            ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length
          FROM ${this.stagingSchema}.trails_backup_2 t1
          JOIN ${this.stagingSchema}.trails_backup_2 t2 ON t1.app_uuid < t2.app_uuid
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) > 0
        ),
        segments_to_remove AS (
          -- For each overlapping pair, decide which one to keep
          SELECT DISTINCT
            CASE 
              -- Keep the longer segment, or if same length, keep the one with better name
              WHEN trail1_length > trail2_length THEN trail2_id
              WHEN trail2_length > trail1_length THEN trail1_id
              WHEN trail1_name < trail2_name THEN trail2_id  -- Alphabetical tiebreaker
              ELSE trail1_id
            END as remove_id
          FROM overlapping_segments
        )
        SELECT COUNT(*) as duplicates_found
        FROM segments_to_remove
      `);
      
      const duplicatesFound = parseInt(deduplicationResult.rows[0].duplicates_found);
      
      if (duplicatesFound > 0) {
        // Remove duplicate segments
        await this.pgClient.query(`
          WITH overlapping_segments AS (
            SELECT 
              t1.app_uuid as trail1_id,
              t1.name as trail1_name,
              t1.geometry as trail1_geom,
              ST_Length(t1.geometry::geography) as trail1_length,
              t2.app_uuid as trail2_id,
              t2.name as trail2_name,
              t2.geometry as trail2_geom,
              ST_Length(t2.geometry::geography) as trail2_length,
              ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) as overlap_length
            FROM ${this.stagingSchema}.trails_backup_2 t1
            JOIN ${this.stagingSchema}.trails_backup_2 t2 ON t1.app_uuid < t2.app_uuid
            WHERE ST_Intersects(t1.geometry, t2.geometry)
              AND ST_Length(ST_Intersection(t1.geometry, t2.geometry)::geography) > 0
          ),
          segments_to_remove AS (
            SELECT DISTINCT
              CASE 
                WHEN trail1_length > trail2_length THEN trail2_id
                WHEN trail2_length > trail1_length THEN trail1_id
                WHEN trail1_name < trail2_name THEN trail2_id
                ELSE trail1_id
              END as remove_id
            FROM overlapping_segments
          )
          DELETE FROM ${this.stagingSchema}.trails 
          WHERE app_uuid IN (SELECT remove_id FROM segments_to_remove)
        `);
        
        console.log(`   🗑️ Removed ${duplicatesFound} overlapping segments`);
      } else {
        console.log(`   ✅ No overlapping segments found`);
      }
      
      // Get final count
      const finalCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
      `);
      const finalCount = parseInt(finalCountResult.rows[0].count);
      
      // Clean up backup table
      await this.pgClient.query(`DROP TABLE ${this.stagingSchema}.trails_backup_2`);
      
      const removed = initialCount - finalCount;
      console.log(`   📊 Overlap deduplication: ${initialCount} → ${finalCount} segments (removed ${removed})`);
      
      return removed;
      
    } catch (error) {
      console.error('   ❌ Error during overlap deduplication:', error);
      throw error;
    }
  }

  /**
   * Analyze Layer 1 connectivity using pgRouting tools
   */
  private async analyzeLayer1Connectivity(): Promise<any> {
    try {
      const { PgRoutingConnectivityAnalysisService } = await import('../../utils/services/network-creation/pgrouting-connectivity-analysis-service');
      const client = await this.pgClient.connect();
      const connectivityService = new PgRoutingConnectivityAnalysisService(this.stagingSchema, client);
      
      const metrics = await connectivityService.analyzeLayer1Connectivity();
      
      console.log('📊 LAYER 1 SPATIAL RELATIONSHIP ANALYSIS:');
      console.log(`   🛤️ Total trails: ${metrics.totalTrails}`);
      console.log(`   🔗 Trail intersections: ${metrics.intersectionCount}`);
      console.log(`   🏝️ Isolated trails: ${metrics.isolatedTrails}`);
      console.log(`   📊 Connectivity percentage: ${metrics.connectivityPercentage.toFixed(2)}%`);
      console.log(`   📏 Total trail network length: ${metrics.totalTrailNetworkLength.toFixed(2)}km`);
      console.log(`   🏔️ Total elevation gain: ${metrics.totalElevationGain.toFixed(1)}m`);
      console.log(`   📉 Total elevation loss: ${metrics.totalElevationLoss.toFixed(1)}m`);
      console.log(`   📏 Max trail length: ${metrics.maxTrailLength.toFixed(2)}km`);
      console.log(`   📏 Min trail length: ${metrics.minTrailLength.toFixed(2)}km`);
      console.log(`   🎯 NEAR MISSES: ${metrics.nearMisses} endpoint pairs within 100m (avg: ${metrics.avgNearMissDistance.toFixed(1)}m)`);
      console.log(`   🔄 NEARLY INTERSECTING: ${metrics.nearlyIntersecting} trail pairs within 500m (avg: ${metrics.avgNearlyIntersectingDistance.toFixed(1)}m)`);
      console.log(`   📍 ENDPOINT PROXIMITY: ${metrics.endpointProximity} endpoints near other trails (avg: ${metrics.avgEndpointProximityDistance.toFixed(1)}m)`);
      
      // Display trail type distribution if available
      if (metrics.details?.trailTypeDistribution && Object.keys(metrics.details.trailTypeDistribution).length > 0) {
        console.log(`   🏷️ Trail type distribution:`);
        Object.entries(metrics.details.trailTypeDistribution)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 5)
          .forEach(([type, count]) => {
            console.log(`      ${type}: ${count} trails`);
          });
      }
      
      // Display difficulty distribution if available
      if (metrics.details?.difficultyDistribution && Object.keys(metrics.details.difficultyDistribution).length > 0) {
        console.log(`   ⚡ Difficulty distribution:`);
        Object.entries(metrics.details.difficultyDistribution)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 5)
          .forEach(([difficulty, count]) => {
            console.log(`      ${difficulty}: ${count} trails`);
          });
      }
      
      return metrics;
      
    } catch (error) {
      console.error('   ❌ Error during Layer 1 connectivity analysis:', error);
      return null;
    }
  }

  /**
   * Detect and fix T-intersection gaps by snapping trail endpoints to nearby trails
   * This method ONLY does snapping - splitting is handled separately in splitTrailsAtIntersections
   */
  private async detectAndFixTIntersectionGaps(): Promise<number> {
    console.log('🔗 Detecting and fixing T-intersection gaps by snapping endpoints...');
    console.log(`🔍 Method called with staging schema: ${this.stagingSchema}`);
    
    try {
      // Create intersection detection table with proper 3D support
      await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.stagingSchema}.intersection_points (
          id SERIAL PRIMARY KEY,
          intersection_point GEOMETRY(POINT, 4326),
          intersection_point_3d GEOMETRY(POINTZ, 4326),
          connected_trail_ids TEXT[],
          connected_trail_names TEXT[],
          node_type TEXT,
          distance_meters DOUBLE PRECISION
        )
      `);

      // Load Layer 1 configuration for tolerances
      const { loadConfig } = await import('../../utils/config-loader');
      const config = loadConfig();
      const toleranceMeters = config.layer1_trails.intersectionDetection.tIntersectionToleranceMeters;
      
      console.log(`   📏 Using T-intersection tolerance: ${toleranceMeters}m`);
      
      // Check how many trails we have to work with
      const trailCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = 'ST_LineString'
      `);
      console.log(`   📊 Found ${trailCountResult.rows[0].count} valid trails in staging schema`);
      
      // Find trail endpoints that are close to other trails (T-intersection candidates)
      const tIntersectionGapsResult = await this.pgClient.query(`
        WITH trail_endpoints AS (
          -- Get start and end points of all trails
          SELECT 
            app_uuid,
            name,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point,
            geometry as trail_geometry
          FROM ${this.stagingSchema}.trails
          WHERE ST_IsValid(geometry) AND ST_GeometryType(geometry) = 'ST_LineString'
        ),
        endpoint_to_trail_gaps AS (
          -- Find endpoints that are close to other trails (but not their own trail)
          SELECT 
            e1.app_uuid as endpoint_trail_id,
            e1.name as endpoint_trail_name,
            e1.start_point as endpoint_point,
            'start' as endpoint_type,
            e2.app_uuid as target_trail_id,
            e2.name as target_trail_name,
            e2.trail_geometry as target_trail_geometry,
            ST_Distance(e1.start_point::geography, e2.trail_geometry::geography) as distance_meters,
            ST_ClosestPoint(e2.trail_geometry, e1.start_point) as closest_point_on_target
          FROM trail_endpoints e1
          JOIN trail_endpoints e2 ON e1.app_uuid != e2.app_uuid
          WHERE ST_DWithin(e1.start_point::geography, e2.trail_geometry::geography, $1)
            AND ST_Distance(e1.start_point::geography, e2.trail_geometry::geography) > 0
            AND ST_Distance(e1.start_point::geography, e2.trail_geometry::geography) <= $1
          
          UNION ALL
          
          SELECT 
            e1.app_uuid as endpoint_trail_id,
            e1.name as endpoint_trail_name,
            e1.end_point as endpoint_point,
            'end' as endpoint_type,
            e2.app_uuid as target_trail_id,
            e2.name as target_trail_name,
            e2.trail_geometry as target_trail_geometry,
            ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) as distance_meters,
            ST_ClosestPoint(e2.trail_geometry, e1.end_point) as closest_point_on_target
          FROM trail_endpoints e1
          JOIN trail_endpoints e2 ON e1.app_uuid != e2.app_uuid
          WHERE ST_DWithin(e1.end_point::geography, e2.trail_geometry::geography, $1)
            AND ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) > 0
            AND ST_Distance(e1.end_point::geography, e2.trail_geometry::geography) <= $1
        )
        SELECT * FROM endpoint_to_trail_gaps
        ORDER BY distance_meters ASC
      `, [toleranceMeters]);

      console.log(`   📊 Found ${tIntersectionGapsResult.rowCount} T-intersection gap candidates`);
      
      if (tIntersectionGapsResult.rowCount === 0) {
        console.log('   ✅ No T-intersection gaps found');
        return 0;
      }

      let gapsFixed = 0;
      const processedTrails = new Set<string>();

      for (const gap of tIntersectionGapsResult.rows) {
        const visitorTrailId = gap.endpoint_trail_id;
        const endpointType = gap.endpoint_type;
        const intersectionPoint = gap.closest_point_on_target;

        // Skip if we've already processed this trail
        if (processedTrails.has(visitorTrailId)) {
          continue;
        }

        // Snap the visitor trail endpoint to the intersection point
        console.log(`   🔧 Snapping visitor trail "${gap.endpoint_trail_name}" endpoint to intersection point`);
        
        // Get the snapped geometry for the visitor trail
        const snappedVisitorGeometry = await this.pgClient.query(`
          SELECT 
            CASE 
              WHEN $2 = 'start' THEN ST_AddPoint(geometry, $1, 0)
              WHEN $2 = 'end' THEN ST_AddPoint(geometry, $1, -1)
              ELSE geometry
            END as snapped_geometry
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = $3
        `, [intersectionPoint, endpointType, visitorTrailId]);

        if (!snappedVisitorGeometry.rows[0] || !snappedVisitorGeometry.rows[0].snapped_geometry) {
          console.log(`   ❌ Failed to generate snapped geometry for visitor trail "${gap.endpoint_trail_name}"`);
          continue;
        }
        
        // Update the visitor trail with the snapped geometry
        await this.pgClient.query(`
          UPDATE ${this.stagingSchema}.trails 
          SET geometry = $1
          WHERE app_uuid = $2
        `, [snappedVisitorGeometry.rows[0].snapped_geometry, visitorTrailId]);
        
        console.log(`   ✅ Successfully snapped visitor trail "${gap.endpoint_trail_name}" to intersection point`);
        
        gapsFixed++;
        processedTrails.add(visitorTrailId);
      }
      
      console.log(`   📊 T-intersection gap fixing complete: ${gapsFixed}/${tIntersectionGapsResult.rowCount} gaps fixed`);
      
      // Detect and record all intersections after gap fixing
      await this.detectAllIntersections();
      
      return gapsFixed;
      
    } catch (error) {
      console.error('   ❌ Error during T-intersection gap detection and fixing:', error);
      return 0;
    }
  }

  /**
   * Detect and record all intersections (true intersections, T-intersections, Y-intersections)
   * This runs after T-intersection gaps are fixed to get the complete picture
   */
  private async detectAllIntersections(): Promise<void> {
    console.log('   🔍 Detecting all intersections after gap fixing...');
    
    try {
      // Load Layer 1 configuration for tolerances
      const { loadConfig } = await import('../../utils/config-loader');
      const config = loadConfig();
      const toleranceMeters = config.layer1_trails.intersectionDetection.tIntersectionToleranceMeters;
      
      // Clear existing intersection points
      await this.pgClient.query(`DELETE FROM ${this.stagingSchema}.intersection_points`);
      
      // Detect all types of intersections
      const intersectionResult = await this.pgClient.query(`
        WITH all_trails AS (
          SELECT app_uuid, name, geometry 
          FROM ${this.stagingSchema}.trails 
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        true_intersections AS (
          -- True geometric intersections (Y-intersections)
          SELECT 
            ST_Force2D(ST_Intersection(t1.geometry::geometry, t2.geometry::geometry)) as intersection_point,
            ST_Force3D(ST_Intersection(t1.geometry::geometry, t2.geometry::geometry)) as intersection_point_3d,
            ARRAY[t1.app_uuid, t2.app_uuid] as connected_trail_ids,
            ARRAY[t1.name, t2.name] as connected_trail_names,
            'Y-intersection' as node_type,
            ST_Distance(ST_Intersection(t1.geometry::geometry, t2.geometry::geometry)::geography, 
                       ST_StartPoint(t1.geometry)::geography) as distance_meters
          FROM all_trails t1
          JOIN all_trails t2 ON t1.app_uuid < t2.app_uuid
          WHERE ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
        ),
        t_intersections AS (
          -- T-intersections (endpoint near midpoint)
          SELECT 
            ST_Force2D(closest_point) as intersection_point,
            ST_Force3D(closest_point) as intersection_point_3d,
            ARRAY[endpoint_trail_id, target_trail_id] as connected_trail_ids,
            ARRAY[endpoint_trail_name, target_trail_name] as connected_trail_names,
            'T-intersection' as node_type,
            distance_meters
          FROM (
            SELECT 
              e1.app_uuid as endpoint_trail_id,
              e1.name as endpoint_trail_name,
              e2.app_uuid as target_trail_id,
              e2.name as target_trail_name,
              ST_ClosestPoint(e2.geometry, e1.start_point) as closest_point,
              ST_Distance(e1.start_point::geography, e2.geometry::geography) as distance_meters
            FROM all_trails e1
            JOIN all_trails e2 ON e1.app_uuid != e2.app_uuid
            WHERE ST_DWithin(e1.start_point::geography, e2.geometry::geography, $1)
              AND ST_Distance(e1.start_point::geography, e2.geometry::geography) > 0
              AND ST_Distance(e1.start_point::geography, e2.geometry::geography) <= $1
            
            UNION ALL
            
            SELECT 
              e1.app_uuid as endpoint_trail_id,
              e1.name as endpoint_trail_name,
              e2.app_uuid as target_trail_id,
              e2.name as target_trail_name,
              ST_ClosestPoint(e2.geometry, e1.end_point) as closest_point,
              ST_Distance(e1.end_point::geography, e2.geometry::geography) as distance_meters
            FROM all_trails e1
            JOIN all_trails e2 ON e1.app_uuid != e2.app_uuid
            WHERE ST_DWithin(e1.end_point::geography, e2.geometry::geography, $1)
              AND ST_Distance(e1.end_point::geography, e2.geometry::geography) > 0
              AND ST_Distance(e1.end_point::geography, e2.geometry::geography) <= $1
          ) t_intersection_candidates
        )
        INSERT INTO ${this.stagingSchema}.intersection_points (
          intersection_point, intersection_point_3d, connected_trail_ids, 
          connected_trail_names, node_type, distance_meters
        )
        SELECT intersection_point, intersection_point_3d, connected_trail_ids, 
               connected_trail_names, node_type, distance_meters
        FROM (
          SELECT * FROM true_intersections
          UNION ALL
          SELECT * FROM t_intersections
        ) all_intersections
        WHERE intersection_point IS NOT NULL
      `, [toleranceMeters]);

      console.log(`   📊 Detected ${intersectionResult.rowCount} intersections (Y and T)`);
      
    } catch (error) {
      console.error('   ❌ Error during intersection detection:', error);
    }
  }

  /**
   * Clean up geometries after T-intersection snapping to prevent linear intersection issues
   */
  private async cleanupGeometriesAfterSnapping(): Promise<void> {
    console.log('   🧹 Cleaning up geometries after T-intersection snapping...');
    
    try {
      // Remove any duplicate consecutive points that might have been created during snapping
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.trails 
        SET geometry = ST_Simplify(geometry, 0.000001)
        WHERE ST_IsValid(geometry)
      `);
      
      console.log('   ✅ Geometry cleanup completed');
      
    } catch (error) {
      console.error('   ❌ Error during geometry cleanup:', error);
    }
  }
}
