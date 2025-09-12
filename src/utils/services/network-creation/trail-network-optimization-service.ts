import { Pool } from 'pg';

export interface TrailNetworkOptimizationResult {
  microGapsSnapped: number;
  endpointsConsolidated: number;
  geometriesSimplified: number;
  intersectionsEnhanced: number;
  deadEndsConnected: number;
  totalOptimizations: number;
  details: {
    microGaps: Array<{ trail1: string; trail2: string; distance: number }>;
    consolidatedEndpoints: Array<{ originalCount: number; finalCount: number }>;
    simplifiedTrails: Array<{ trailName: string; originalPoints: number; finalPoints: number }>;
    enhancedIntersections: Array<{ location: string; connectedTrails: number }>;
    connectedDeadEnds: Array<{ trailName: string; connectionDistance: number }>;
  };
}

export interface TrailNetworkOptimizationConfig {
  microGapTolerance: number;        // Gaps < this distance get snapped (default: 0.5m)
  endpointConsolidationTolerance: number; // Endpoints within this distance get merged (default: 0.3m)
  geometrySimplificationTolerance: number; // Geometry simplification tolerance in degrees (default: 0.0001)
  intersectionEnhancementTolerance: number; // Tolerance for finding missing intersections (default: 1.0m)
  deadEndConnectionMaxDistance: number; // Maximum distance to connect dead ends (default: 10.0m)
  minTrailDensity: number;          // Minimum trails per km for sparse area detection (default: 2)
}

/**
 * Comprehensive trail network optimization service
 * 
 * This service implements multiple optimizations to improve trail network connectivity
 * and make subsequent node/edge processing more efficient and reliable.
 */
