/**
 * SQL functions for recalculating elevation statistics from 3D geometry
 * This is needed after trail splitting to ensure accurate elevation data
 */

export function getElevationRecalculationFunctionSql(): string {
  return `
    -- Simple function to recalculate elevation statistics from 3D geometry
    CREATE OR REPLACE FUNCTION recalculate_elevation_stats(
      trail_geometry GEOMETRY
    ) RETURNS TABLE (
      min_elevation REAL,
      max_elevation REAL,
      avg_elevation REAL,
      elevation_gain REAL,
      elevation_loss REAL
    ) AS $$
    BEGIN
      -- Use PostGIS functions to calculate elevation statistics directly
      RETURN QUERY
      WITH elevation_points AS (
        SELECT 
          ST_Z(ST_PointN(trail_geometry, generate_series(1, ST_NPoints(trail_geometry)))) as elev
        WHERE ST_NDims(trail_geometry) = 3
          AND ST_IsValid(trail_geometry)
      ),
      valid_elevations AS (
        SELECT elev
        FROM elevation_points
        WHERE elev IS NOT NULL 
          AND elev >= -1000 
          AND elev <= 10000
      ),
      elevation_stats AS (
        SELECT 
          MIN(elev) as min_elev,
          MAX(elev) as max_elev,
          AVG(elev) as avg_elev,
          COUNT(*) as point_count
        FROM valid_elevations
      ),
      gain_loss AS (
        SELECT 
          COALESCE(SUM(elevation_gain), 0) as total_gain,
          COALESCE(SUM(elevation_loss), 0) as total_loss
        FROM (
          SELECT 
            CASE WHEN elev > LAG(elev) OVER (ORDER BY generate_series) 
                 THEN elev - LAG(elev) OVER (ORDER BY generate_series) 
                 ELSE 0 END as elevation_gain,
            CASE WHEN elev < LAG(elev) OVER (ORDER BY generate_series) 
                 THEN LAG(elev) OVER (ORDER BY generate_series) - elev 
                 ELSE 0 END as elevation_loss
          FROM elevation_points
          WHERE elev IS NOT NULL 
            AND elev >= -1000 
            AND elev <= 10000
        ) gain_loss_calc
      )
      SELECT 
        COALESCE(es.min_elev, 0)::REAL,
        COALESCE(es.max_elev, 0)::REAL,
        COALESCE(es.avg_elev, 0)::REAL,
        COALESCE(gl.total_gain, 0)::REAL,
        COALESCE(gl.total_loss, 0)::REAL
      FROM elevation_stats es
      CROSS JOIN gain_loss gl;
    END;
    $$ LANGUAGE plpgsql;
  `;
}

export function getUpdateTrailElevationStatsSql(schemaName: string): string {
  return `
    -- Update elevation statistics for all trails in a schema using direct SQL
    UPDATE ${schemaName}.trails 
    SET 
      min_elevation = COALESCE(elevation_data.min_elev, 0),
      max_elevation = COALESCE(elevation_data.max_elev, 0),
      avg_elevation = COALESCE(elevation_data.avg_elev, 0),
      elevation_gain = COALESCE(elevation_data.total_gain, 0),
      elevation_loss = COALESCE(elevation_data.total_loss, 0)
    FROM (
      WITH elevation_points AS (
        SELECT 
          t.app_uuid,
          ST_Z(ST_PointN(t.geometry, generate_series(1, ST_NPoints(t.geometry)))) as elev,
          generate_series(1, ST_NPoints(t.geometry)) as point_order
        FROM ${schemaName}.trails t
        WHERE t.geometry IS NOT NULL 
          AND ST_NDims(t.geometry) = 3
          AND ST_IsValid(t.geometry)
      ),
      valid_elevations AS (
        SELECT 
          app_uuid,
          elev,
          point_order
        FROM elevation_points
        WHERE elev IS NOT NULL 
          AND elev >= -1000 
          AND elev <= 10000
      ),
      elevation_stats AS (
        SELECT 
          app_uuid,
          MIN(elev) as min_elev,
          MAX(elev) as max_elev,
          AVG(elev) as avg_elev
        FROM valid_elevations
        GROUP BY app_uuid
      ),
      gain_loss AS (
        SELECT 
          app_uuid,
          COALESCE(SUM(elevation_gain), 0) as total_gain,
          COALESCE(SUM(elevation_loss), 0) as total_loss
        FROM (
          SELECT 
            app_uuid,
            CASE WHEN elev > LAG(elev) OVER (PARTITION BY app_uuid ORDER BY point_order) 
                 THEN elev - LAG(elev) OVER (PARTITION BY app_uuid ORDER BY point_order) 
                 ELSE 0 END as elevation_gain,
            CASE WHEN elev < LAG(elev) OVER (PARTITION BY app_uuid ORDER BY point_order) 
                 THEN LAG(elev) OVER (PARTITION BY app_uuid ORDER BY point_order) - elev 
                 ELSE 0 END as elevation_loss
          FROM valid_elevations
        ) gain_loss_calc
        GROUP BY app_uuid
      )
      SELECT 
        es.app_uuid,
        es.min_elev,
        es.max_elev,
        es.avg_elev,
        gl.total_gain,
        gl.total_loss
      FROM elevation_stats es
      LEFT JOIN gain_loss gl ON es.app_uuid = gl.app_uuid
    ) elevation_data
    WHERE ${schemaName}.trails.app_uuid = elevation_data.app_uuid;
  `;
}

export function getUpdateTrailElevationStatsForSplitSegmentsSql(schemaName: string, segmentTableName: string): string {
  return `
    -- Update elevation statistics for split trail segments
    UPDATE ${schemaName}.${segmentTableName}
    SET 
      min_elevation = stats.min_elevation,
      max_elevation = stats.max_elevation,
      avg_elevation = stats.avg_elevation,
      elevation_gain = stats.elevation_gain,
      elevation_loss = stats.elevation_loss
    FROM (
      SELECT 
        app_uuid,
        (recalculate_elevation_stats(geometry)).*
      FROM ${schemaName}.${segmentTableName}
      WHERE geometry IS NOT NULL 
        AND ST_NDims(geometry) = 3
        AND ST_IsValid(geometry)
    ) stats
    WHERE ${schemaName}.${segmentTableName}.app_uuid = stats.app_uuid;
  `;
}
