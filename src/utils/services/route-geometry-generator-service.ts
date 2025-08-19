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
  async generateRouteGeometry(edgeIds: number[]): Promise<any> {
    if (!edgeIds || edgeIds.length === 0) {
      return null;
    }

    try {
      const result = await this.pgClient.query(`
        WITH route_edges AS (
          SELECT the_geom 
          FROM ${this.config.stagingSchema}.ways_noded 
          WHERE id = ANY($1)
        ),
        route_3d_geom AS (
          SELECT 
            ST_Force3D(
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(the_geom))) = 'ST_MultiLineString' THEN
                  ST_GeometryN(ST_LineMerge(ST_Union(the_geom)), 1)
                ELSE
                  ST_LineMerge(ST_Union(the_geom))
              END
            ) as route_geometry
          FROM route_edges
        )
        SELECT route_geometry FROM route_3d_geom
        WHERE ST_IsValid(route_geometry)
      `, [edgeIds]);

      return result.rows[0]?.route_geometry || null;
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
        WITH route_edges AS (
          SELECT the_geom 
          FROM ${this.config.stagingSchema}.ways_noded 
          WHERE id = ANY($1)
        ),
        route_3d_geom AS (
          SELECT 
            ST_Force3D(
              CASE 
                WHEN ST_GeometryType(ST_LineMerge(ST_Union(the_geom))) = 'ST_MultiLineString' THEN
                  ST_GeometryN(ST_LineMerge(ST_Union(the_geom)), 1)
                ELSE
                  ST_LineMerge(ST_Union(the_geom))
              END
            ) as route_geometry
          FROM route_edges
        )
        SELECT route_geometry FROM route_3d_geom
        WHERE ST_IsValid(route_geometry) AND NOT ST_IsEmpty(route_geometry)
      `, [edgeIds]);

      return result.rows[0]?.route_geometry || null;
    } catch (error) {
      console.error('❌ Error generating route geometry with validation:', error);
      return null;
    }
  }
}
