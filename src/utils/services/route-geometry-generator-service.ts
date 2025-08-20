import { Pool } from 'pg';

export interface RouteGeometryGeneratorConfig {
  stagingSchema: string;
}

/**
 * Shared service for generating route geometries from edge IDs
 * Used by all route generation services to ensure consistent geometry creation
 */
export class RouteGeometryGeneratorService {
  private config: RouteGeometryGeneratorConfig;
  private pgClient: Pool;

  constructor(pgClient: Pool, config: RouteGeometryGeneratorConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Generate route geometry from a list of edge IDs
   * @param edgeIds Array of edge IDs from ways_noded table
   * @param routeType Optional route type (e.g., 'out-and-back', 'loop')
   * @returns PostGIS geometry or null if generation fails
   */
  async generateRouteGeometry(edgeIds: number[], routeType?: string): Promise<any> {
    if (!edgeIds || edgeIds.length === 0) {
      return null;
    }

    try {
      const isOutAndBack = routeType === 'out-and-back';
      
      if (isOutAndBack) {
        // For out-and-back routes, we need to:
        // 1. Create outbound geometry (start to midpoint)
        // 2. Create return geometry by reversing the outbound (midpoint back to start)
        // 3. Properly connect them at the midpoint without artificial connectors
        
        const result = await this.pgClient.query(`
          WITH path(edge_id, ord) AS (
            SELECT edge_id::bigint, ord::int
            FROM unnest($1::bigint[]) WITH ORDINALITY AS u(edge_id, ord)
          ),
          ordered_edges AS (
            SELECT w.the_geom, p.ord
            FROM path p
            JOIN ${this.config.stagingSchema}.ways_noded w ON w.id = p.edge_id
            WHERE w.the_geom IS NOT NULL AND ST_IsValid(w.the_geom)
            ORDER BY p.ord
          ),
          outbound_geometry AS (
            SELECT ST_Force3D(ST_MakeLine(the_geom ORDER BY ord)) AS outbound_geom
            FROM ordered_edges
          ),
          return_geometry AS (
            -- Reverse the outbound geometry to create the return path
            -- This ensures we follow the exact same trail path back to start
            SELECT ST_Reverse(outbound_geom) AS return_geom
            FROM outbound_geometry
          ),
          complete_route AS (
            SELECT 
              CASE 
                WHEN outbound_geom IS NOT NULL AND return_geom IS NOT NULL THEN
                  -- Create a single continuous line that goes out and back
                  -- The return geometry is properly reversed and connected at the midpoint
                  ST_Force3D(ST_LineMerge(ST_Collect(outbound_geom, return_geom)))
                ELSE
                  outbound_geom
              END AS route_geometry
            FROM outbound_geometry, return_geometry
          )
          SELECT route_geometry FROM complete_route
          WHERE route_geometry IS NOT NULL AND NOT ST_IsEmpty(route_geometry) AND ST_IsValid(route_geometry)
        `, [edgeIds]);
        
        return result.rows[0]?.route_geometry || null;
      } else {
        // For non-out-and-back routes (including loops), use the original logic
        const result = await this.pgClient.query(`
          WITH path(edge_id, ord) AS (
            SELECT edge_id::bigint, ord::int
            FROM unnest($1::bigint[]) WITH ORDINALITY AS u(edge_id, ord)
          ),
          ordered_edges AS (
            SELECT w.the_geom, p.ord
            FROM path p
            JOIN ${this.config.stagingSchema}.ways_noded w ON w.id = p.edge_id
            WHERE w.the_geom IS NOT NULL AND ST_IsValid(w.the_geom)
            ORDER BY p.ord
          ),
          route_geom AS (
            SELECT ST_Force3D(ST_MakeLine(the_geom ORDER BY ord)) AS route_geometry
            FROM ordered_edges
          )
          SELECT route_geometry FROM route_geom
          WHERE route_geometry IS NOT NULL AND NOT ST_IsEmpty(route_geometry) AND ST_IsValid(route_geometry)
        `, [edgeIds]);

        return result.rows[0]?.route_geometry || null;
      }
    } catch (error) {
      console.error('❌ Error generating route geometry:', error);
      return null;
    }
  }
}
