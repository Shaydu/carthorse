import { Pool } from 'pg';

export interface EndpointConsolidationResult {
  clustersFound: number;
  endpointsConsolidated: number;
  totalEndpointsBefore: number;
  totalEndpointsAfter: number;
  details: Array<{
    clusterId: number;
    originalEndpoints: number;
    centroid: [number, number, number]; // [lng, lat, elevation]
    trailNames: string[];
    consolidationDistance: number;
  }>;
}

export interface EndpointConsolidationConfig {
  toleranceMeters: number;        // Endpoints within this distance get merged (default: 0.3m)
  minClusterSize: number;         // Minimum endpoints to form a cluster (default: 2)
  preserveElevation: boolean;     // Whether to preserve elevation differences (default: true)
}

/**
 * Trail Endpoint Consolidation Service
 * 
 * Consolidates very close trail endpoints to reduce node complexity and improve connectivity.
 * This is different from gap filling - it moves existing endpoints to shared locations
 * rather than creating new connector trails.
 */
export class TrailEndpointConsolidationService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Consolidate nearby trail endpoints
   */
  async consolidateEndpoints(config: EndpointConsolidationConfig): Promise<EndpointConsolidationResult> {
    console.log('📍 Starting trail endpoint consolidation...');
    console.log(`   🎯 Tolerance: ${config.toleranceMeters}m, Min cluster size: ${config.minClusterSize}`);
    
    const toleranceDegrees = config.toleranceMeters / 111320;
    
    const result: EndpointConsolidationResult = {
      clustersFound: 0,
      endpointsConsolidated: 0,
      totalEndpointsBefore: 0,
      totalEndpointsAfter: 0,
      details: []
    };

    try {
      // Step 1: Count total endpoints before consolidation
      const beforeCount = await this.pgClient.query(`
        SELECT COUNT(*) as total_endpoints
        FROM (
          SELECT ST_StartPoint(geometry) as endpoint FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL
          UNION ALL
          SELECT ST_EndPoint(geometry) as endpoint FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL
        ) all_endpoints
        WHERE endpoint IS NOT NULL
      `);
      result.totalEndpointsBefore = parseInt(beforeCount.rows[0].total_endpoints);

      // Step 2: Find endpoint clusters using DBSCAN
      console.log('🔍 Finding endpoint clusters...');
      const clusters = await this.pgClient.query(`
        WITH trail_endpoints AS (
          SELECT 
            app_uuid as trail_id,
            name as trail_name,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point,
            ST_Z(ST_StartPoint(geometry)) as start_elevation,
            ST_Z(ST_EndPoint(geometry)) as end_elevation
          FROM ${this.stagingSchema}.trails
          WHERE geometry IS NOT NULL 
            AND ST_IsValid(geometry)
            AND ST_Length(geometry::geography) > 0
        ),
        all_endpoints AS (
          SELECT trail_id, trail_name, start_point as point, start_elevation as elevation, 'start' as point_type
          FROM trail_endpoints
          WHERE start_point IS NOT NULL
          UNION ALL
          SELECT trail_id, trail_name, end_point as point, end_elevation as elevation, 'end' as point_type
          FROM trail_endpoints
          WHERE end_point IS NOT NULL
        ),
        endpoint_clusters AS (
          SELECT 
            ST_ClusterDBSCAN(point, $1, $2) OVER () as cluster_id,
            trail_id,
            trail_name,
            point,
            elevation,
            point_type
          FROM all_endpoints
          WHERE point IS NOT NULL
        ),
        cluster_summaries AS (
          SELECT 
            cluster_id,
            COUNT(*) as endpoint_count,
            ST_Collect(point) as point_collection,
            array_agg(trail_name) as trail_names,
            array_agg(trail_id) as trail_ids,
            array_agg(point_type) as point_types
          FROM endpoint_clusters
          WHERE cluster_id IS NOT NULL
          GROUP BY cluster_id
          HAVING COUNT(*) >= $2
        )
        SELECT 
          cluster_id,
          endpoint_count,
          ST_Centroid(point_collection) as centroid,
          ST_Z(ST_Centroid(point_collection)) as centroid_elevation,
          trail_names,
          trail_ids,
          point_types,
          (SELECT MAX(ST_Distance(point, ST_Centroid(point_collection))) 
           FROM endpoint_clusters ec2 
           WHERE ec2.cluster_id = cs.cluster_id) as max_distance
        FROM cluster_summaries cs
        ORDER BY endpoint_count DESC
      `, [toleranceDegrees, config.minClusterSize]);

      result.clustersFound = clusters.rows.length;
      console.log(`   📊 Found ${result.clustersFound} endpoint clusters`);

      // Step 3: Consolidate each cluster
      for (const cluster of clusters.rows) {
        try {
          const consolidationResult = await this.consolidateCluster(cluster, config);
          result.endpointsConsolidated += consolidationResult.consolidatedCount;
          result.details.push({
            clusterId: cluster.cluster_id,
            originalEndpoints: cluster.endpoint_count,
            centroid: [
              cluster.centroid.x,
              cluster.centroid.y,
              cluster.centroid_elevation || 0
            ],
            trailNames: cluster.trail_names,
            consolidationDistance: cluster.max_distance
          });

          console.log(`   ✅ Cluster ${cluster.cluster_id}: ${cluster.endpoint_count} endpoints → 1 shared endpoint`);

        } catch (error) {
          console.warn(`⚠️ Failed to consolidate cluster ${cluster.cluster_id}:`, error);
        }
      }

      // Step 4: Count total endpoints after consolidation
      const afterCount = await this.pgClient.query(`
        SELECT COUNT(*) as total_endpoints
        FROM (
          SELECT ST_StartPoint(geometry) as endpoint FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL
          UNION ALL
          SELECT ST_EndPoint(geometry) as endpoint FROM ${this.stagingSchema}.trails WHERE geometry IS NOT NULL
        ) all_endpoints
        WHERE endpoint IS NOT NULL
      `);
      result.totalEndpointsAfter = parseInt(afterCount.rows[0].total_endpoints);

      console.log(`✅ Endpoint consolidation complete:`);
      console.log(`   📊 Before: ${result.totalEndpointsBefore} endpoints`);
      console.log(`   📊 After: ${result.totalEndpointsAfter} endpoints`);
      console.log(`   🔗 Reduced by: ${result.totalEndpointsBefore - result.totalEndpointsAfter} endpoints`);
      console.log(`   📍 Consolidated: ${result.endpointsConsolidated} endpoints in ${result.clustersFound} clusters`);

      return result;

    } catch (error) {
      console.error('❌ Endpoint consolidation failed:', error);
      throw error;
    }
  }

  /**
   * Consolidate a single cluster of endpoints
   */
  private async consolidateCluster(cluster: any, config: EndpointConsolidationConfig): Promise<{ consolidatedCount: number }> {
    const toleranceDegrees = config.toleranceMeters / 111320;
    let consolidatedCount = 0;

    // Update trail geometries to move endpoints to centroid
    for (let i = 0; i < cluster.trail_ids.length; i++) {
      const trailId = cluster.trail_ids[i];
      const pointType = cluster.point_types[i];
      
      try {
        const updateResult = await this.pgClient.query(`
          UPDATE ${this.stagingSchema}.trails
          SET geometry = CASE 
            WHEN $3 = 'start' THEN 
              ST_SetPoint(geometry, 0, $2)
            WHEN $3 = 'end' THEN 
              ST_SetPoint(geometry, ST_NPoints(geometry) - 1, $2)
            ELSE geometry
          END,
          updated_at = NOW()
          WHERE app_uuid = $1
            AND geometry IS NOT NULL
            AND ST_IsValid(geometry)
        `, [trailId, cluster.centroid, pointType]);

        if (updateResult.rowCount && updateResult.rowCount > 0) {
          consolidatedCount++;
        }

      } catch (error) {
        console.warn(`⚠️ Failed to update trail ${trailId} (${pointType}):`, error);
      }
    }

    return { consolidatedCount };
  }

  /**
   * Measure connectivity metrics directly from trail data
   */
  async measureConnectivity(): Promise<{
    totalTrails: number;
    connectedComponents: number;
    isolatedTrails: number;
    averageTrailsPerComponent: number;
    connectivityScore: number;
    details: {
      componentSizes: number[];
      isolatedTrailNames: string[];
    };
  }> {
    console.log('🔍 Measuring trail network connectivity...');

    // Find connected components using trail intersections AND endpoint proximity
    const connectivityResult = await this.pgClient.query(`
      WITH trail_connectivity AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE (
          -- Physical intersections
          (ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint'))
          OR
          -- Endpoint proximity (0.0m gaps)
          (ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001)
            OR ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001)
            OR ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001)
            OR ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001))
        )
          AND ST_Length(t1.geometry::geography) > 1
          AND ST_Length(t2.geometry::geography) > 1
      ),
      connected_components AS (
        SELECT 
          trail1_id as trail_id,
          trail1_name as trail_name
        FROM trail_connectivity
        UNION
        SELECT 
          trail2_id as trail_id,
          trail2_name as trail_name
        FROM trail_connectivity
      ),
      all_trails AS (
        SELECT app_uuid as trail_id, name as trail_name
        FROM ${this.stagingSchema}.trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      ),
      isolated_trails AS (
        SELECT trail_id, trail_name
        FROM all_trails
        WHERE trail_id NOT IN (SELECT trail_id FROM connected_components)
      ),
      component_sizes AS (
        SELECT 
          COUNT(*) as component_size
        FROM connected_components
        GROUP BY trail_id
      )
      SELECT 
        (SELECT COUNT(*) FROM all_trails) as total_trails,
        (SELECT COUNT(*) FROM connected_components) as connected_trails,
        (SELECT COUNT(*) FROM isolated_trails) as isolated_trails,
        (SELECT COALESCE(AVG(component_size), 0) FROM component_sizes) as avg_component_size,
        (SELECT array_agg(trail_name) FROM isolated_trails) as isolated_trail_names
    `);

    const metrics = connectivityResult.rows[0];
    const totalTrails = parseInt(metrics.total_trails);
    const connectedTrails = parseInt(metrics.connected_trails);
    const isolatedTrails = parseInt(metrics.isolated_trails);
    const avgComponentSize = parseFloat(metrics.avg_component_size);
    
    // Calculate connectivity score (0-1, higher is better)
    const connectivityScore = totalTrails > 0 ? 
      (connectedTrails / totalTrails) * Math.min(1.0, avgComponentSize / 10.0) : 0;

    // Get component size distribution
    const componentSizes = await this.pgClient.query(`
      WITH trail_connectivity AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t2.app_uuid as trail2_id
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE (
          -- Physical intersections
          (ST_Intersects(t1.geometry, t2.geometry)
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint'))
          OR
          -- Endpoint proximity (0.0m gaps)
          (ST_DWithin(ST_StartPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001)
            OR ST_DWithin(ST_StartPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001)
            OR ST_DWithin(ST_EndPoint(t1.geometry), ST_StartPoint(t2.geometry), 0.001)
            OR ST_DWithin(ST_EndPoint(t1.geometry), ST_EndPoint(t2.geometry), 0.001))
        )
      ),
      connected_components AS (
        SELECT 
          trail1_id as trail_id
        FROM trail_connectivity
        UNION
        SELECT 
          trail2_id as trail_id
        FROM trail_connectivity
      )
      SELECT 
        COUNT(*) as component_size
      FROM connected_components
      GROUP BY trail_id
      ORDER BY component_size DESC
    `);

    console.log(`📊 Connectivity Metrics:`);
    console.log(`   🛤️ Total trails: ${totalTrails}`);
    console.log(`   🔗 Connected trails: ${connectedTrails}`);
    console.log(`   🏝️ Isolated trails: ${isolatedTrails}`);
    console.log(`   📈 Average component size: ${avgComponentSize.toFixed(1)}`);
    console.log(`   🎯 Connectivity score: ${(connectivityScore * 100).toFixed(1)}%`);

    return {
      totalTrails,
      connectedComponents: componentSizes.rows.length,
      isolatedTrails,
      averageTrailsPerComponent: avgComponentSize,
      connectivityScore,
      details: {
        componentSizes: componentSizes.rows.map(r => parseInt(r.component_size)),
        isolatedTrailNames: metrics.isolated_trail_names || []
      }
    };
  }
}
