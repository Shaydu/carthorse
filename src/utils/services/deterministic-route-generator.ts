import { Pool, Client } from 'pg';
import { createHash } from 'crypto';

export interface DeterministicRouteConfig {
  stagingSchema: string;
  targetDistanceKm: number;
  targetElevationGain: number;
  tolerancePercent: number;
  maxRoutes: number;
  seed?: string; // Optional seed for deterministic generation
}

export interface DeterministicRoute {
  route_uuid: string;
  route_name: string;
  route_type: string;
  route_shape: string;
  input_length_km: number;
  input_elevation_gain: number;
  recommended_length_km: number;
  recommended_elevation_gain: number;
  route_score: number;
  route_path: any;
  route_edges: any[];
  trail_count: number;
  region: string;
}

export class DeterministicRouteGenerator {
  private pgClient: Pool | Client;
  private config: DeterministicRouteConfig;

  constructor(pgClient: Pool | Client, config: DeterministicRouteConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Generate a deterministic UUID based on route characteristics
   */
  private generateDeterministicUUID(routeData: any): string {
    const seed = this.config.seed || 'default-seed';
    const routeHash = createHash('sha256')
      .update(JSON.stringify({
        seed,
        targetDistance: this.config.targetDistanceKm,
        targetElevation: this.config.targetElevationGain,
        routePath: routeData.path,
        routeEdges: routeData.edges,
        startNode: routeData.start_node,
        endNode: routeData.end_node
      }))
      .digest('hex');
    
    // Convert hash to UUID format
    return `${routeHash.slice(0, 8)}-${routeHash.slice(8, 12)}-${routeHash.slice(12, 16)}-${routeHash.slice(16, 20)}-${routeHash.slice(20, 32)}`;
  }

  /**
   * Generate deterministic route recommendations
   */
  async generateDeterministicRoutes(): Promise<DeterministicRoute[]> {
    console.log(`🎯 Generating deterministic routes: ${this.config.targetDistanceKm}km, ${this.config.targetElevationGain}m elevation`);
    
    const routes: DeterministicRoute[] = [];
    
    try {
      // Use a deterministic approach to find routes
      const result = await this.pgClient.query(`
        WITH RECURSIVE route_search AS (
          -- Start with all nodes as potential starting points
          SELECT 
            id as start_node,
            id as current_node,
            id as end_node,
            ARRAY[id] as path,
            ARRAY[]::integer[] as edges,
            0.0::float as total_distance_km,
            0.0::float as total_elevation_gain,
            0 as depth,
            ARRAY[]::text[] as trail_names
          FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
          
          UNION ALL
          
          -- Recursively explore connected nodes
          SELECT 
            rs.start_node,
            w.target as current_node,
            w.target as end_node,
            rs.path || w.target,
            rs.edges || w.id,
            rs.total_distance_km + w.length_km,
            rs.total_elevation_gain + COALESCE(w.elevation_gain, 0),
            rs.depth + 1,
            rs.trail_names || COALESCE(w.name, 'unnamed')
          FROM route_search rs
          JOIN ${this.config.stagingSchema}.ways_noded w ON rs.current_node = w.source
          WHERE rs.depth < 8  -- Limit depth
            AND w.target != ALL(rs.path)  -- Avoid cycles
            AND rs.total_distance_km + w.length_km <= $1 * (1 + $2 / 100.0)  -- Distance tolerance
            AND rs.total_elevation_gain + COALESCE(w.elevation_gain, 0) <= $3 * (1 + $2 / 100.0)  -- Elevation tolerance
        ),
        valid_routes AS (
          SELECT 
            start_node,
            end_node,
            total_distance_km,
            total_elevation_gain,
            path,
            edges,
            trail_names,
            CASE 
              WHEN start_node = end_node THEN 'loop'
              WHEN array_length(path, 1) = 2 THEN 'out-and-back'
              WHEN array_length(path, 1) > 2 AND start_node = end_node THEN 'loop'
              ELSE 'point-to-point'
            END as route_shape,
            array_length(array_agg(DISTINCT trail_names), 1) as trail_count,
            GREATEST(0.0, 1.0 - (
              ABS(total_distance_km - $1) / $1 + 
              ABS(total_elevation_gain - $3) / NULLIF($3, 0)
            ) / 2.0) as similarity_score
          FROM route_search
          WHERE total_distance_km >= $1 * (1 - $2 / 100.0)  -- Minimum distance
            AND total_distance_km <= $1 * (1 + $2 / 100.0)  -- Maximum distance
            AND total_elevation_gain >= $3 * (1 - $2 / 100.0)  -- Minimum elevation
            AND total_elevation_gain <= $3 * (1 + $2 / 100.0)  -- Maximum elevation
            AND array_length(path, 1) >= 2  -- At least 2 nodes
            AND total_distance_km >= 0.5  -- Minimum 0.5km
            AND total_distance_km <= 50.0  -- Maximum 50km
            AND total_elevation_gain >= 0  -- Minimum elevation
            AND total_elevation_gain <= 2000  -- Maximum 2000m
          GROUP BY start_node, end_node, total_distance_km, total_elevation_gain, path, edges, trail_names
        )
        SELECT 
          start_node,
          end_node,
          total_distance_km,
          total_elevation_gain,
          path,
          edges,
          route_shape,
          trail_count,
          similarity_score,
          trail_names
        FROM valid_routes
        WHERE similarity_score >= 0.3
        ORDER BY similarity_score DESC, total_distance_km
        LIMIT $4
      `, [
        this.config.targetDistanceKm,
        this.config.tolerancePercent,
        this.config.targetElevationGain,
        this.config.maxRoutes
      ]);

      console.log(`✅ Found ${result.rows.length} potential routes`);

      // Convert to deterministic routes
      for (const row of result.rows) {
        const routeData = {
          path: row.path,
          edges: row.edges,
          start_node: row.start_node,
          end_node: row.end_node
        };

        const route: DeterministicRoute = {
          route_uuid: this.generateDeterministicUUID(routeData),
          route_name: this.generateRouteName(row.trail_names, row.route_shape),
          route_type: 'out-and-back',
          route_shape: row.route_shape,
          input_length_km: this.config.targetDistanceKm,
          input_elevation_gain: this.config.targetElevationGain,
          recommended_length_km: row.total_distance_km,
          recommended_elevation_gain: row.total_elevation_gain,
          route_score: Math.floor(row.similarity_score * 100),
          route_path: { path: row.path },
          route_edges: await this.getRouteEdges(row.edges),
          trail_count: row.trail_count,
          region: 'boulder'
        };

        routes.push(route);
      }

      console.log(`✅ Generated ${routes.length} deterministic routes`);
      return routes;

    } catch (error) {
      console.error('❌ Error generating deterministic routes:', error);
      return [];
    }
  }

  /**
   * Generate a consistent route name
   */
  private generateRouteName(trailNames: string[], routeShape: string): string {
    const uniqueTrails = [...new Set(trailNames)].filter(name => name && name !== 'unnamed');
    
    if (uniqueTrails.length === 0) {
      return `Unnamed ${routeShape}`;
    } else if (uniqueTrails.length === 1) {
      return `${uniqueTrails[0]} ${routeShape}`;
    } else if (uniqueTrails.length === 2) {
      return `${uniqueTrails[0]} and ${uniqueTrails[1]} ${routeShape}`;
    } else {
      return `${uniqueTrails[0]} via ${uniqueTrails.slice(1, -1).join(', ')} and ${uniqueTrails[uniqueTrails.length - 1]} ${routeShape}`;
    }
  }

  /**
   * Get route edges details
   */
  private async getRouteEdges(edgeIds: number[]): Promise<any[]> {
    if (edgeIds.length === 0) return [];

    const result = await this.pgClient.query(`
      SELECT 
        id,
        length_km as cost,
        COALESCE(name, 'Unnamed Trail') as trail_name,
        'trail' as trail_type,
        COALESCE(elevation_gain, 0) as elevation_gain,
        COALESCE(elevation_loss, 0) as elevation_loss
      FROM ${this.config.stagingSchema}.ways_noded 
      WHERE id = ANY($1::integer[])
      ORDER BY array_position($1::integer[], id)
    `, [edgeIds]);

    return result.rows;
  }
}
