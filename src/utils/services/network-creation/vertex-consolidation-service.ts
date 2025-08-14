import { Pool } from 'pg';

export interface VertexConsolidationResult {
  clustersFound: number;
  verticesConsolidated: number;
  totalVerticesBefore: number;
  totalVerticesAfter: number;
  details: Array<{
    clusterId: number;
    originalVertices: number;
    centroid: [number, number, number]; // [lng, lat, elevation]
    vertexIds: number[];
    consolidationDistance: number;
  }>;
}

export interface VertexConsolidationConfig {
  toleranceMeters: number;        // Vertices within this distance get merged (default: 0.5m)
  minClusterSize: number;         // Minimum vertices to form a cluster (default: 2)
  preserveElevation: boolean;     // Whether to preserve elevation differences (default: true)
}

/**
 * Vertex Consolidation Service for Layer 2
 * 
 * Consolidates very close vertices to fix 0.0m gap connectivity issues in the routing network.
 * This ensures that vertices with the same coordinates (or very close coordinates) get the same vertex ID,
 * allowing degree2 merge to properly connect edges.
 */
export class VertexConsolidationService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {}

  /**
   * Consolidate nearby vertices
   */
  async consolidateVertices(config: VertexConsolidationConfig): Promise<VertexConsolidationResult> {
    console.log('📍 Starting vertex consolidation for Layer 2...');
    console.log(`   🎯 Tolerance: ${config.toleranceMeters}m, Min cluster size: ${config.minClusterSize}`);
    
    const toleranceDegrees = config.toleranceMeters / 111320;
    
    const result: VertexConsolidationResult = {
      clustersFound: 0,
      verticesConsolidated: 0,
      totalVerticesBefore: 0,
      totalVerticesAfter: 0,
      details: []
    };

    try {
      // Step 1: Count total vertices before consolidation
      const beforeCount = await this.pgClient.query(`
        SELECT COUNT(*) as total_vertices
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        WHERE the_geom IS NOT NULL
      `);
      result.totalVerticesBefore = parseInt(beforeCount.rows[0].total_vertices);

      // Step 2: Find vertex clusters using DBSCAN
      console.log('🔍 Finding vertex clusters...');
      const clusters = await this.pgClient.query(`
        WITH vertex_clusters AS (
          SELECT 
            ST_ClusterDBSCAN(the_geom, $1, $2) OVER () as cluster_id,
            id as vertex_id,
            the_geom,
            ST_X(the_geom) as lng,
            ST_Y(the_geom) as lat,
            ST_Z(the_geom) as elevation
          FROM ${this.stagingSchema}.ways_noded_vertices_pgr
          WHERE the_geom IS NOT NULL
        ),
        cluster_summaries AS (
          SELECT 
            cluster_id,
            COUNT(*) as vertex_count,
            ST_Centroid(ST_Collect(the_geom)) as centroid,
            MAX(ST_Distance(the_geom, ST_Centroid(ST_Collect(the_geom)))) as max_distance,
            array_agg(vertex_id ORDER BY vertex_id) as vertex_ids,
            array_agg(lng ORDER BY vertex_id) as lngs,
            array_agg(lat ORDER BY vertex_id) as lats,
            array_agg(elevation ORDER BY vertex_id) as elevations
          FROM vertex_clusters
          WHERE cluster_id IS NOT NULL
          GROUP BY cluster_id
          HAVING COUNT(*) >= $2
        )
        SELECT 
          cluster_id,
          vertex_count,
          ST_X(centroid) as centroid_lng,
          ST_Y(centroid) as centroid_lat,
          ST_Z(centroid) as centroid_elevation,
          max_distance,
          vertex_ids,
          lngs,
          lats,
          elevations
        FROM cluster_summaries
        ORDER BY vertex_count DESC, max_distance ASC
      `, [toleranceDegrees, config.minClusterSize]);

      result.clustersFound = clusters.rows.length;
      console.log(`   📊 Found ${result.clustersFound} vertex clusters`);

      if (result.clustersFound === 0) {
        result.totalVerticesAfter = result.totalVerticesBefore;
        return result;
      }

      // Step 3: Consolidate vertices in each cluster
      let totalConsolidated = 0;
      
      for (const cluster of clusters.rows) {
        const clusterId = cluster.cluster_id;
        const vertexCount = cluster.vertex_count;
        const vertexIds = cluster.vertex_ids;
        const centroidLng = cluster.centroid_lng;
        const centroidLat = cluster.centroid_lat;
        const centroidElevation = cluster.centroid_elevation;
        const maxDistance = cluster.max_distance;

        // Use the first vertex ID as the "master" vertex
        const masterVertexId = vertexIds[0];
        const verticesToUpdate = vertexIds.slice(1); // All except the master

        console.log(`   ✅ Cluster ${clusterId}: ${vertexCount} vertices → 1 shared vertex (max distance: ${maxDistance.toFixed(3)}m)`);

        // Update all edges that reference the vertices to be consolidated
        const edgesUpdated = await this.pgClient.query(`
          UPDATE ${this.stagingSchema}.ways_noded
          SET source = CASE 
            WHEN source = ANY($1) THEN $2
            ELSE source
          END,
          target = CASE 
            WHEN target = ANY($1) THEN $2
            ELSE target
          END
          WHERE source = ANY($1) OR target = ANY($1)
        `, [verticesToUpdate, masterVertexId]);

        // Update the master vertex to the centroid position
        await this.pgClient.query(`
          UPDATE ${this.stagingSchema}.ways_noded_vertices_pgr
          SET the_geom = ST_SetSRID(ST_MakePoint($1, $2, $3), 4326)
          WHERE id = $4
        `, [centroidLng, centroidLat, centroidElevation, masterVertexId]);

        // Delete the consolidated vertices
        await this.pgClient.query(`
          DELETE FROM ${this.stagingSchema}.ways_noded_vertices_pgr
          WHERE id = ANY($1)
        `, [verticesToUpdate]);

        // Remove self-loops that might have been created
        await this.pgClient.query(`
          DELETE FROM ${this.stagingSchema}.ways_noded
          WHERE source = target
        `);

        totalConsolidated += verticesToUpdate.length;

        result.details.push({
          clusterId,
          originalVertices: vertexCount,
          centroid: [centroidLng, centroidLat, centroidElevation],
          vertexIds: vertexIds,
          consolidationDistance: maxDistance
        });
      }

      // Step 4: Recompute vertex degrees after consolidation
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways_noded_vertices_pgr v
        SET cnt = (
          SELECT COUNT(*) FROM ${this.stagingSchema}.ways_noded e 
          WHERE e.source = v.id OR e.target = v.id
        )
      `);

      // Step 5: Count total vertices after consolidation
      const afterCount = await this.pgClient.query(`
        SELECT COUNT(*) as total_vertices
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr
        WHERE the_geom IS NOT NULL
      `);
      result.totalVerticesAfter = parseInt(afterCount.rows[0].total_vertices);
      result.verticesConsolidated = totalConsolidated;

      console.log(`✅ Vertex consolidation complete:`);
      console.log(`   📊 Before: ${result.totalVerticesBefore} vertices`);
      console.log(`   📊 After: ${result.totalVerticesAfter} vertices`);
      console.log(`   🔗 Reduced by: ${result.verticesConsolidated} vertices`);
      console.log(`   📍 Consolidated: ${totalConsolidated} vertices in ${result.clustersFound} clusters`);

    } catch (error) {
      console.error('❌ Error during vertex consolidation:', error);
      throw error;
    }

    return result;
  }
}
