import { Pool } from 'pg';
import { IntersectionSplittingService } from './IntersectionSplittingService';
import { PublicTrailIntersectionSplittingService } from './PublicTrailIntersectionSplittingService';

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
    
    // Step 1.5: Apply working prototype intersection splitting (before copying to staging)
    console.log('🔗 Step 1.5: Applying working prototype intersection splitting...');
    const prototypeResult = await this.applyWorkingPrototypeSplitting();
    if (prototypeResult.success) {
      console.log(`✅ Working prototype splitting completed: ${prototypeResult.splitCount} segments created`);
    } else {
      console.log(`⚠️ Working prototype splitting failed: ${prototypeResult.error}`);
    }

    // Step 2: Copy trail data with bbox filter
    result.trailsCopied = await this.copyTrailData();
    
    // Step 2.5: Apply prototype intersection splitting (early, before other processing)
    console.log('🔗 Step 2.5: Applying prototype intersection splitting...');
    const intersectionSplittingService = new IntersectionSplittingService(this.pgClient, this.stagingSchema);
    const intersectionResult = await intersectionSplittingService.splitTrailsAtIntersections();
    if (intersectionResult.success) {
      console.log(`✅ Intersection splitting completed: ${intersectionResult.splitCount} segments created`);
    } else {
      console.log(`⚠️ Intersection splitting failed: ${intersectionResult.error}`);
    }
    
    // Step 3: Clean up trails (remove invalid geometries, short segments)
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
   * Apply working prototype intersection splitting logic
   */
  private async applyWorkingPrototypeSplitting(): Promise<{ success: boolean; splitCount: number; error?: string }> {
    try {
      // Get Enchanted Mesa and Kohler Spur trails from public.trails (same logic as working prototype)
      const trailsResult = await this.pgClient.query(`
        SELECT name, app_uuid, source, ST_AsText(geometry) as geom_text
        FROM public.trails 
        WHERE name IN ('Enchanted Mesa Trail', 'Enchanted-Kohler Spur Trail')
        ORDER BY name
      `);
      
      console.log(`🔍 Found ${trailsResult.rows.length} trails for prototype splitting:`);
      trailsResult.rows.forEach(trail => {
        console.log(`   - ${trail.name} (${trail.app_uuid}) [${trail.source}]`);
      });
      
      if (trailsResult.rows.length < 2) {
        console.log('⚠️ Need both Enchanted Mesa and Kohler trails for prototype splitting');
        return { success: false, splitCount: 0, error: 'Missing required trails' };
      }
      
      const enchantedMesa = trailsResult.rows.find(t => t.name === 'Enchanted Mesa Trail');
      const kohlerSpur = trailsResult.rows.find(t => t.name === 'Enchanted-Kohler Spur Trail');
      
      console.log(`🔗 Applying working prototype logic: ${enchantedMesa.name} <-> ${kohlerSpur.name}`);
      
      // Step 1: Round coordinates to 6 decimal places (exactly like working prototype)
      const roundedResult = await this.pgClient.query(`
        WITH rounded_trails AS (
          SELECT 
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt1)::numeric, 6) || ' ' || ROUND(ST_Y(pt1)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($1), pt1)
              ) || 
              ')'
            ) as enchanted_mesa_rounded,
            ST_GeomFromText(
              'LINESTRING(' || 
              string_agg(
                ROUND(ST_X(pt2)::numeric, 6) || ' ' || ROUND(ST_Y(pt2)::numeric, 6),
                ',' ORDER BY ST_LineLocatePoint(ST_GeomFromText($2), pt2)
              ) || 
              ')'
            ) as kohler_spur_rounded
          FROM 
            (SELECT (ST_DumpPoints(ST_GeomFromText($1))).geom AS pt1) as points1,
            (SELECT (ST_DumpPoints(ST_GeomFromText($2))).geom AS pt2) as points2
        )
        SELECT enchanted_mesa_rounded, kohler_spur_rounded FROM rounded_trails
      `, [enchantedMesa.geom_text, kohlerSpur.geom_text]);
      
      if (roundedResult.rows.length === 0) {
        return { success: false, splitCount: 0, error: 'Failed to round coordinates' };
      }
      
      const enchantedMesaRounded = roundedResult.rows[0].enchanted_mesa_rounded;
      const kohlerSpurRounded = roundedResult.rows[0].kohler_spur_rounded;
      
      // Step 2: Snap with 1e-6 tolerance (exactly like working prototype)
      const snappedResult = await this.pgClient.query(`
        SELECT 
          ST_Snap($1::geometry, $2::geometry, 1e-6) AS enchanted_mesa_snapped,
          ST_Snap($2::geometry, $1::geometry, 1e-6) AS kohler_spur_snapped
      `, [enchantedMesaRounded, kohlerSpurRounded]);
      
      const enchantedMesaSnapped = snappedResult.rows[0].enchanted_mesa_snapped;
      const kohlerSpurSnapped = snappedResult.rows[0].kohler_spur_snapped;
      
      // Step 3: Find intersections (exactly like working prototype)
      const intersectionResult = await this.pgClient.query(`
        SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS pt
      `, [enchantedMesaSnapped, kohlerSpurSnapped]);
      
      console.log(`🔍 Found ${intersectionResult.rows.length} intersection(s)`);
      
      if (intersectionResult.rows.length === 0) {
        return { success: false, splitCount: 0, error: 'No intersections found' };
      }
      
      let totalSplitCount = 0;
      
      // Step 4: Split both trails at intersection points (exactly like working prototype)
      for (const intersection of intersectionResult.rows) {
        const splitPoint = intersection.pt;
        console.log(`   ✅ Intersection point: ${splitPoint}`);
        
        // Split Enchanted Mesa
        const splitEnchantedMesaResult = await this.pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [enchantedMesaSnapped, splitPoint]);
        
        console.log(`   📏 Enchanted Mesa split into ${splitEnchantedMesaResult.rows.length} segments`);
        
        // Split Kohler Spur
        const splitKohlerSpurResult = await this.pgClient.query(`
          SELECT (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom AS segment
        `, [kohlerSpurSnapped, splitPoint]);
        
        console.log(`   📏 Kohler Spur split into ${splitKohlerSpurResult.rows.length} segments`);
        
        // Insert split segments into staging with new app_uuid
        await this.insertPrototypeSplitSegmentsIntoStaging(
          enchantedMesa.app_uuid, enchantedMesa.name, splitEnchantedMesaResult.rows,
          kohlerSpur.app_uuid, kohlerSpur.name, splitKohlerSpurResult.rows
        );
        
        totalSplitCount += splitEnchantedMesaResult.rows.length + splitKohlerSpurResult.rows.length;
      }
      
      return { success: true, splitCount: totalSplitCount };
      
    } catch (error) {
      console.error('❌ Error in working prototype splitting:', error);
      return { success: false, splitCount: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Insert prototype split segments into staging schema
   */
  private async insertPrototypeSplitSegmentsIntoStaging(
    enchantedMesaUuid: string, enchantedMesaName: string, enchantedMesaSegments: any[],
    kohlerSpurUuid: string, kohlerSpurName: string, kohlerSpurSegments: any[]
  ): Promise<void> {
    
    let totalInserted = 0;
    
    // Insert Enchanted Mesa segments with new app_uuid (skip zero-length segments)
    for (let i = 0; i < enchantedMesaSegments.length; i++) {
      const segment = enchantedMesaSegments[i];
      
      // Check if segment has meaningful length (skip zero-length/point segments)
      const lengthResult = await this.pgClient.query(`
        SELECT ST_Length($1::geometry::geography) as length_meters
      `, [segment.segment]);
      
      const lengthMeters = lengthResult.rows[0].length_meters;
      if (lengthMeters <= 0) {
        console.log(`   ⏭️ Skipping zero-length Enchanted Mesa segment ${i + 1} (${lengthMeters}m)`);
        continue;
      }
      
      const segmentName = enchantedMesaSegments.length > 1 ? `${enchantedMesaName} (Segment ${i + 1})` : enchantedMesaName;
      
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty, 
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $2 as name,
          ST_Force3D($3::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM public.trails 
        WHERE app_uuid = $1
      `, [enchantedMesaUuid, segmentName, segment.segment]);
      
      totalInserted++;
      console.log(`   📝 Inserted Enchanted Mesa segment ${i + 1}: ${Math.round(lengthMeters * 100) / 100}m`);
    }

    // Insert Kohler Spur segments with new app_uuid (skip zero-length segments)
    for (let i = 0; i < kohlerSpurSegments.length; i++) {
      const segment = kohlerSpurSegments[i];
      
      // Check if segment has meaningful length (skip zero-length/point segments)
      const lengthResult = await this.pgClient.query(`
        SELECT ST_Length($1::geometry::geography) as length_meters
      `, [segment.segment]);
      
      const lengthMeters = lengthResult.rows[0].length_meters;
      if (lengthMeters <= 0) {
        console.log(`   ⏭️ Skipping zero-length Kohler Spur segment ${i + 1} (${lengthMeters}m)`);
        continue;
      }
      
      const segmentName = kohlerSpurSegments.length > 1 ? `${kohlerSpurName} (Segment ${i + 1})` : kohlerSpurName;
      
      await this.pgClient.query(`
        INSERT INTO ${this.stagingSchema}.trails (
          app_uuid, name, geometry, trail_type, surface, difficulty, 
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        )
        SELECT 
          gen_random_uuid() as app_uuid,
          $2 as name,
          ST_Force3D($3::geometry) as geometry,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          region, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          source, source_tags, osm_id
        FROM public.trails 
        WHERE app_uuid = $1
      `, [kohlerSpurUuid, segmentName, segment.segment]);
      
      totalInserted++;
      console.log(`   📝 Inserted Kohler Spur segment ${i + 1}: ${Math.round(lengthMeters * 100) / 100}m`);
    }

    console.log(`   📝 Inserted ${totalInserted} valid prototype split segments into staging`);
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
    
    // DEBUG: Check initial trail count
    const initialCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    console.log(`   📊 Initial trail count: ${initialCount.rows[0].count}`);
    
    // DEBUG: Show trail names
    const trailNames = await this.pgClient.query(`SELECT name FROM ${this.stagingSchema}.trails ORDER BY name`);
    console.log(`   📋 Trail names: ${trailNames.rows.map(r => r.name).join(', ')}`);
    
    // Step 1: Clean up GeometryCollections and complex geometries
    console.log('   🔧 Step 1: Cleaning up GeometryCollections and complex geometries...');
    
    // Clean up GeometryCollections by extracting LineStrings
    const geometryCollectionResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_LineMerge(ST_CollectionHomogenize(geometry))
      WHERE ST_GeometryType(geometry) = 'ST_GeometryCollection'
    `);
    console.log(`   ✅ Processed ${geometryCollectionResult.rowCount || 0} GeometryCollections`);
    
    // Convert MultiLineStrings to LineStrings
    const multiLineStringResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_LineMerge(geometry)
      WHERE ST_GeometryType(geometry) = 'ST_MultiLineString'
    `);
    console.log(`   ✅ Processed ${multiLineStringResult.rowCount || 0} MultiLineStrings`);
    
    // Fix invalid geometries
    const invalidGeomResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_MakeValid(geometry)
      WHERE NOT ST_IsValid(geometry)
    `);
    console.log(`   ✅ Fixed ${invalidGeomResult.rowCount || 0} invalid geometries`);
    
    // Remove problematic geometries that can't be fixed
    const problematicResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_GeometryType(geometry) != 'ST_LineString'
        OR NOT ST_IsSimple(geometry)
        OR ST_IsEmpty(geometry)
        OR ST_Length(geometry) < 0.001
    `);
    console.log(`   🗑️ Removed ${problematicResult.rowCount || 0} problematic geometries`);
    
    // Final check for any remaining problematic geometries
    const remainingProblematic = await this.pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${this.stagingSchema}.trails 
      WHERE ST_GeometryType(geometry) != 'ST_LineString'
    `);
    
    if (remainingProblematic.rows[0].count > 0) {
      console.warn(`   ⚠️ Found ${remainingProblematic.rows[0].count} problematic geometries, removing them...`);
      
      const finalCleanupResult = await this.pgClient.query(`
        DELETE FROM ${this.stagingSchema}.trails 
        WHERE ST_GeometryType(geometry) != 'ST_LineString'
      `);
      console.log(`   🗑️ Removed ${finalCleanupResult.rowCount || 0} remaining problematic geometries`);
    }
    
    // Step 2: Remove very short segments (less than 1 meter)
    const shortResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_Length(geometry::geography) < 1.0
    `);
    console.log(`   🗑️ Removed ${shortResult.rowCount || 0} short segments (< 1m)`);

    // Step 3: Remove trails with too few points
    const fewPointsResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_NumPoints(geometry) < 2
    `);
    console.log(`   🗑️ Removed ${fewPointsResult.rowCount || 0} trails with < 2 points`);

    // Get final count
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    const finalTrailCount = parseInt(finalCount.rows[0].count);
    console.log(`   📊 Final trail count: ${finalTrailCount}`);
    
    if (finalTrailCount === 0) {
      throw new Error('No valid trails remaining after geometry cleanup');
    }
    
    console.log(`   ✅ Geometry cleanup completed: ${finalTrailCount} trails remaining`);
    
    return (geometryCollectionResult.rowCount || 0) + (multiLineStringResult.rowCount || 0) + 
           (invalidGeomResult.rowCount || 0) + (problematicResult.rowCount || 0) + 
           (shortResult.rowCount || 0) + (fewPointsResult.rowCount || 0);
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
}
