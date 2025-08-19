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
        // 1. Create the outbound geometry (forward)
        // 2. Reverse the outbound geometry for the return leg
        // 3. Append them together
        
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
            SELECT ST_Reverse(outbound_geom) AS return_geom
            FROM outbound_geometry
          ),
          complete_route AS (
            SELECT 
              CASE 
                WHEN outbound_geom IS NOT NULL AND return_geom IS NOT NULL THEN
                  ST_Force3D(ST_MakeLine(ARRAY[outbound_geom, return_geom]))
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
        // For non-out-and-back routes, use the original logic
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

  /**
   * Generate route geometry with additional validation (for loop routes)
   * @param edgeIds Array of edge IDs from ways_noded table
   * @returns PostGIS geometry or null if generation fails
   */
  async generateRouteGeometryWithValidation(edgeIds: number[]): Promise<any> {
    if (!edgeIds || edgeIds.length === 0) {
      return null;
    }

    try {
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
    } catch (error) {
      console.error('❌ Error generating route geometry with validation:', error);
      return null;
    }
  }
}