export class TrailNetworkOptimizationService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Run all trail network optimizations
   */
  async optimizeTrailNetwork(config: TrailNetworkOptimizationConfig): Promise<TrailNetworkOptimizationResult> {
    console.log('🔧 Starting comprehensive trail network optimization...');
    
    const result: TrailNetworkOptimizationResult = {
      microGapsSnapped: 0,
      endpointsConsolidated: 0,
      geometriesSimplified: 0,
      intersectionsEnhanced: 0,
      deadEndsConnected: 0,
      totalOptimizations: 0,
      details: {
        microGaps: [],
        consolidatedEndpoints: [],
        simplifiedTrails: [],
        enhancedIntersections: [],
        connectedDeadEnds: []
      }
    };

    try {
      // Step 1: Snap micro-gaps (< 1m)
      console.log('🔗 Step 1: Snapping micro-gaps...');
      const microGapResult = await this.snapMicroGaps(config.microGapTolerance);
      result.microGapsSnapped = microGapResult.count;
      result.details.microGaps = microGapResult.details;
      console.log(`   ✅ Snapped ${microGapResult.count} micro-gaps`);

      // Step 2: Consolidate nearby endpoints
      console.log('📍 Step 2: Consolidating nearby endpoints...');
      const endpointResult = await this.consolidateNearbyEndpoints(config.endpointConsolidationTolerance);
      result.endpointsConsolidated = endpointResult.count;
      result.details.consolidatedEndpoints = endpointResult.details;
      console.log(`   ✅ Consolidated ${endpointResult.count} endpoint groups`);

      // Step 3: Simplify trail geometries
      console.log('📐 Step 3: Simplifying trail geometries...');
      const geometryResult = await this.simplifyTrailGeometries(config.geometrySimplificationTolerance);
      result.geometriesSimplified = geometryResult.count;
      result.details.simplifiedTrails = geometryResult.details;
      console.log(`   ✅ Simplified ${geometryResult.count} trail geometries`);

      // Step 4: Enhance intersection points
      console.log('🔄 Step 4: Enhancing intersection points...');
      const intersectionResult = await this.enhanceIntersectionPoints(config.intersectionEnhancementTolerance);
      result.intersectionsEnhanced = intersectionResult.count;
      result.details.enhancedIntersections = intersectionResult.details;
      console.log(`   ✅ Enhanced ${intersectionResult.count} intersection points`);

      // Step 5: Connect dead-end trails
      console.log('🔗 Step 5: Connecting dead-end trails...');
      const deadEndResult = await this.connectDeadEndTrails(config.deadEndConnectionMaxDistance);
      result.deadEndsConnected = deadEndResult.count;
      result.details.connectedDeadEnds = deadEndResult.details;
      console.log(`   ✅ Connected ${deadEndResult.count} dead-end trails`);

      result.totalOptimizations = result.microGapsSnapped + result.endpointsConsolidated + 
                                 result.geometriesSimplified + result.intersectionsEnhanced + 
                                 result.deadEndsConnected;

      console.log(`✅ Trail network optimization complete: ${result.totalOptimizations} total optimizations`);
      
      return result;

    } catch (error) {
      console.error('❌ Trail network optimization failed:', error);
      throw error;
    }
  }

  /**
   * Snap micro-gaps by extending trail endpoints
   */
  private async snapMicroGaps(toleranceMeters: number): Promise<{ count: number; details: any[] }> {
    const toleranceDegrees = toleranceMeters / 111320;
    const details: any[] = [];

    // Find trails with endpoints very close to each other
    const microGaps = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
      ),
      micro_gaps AS (
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          ST_Distance(t1.start_point::geography, t2.start_point::geography) as distance_meters,
          'start-start' as gap_type
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id
          AND ST_DWithin(t1.start_point, t2.start_point, $1)
          AND ST_Distance(t1.start_point::geography, t2.start_point::geography) > 0
          AND ST_Distance(t1.start_point::geography, t2.start_point::geography) <= $2
        
        UNION ALL
        
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          ST_Distance(t1.end_point::geography, t2.end_point::geography) as distance_meters,
          'end-end' as gap_type
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id
          AND ST_DWithin(t1.end_point, t2.end_point, $1)
          AND ST_Distance(t1.end_point::geography, t2.end_point::geography) > 0
          AND ST_Distance(t1.end_point::geography, t2.end_point::geography) <= $2
      )
      SELECT * FROM micro_gaps
      ORDER BY distance_meters
    `, [toleranceDegrees, toleranceMeters]);

    let snappedCount = 0;
    for (const gap of microGaps.rows) {
      try {
        // Extend the shorter trail to meet the longer one
        await this.pgClient.query(`
          UPDATE ${this.stagingSchema}.trails
          SET geometry = CASE 
            WHEN $3 = 'start-start' THEN 
              ST_AddPoint(geometry, ST_StartPoint((
                SELECT geometry FROM ${this.stagingSchema}.trails WHERE app_uuid = $2
              )), 0)
            WHEN $3 = 'end-end' THEN 
              ST_AddPoint(geometry, ST_EndPoint((
                SELECT geometry FROM ${this.stagingSchema}.trails WHERE app_uuid = $2
              )), -1)
          END,
          updated_at = NOW()
          WHERE app_uuid = $1
            AND ST_Length(geometry::geography) <= (
              SELECT ST_Length(geometry::geography) FROM ${this.stagingSchema}.trails WHERE app_uuid = $2
            )
        `, [gap.trail1_id, gap.trail2_id, gap.gap_type]);

        snappedCount++;
        details.push({
          trail1: gap.trail1_name,
          trail2: gap.trail2_name,
          distance: gap.distance_meters
        });

      } catch (error) {
        console.warn(`⚠️ Failed to snap micro-gap between ${gap.trail1_name} and ${gap.trail2_name}:`, error);
      }
    }

    return { count: snappedCount, details };
  }

  /**
   * Consolidate very close trail endpoints
   */
  private async consolidateNearbyEndpoints(toleranceMeters: number): Promise<{ count: number; details: any[] }> {
    const toleranceDegrees = toleranceMeters / 111320;
    const details: any[] = [];

    // Find groups of endpoints that are very close together
    const endpointGroups = await this.pgClient.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
      ),
      endpoint_clusters AS (
        SELECT 
          ST_ClusterDBSCAN(point, $1, 1) OVER () as cluster_id,
          trail_id,
          trail_name,
          point,
          point_type
        FROM (
          SELECT trail_id, trail_name, start_point as point, 'start' as point_type
          FROM trail_endpoints
          UNION ALL
          SELECT trail_id, trail_name, end_point as point, 'end' as point_type
          FROM trail_endpoints
        ) all_points
        WHERE point IS NOT NULL
      )
      SELECT 
        cluster_id,
        COUNT(*) as endpoint_count,
        ST_Centroid(ST_Collect(point)) as centroid,
        array_agg(trail_name) as trail_names
      FROM endpoint_clusters
      WHERE cluster_id IS NOT NULL
      GROUP BY cluster_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `, [toleranceDegrees]);

    let consolidatedCount = 0;
    for (const group of endpointGroups.rows) {
      try {
        // Move all endpoints in the cluster to the centroid
        await this.pgClient.query(`
          UPDATE ${this.stagingSchema}.trails
          SET geometry = CASE 
            WHEN ST_DWithin(ST_StartPoint(geometry), $2, $1) THEN
              ST_SetPoint(geometry, 0, $2)
            WHEN ST_DWithin(ST_EndPoint(geometry), $2, $1) THEN
              ST_SetPoint(geometry, ST_NPoints(geometry) - 1, $2)
            ELSE geometry
          END,
          updated_at = NOW()
          WHERE app_uuid IN (
            SELECT trail_id FROM (
              SELECT trail_id, start_point as point FROM ${this.stagingSchema}.trails
              UNION ALL
              SELECT trail_id, end_point as point FROM ${this.stagingSchema}.trails
            ) all_points
            WHERE ST_DWithin(point, $2, $1)
          )
        `, [toleranceDegrees, group.centroid]);

        consolidatedCount++;
        details.push({
          originalCount: group.endpoint_count,
          finalCount: 1
        });

      } catch (error) {
        console.warn(`⚠️ Failed to consolidate endpoint group ${group.cluster_id}:`, error);
      }
    }

    return { count: consolidatedCount, details };
  }

  /**
   * Simplify trail geometries to reduce processing overhead
   */
  private async simplifyTrailGeometries(toleranceDegrees: number): Promise<{ count: number; details: any[] }> {
    const details: any[] = [];

    // Get trails with complex geometries
    const complexTrails = await this.pgClient.query(`
      SELECT 
        app_uuid,
        name,
        ST_NPoints(geometry) as original_points,
        ST_Length(geometry::geography) as length_meters
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        AND ST_NPoints(geometry) > 10
        AND ST_Length(geometry::geography) > 10
    `);

    let simplifiedCount = 0;
    for (const trail of complexTrails.rows) {
      try {
        // Simplify geometry while preserving topology
        const simplifiedResult = await this.pgClient.query(`
          UPDATE ${this.stagingSchema}.trails
          SET geometry = ST_SimplifyPreserveTopology(geometry, $1),
              updated_at = NOW()
          WHERE app_uuid = $2
          RETURNING ST_NPoints(geometry) as final_points
        `, [toleranceDegrees, trail.app_uuid]);

        if (simplifiedResult.rows.length > 0) {
          const finalPoints = simplifiedResult.rows[0].final_points;
          if (finalPoints < trail.original_points) {
            simplifiedCount++;
            details.push({
              trailName: trail.name,
              originalPoints: trail.original_points,
              finalPoints: finalPoints
            });
          }
        }

      } catch (error) {
        console.warn(`⚠️ Failed to simplify trail ${trail.name}:`, error);
      }
    }

    return { count: simplifiedCount, details };
  }

  /**
   * Enhance intersection points by detecting missing intersections
   */
  private async enhanceIntersectionPoints(toleranceMeters: number): Promise<{ count: number; details: any[] }> {
    const toleranceDegrees = toleranceMeters / 111320;
    const details: any[] = [];

    // Find trails that should intersect but don't due to precision issues
    const missingIntersections = await this.pgClient.query(`
      SELECT 
        t1.app_uuid as trail1_id,
        t1.name as trail1_name,
        t2.app_uuid as trail2_id,
        t2.name as trail2_name,
        ST_Distance(t1.geometry, t2.geometry) as distance_meters,
        ST_ClosestPoint(t1.geometry, t2.geometry) as intersection_point
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        -- OPTIMIZATION: Use spatial indexing with ST_DWithin instead of CROSS JOIN
        AND ST_DWithin(t1.geometry, t2.geometry, $1)
        AND NOT ST_Intersects(t1.geometry, t2.geometry)
        AND ST_Distance(t1.geometry, t2.geometry) <= $2
        AND ST_Length(t1.geometry::geography) > 10
        AND ST_Length(t2.geometry::geography) > 10
    `, [toleranceDegrees, toleranceMeters]);

    let enhancedCount = 0;
    for (const intersection of missingIntersections.rows) {
      try {
        // Create intersection point and split trails
        await this.pgClient.query(`
          WITH intersection_point AS (
            SELECT $3 as point
          ),
          split_trail1 AS (
            SELECT ST_Split(geometry, $3) as split_geom
            FROM ${this.stagingSchema}.trails
            WHERE app_uuid = $1
          ),
          split_trail2 AS (
            SELECT ST_Split(geometry, $3) as split_geom
            FROM ${this.stagingSchema}.trails
            WHERE app_uuid = $2
          )
          INSERT INTO ${this.stagingSchema}.trails (app_uuid, name, geometry, trail_type, source)
          SELECT 
            gen_random_uuid(),
            'Intersection Split',
            (ST_Dump(split_geom)).geom,
            'connector',
            'intersection_enhancement'
          FROM split_trail1, split_trail2
          WHERE ST_IsValid((ST_Dump(split_geom)).geom)
            AND ST_Length((ST_Dump(split_geom)).geom::geography) > 1
        `, [intersection.trail1_id, intersection.trail2_id, intersection.intersection_point]);

        enhancedCount++;
        details.push({
          location: `Near ${intersection.trail1_name} and ${intersection.trail2_name}`,
          connectedTrails: 2
        });

      } catch (error) {
        console.warn(`⚠️ Failed to enhance intersection between ${intersection.trail1_name} and ${intersection.trail2_name}:`, error);
      }
    }

    return { count: enhancedCount, details };
  }

  /**
   * Connect dead-end trails to the main network
   */
  private async connectDeadEndTrails(maxDistance: number): Promise<{ count: number; details: any[] }> {
    const maxDistanceDegrees = maxDistance / 111320;
    const details: any[] = [];

    // Find dead-end trails (trails that don't connect to others)
    const deadEnds = await this.pgClient.query(`
      WITH trail_connectivity AS (
        SELECT 
          t1.app_uuid as trail_id,
          t1.name as trail_name,
          t1.geometry as trail_geom,
          COUNT(t2.app_uuid) as connection_count
        FROM ${this.stagingSchema}.trails t1
        LEFT JOIN ${this.stagingSchema}.trails t2 ON (
          t1.app_uuid != t2.app_uuid
          AND ST_DWithin(t1.geometry, t2.geometry, 0.001)
          AND ST_Intersects(t1.geometry, t2.geometry)
        )
        WHERE t1.geometry IS NOT NULL 
          AND ST_IsValid(t1.geometry)
        GROUP BY t1.app_uuid, t1.name, t1.geometry
      ),
      nearby_connections AS (
        SELECT 
          de.trail_id,
          de.trail_name,
          de.trail_geom,
          t.app_uuid as nearby_trail_id,
          t.name as nearby_trail_name,
          ST_Distance(de.trail_geom, t.geometry) as distance_meters
        FROM trail_connectivity de
        JOIN ${this.stagingSchema}.trails t ON de.trail_id != t.app_uuid
          -- OPTIMIZATION: Use spatial indexing with ST_DWithin instead of CROSS JOIN
          AND ST_DWithin(de.trail_geom, t.geometry, $1)
          AND ST_Distance(de.trail_geom, t.geometry) <= $2
        WHERE de.connection_count = 0
      )
      SELECT DISTINCT ON (trail_id)
        trail_id,
        trail_name,
        nearby_trail_id,
        nearby_trail_name,
        distance_meters,
        ST_ClosestPoint(trail_geom, (
          SELECT geometry FROM ${this.stagingSchema}.trails WHERE app_uuid = nearby_trail_id
        )) as connection_point
      FROM nearby_connections
      ORDER BY trail_id, distance_meters
    `, [maxDistanceDegrees, maxDistance]);

    let connectedCount = 0;
    for (const deadEnd of deadEnds.rows) {
      try {
        // Create connector trail to nearest trail
        await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, geometry, trail_type, source, length_km
          ) VALUES (
            gen_random_uuid(),
            'Dead End Connector: ${deadEnd.trail_name}',
            ST_MakeLine(
              ST_ClosestPoint($1, $2),
              ST_ClosestPoint($2, $1)
            ),
            'connector',
            'dead_end_connection',
            ST_Length(ST_MakeLine(
              ST_ClosestPoint($1, $2),
              ST_ClosestPoint($2, $1)
            )::geography) / 1000.0
          )
        `, [deadEnd.trail_geom, `(SELECT geometry FROM ${this.stagingSchema}.trails WHERE app_uuid = '${deadEnd.nearby_trail_id}')`]);

        connectedCount++;
        details.push({
          trailName: deadEnd.trail_name,
          connectionDistance: deadEnd.distance_meters
        });

      } catch (error) {
        console.warn(`⚠️ Failed to connect dead end ${deadEnd.trail_name}:`, error);
      }
    }

    return { count: connectedCount, details };
  }
}
