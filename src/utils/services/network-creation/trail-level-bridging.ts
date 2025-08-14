import { Pool } from 'pg';

/**
 * Trail-level bridging: insert short connector trail rows into staging.trails
 * between trail endpoints that are within a given tolerance. This ensures that
 * all downstream structures (ways, nodes/edges, routes) span bridged gaps.
 * 
 * ENHANCED: Avoids creating artificial degree-3 vertices by checking if
 * endpoints are already part of continuous trails or would create unnecessary intersections.
 */
export async function runTrailLevelBridging(
  pgClient: Pool,
  stagingSchema: string,
  toleranceMeters: number
): Promise<{ connectorsInserted: number }> {
  // Determine a default region value from existing staging trails
  const regionResult = await pgClient.query(
    `SELECT region FROM ${stagingSchema}.trails WHERE region IS NOT NULL LIMIT 1`
  );
  const defaultRegion = regionResult.rows[0]?.region || 'unknown';

  // Insert connector trails between close trail endpoints that are not already connected
  // ENHANCED: Avoid creating artificial degree-3 vertices
  const insertResult = await pgClient.query(
    `
    WITH trail_endpoints AS (
      SELECT 
        t.id AS trail_id,
        t.app_uuid,
        t.name,
        ST_StartPoint(t.geometry) AS pt_start,
        ST_EndPoint(t.geometry)   AS pt_end
      FROM ${stagingSchema}.trails t
      WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
    ),
    endpoints AS (
      SELECT app_uuid, name, pt_start AS pt FROM trail_endpoints
      UNION ALL
      SELECT app_uuid, name, pt_end   AS pt FROM trail_endpoints
    ),
    candidate_pairs AS (
      SELECT 
        e1.app_uuid AS app1,
        e2.app_uuid AS app2,
        e1.name     AS name1,
        e2.name     AS name2,
        e1.pt       AS geom1,
        e2.pt       AS geom2,
        ST_Distance(e1.pt::geography, e2.pt::geography) AS dist
      FROM endpoints e1
      JOIN endpoints e2 ON e1.app_uuid < e2.app_uuid
      WHERE ST_DWithin(e1.pt::geography, e2.pt::geography, $1)
        AND ST_Distance(e1.pt::geography, e2.pt::geography) > 0
    ),
    not_already_touching AS (
      SELECT * FROM candidate_pairs cp
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.app_uuid = cp.app1 AND t2.app_uuid = cp.app2
        WHERE ST_Touches(t1.geometry, t2.geometry) OR ST_Intersects(t1.geometry, t2.geometry)
      )
    ),
    -- ENHANCED: Check if creating a connector would create an artificial degree-3 vertex
    -- by looking for other trails that already connect to these endpoints
    avoid_artificial_intersections AS (
      SELECT * FROM not_already_touching cp
      WHERE NOT EXISTS (
        -- Check if either endpoint already has multiple trails connecting to it
        SELECT 1
        FROM ${stagingSchema}.trails t1
        JOIN ${stagingSchema}.trails t2 ON t1.app_uuid != t2.app_uuid
        WHERE (t1.app_uuid = cp.app1 OR t1.app_uuid = cp.app2)
          AND (t2.app_uuid = cp.app1 OR t2.app_uuid = cp.app2)
          AND (
            -- Check if there are other trails already connecting to these endpoints
            (ST_DWithin(ST_StartPoint(t1.geometry), cp.geom1, $1) AND ST_DWithin(ST_StartPoint(t2.geometry), cp.geom2, $1))
            OR (ST_DWithin(ST_EndPoint(t1.geometry), cp.geom1, $1) AND ST_DWithin(ST_EndPoint(t2.geometry), cp.geom2, $1))
            OR (ST_DWithin(ST_StartPoint(t1.geometry), cp.geom1, $1) AND ST_DWithin(ST_EndPoint(t2.geometry), cp.geom2, $1))
            OR (ST_DWithin(ST_EndPoint(t1.geometry), cp.geom1, $1) AND ST_DWithin(ST_StartPoint(t2.geometry), cp.geom2, $1))
          )
      )
    ),
    -- ENHANCED: Only create connectors for same-named trails or when endpoints are truly isolated
    smart_connectors AS (
      SELECT 
        'connector-' || md5(app1 || '-' || app2 || '-' || ST_AsText(geom1) || '-' || ST_AsText(geom2)) AS app_uuid,
        CASE 
          WHEN name1 = name2 THEN name1 || ' Connector'
          WHEN name1 LIKE '%' || name2 || '%' OR name2 LIKE '%' || name1 || '%' THEN 
            CASE WHEN LENGTH(name1) > LENGTH(name2) THEN name1 || ' Connector' ELSE name2 || ' Connector' END
          ELSE name1 || ' ↔ ' || name2 || ' Connector' 
        END AS name,
        ST_SetSRID(ST_MakeLine(geom1, geom2), 4326) AS geometry,
        dist
      FROM avoid_artificial_intersections
      WHERE 
        -- Only create connectors for same-named trails or when distance is very small
        -- AND enforce maximum distance limit for all connectors
        (name1 = name2 OR dist < ($1 * 0.5))  -- Same-named trails or very small gaps (half the tolerance)
        AND dist <= $1  -- Maximum distance limit (tolerance)
        AND dist > 0.1  -- Minimum distance to avoid self-connections
    ),
    to_insert AS (
      SELECT 
        app_uuid,
        name,
        geometry,
        ST_Length(geometry::geography) / 1000.0 AS length_km
      FROM smart_connectors
    )
    INSERT INTO ${stagingSchema}.trails (
      app_uuid, name, region, trail_type, surface, difficulty,
      geometry, length_km, elevation_gain, elevation_loss,
      bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
    )
    SELECT 
      app_uuid,
      name,
      $2::text AS region,
      'connector',
      'unknown',
      'unknown',
      geometry,
      length_km,
      0, 0,
      LEAST(ST_XMin(geometry), ST_XMax(geometry)),
      GREATEST(ST_XMin(geometry), ST_XMax(geometry)),
      LEAST(ST_YMin(geometry), ST_YMax(geometry)),
      GREATEST(ST_YMin(geometry), ST_YMax(geometry))
    FROM to_insert
    ON CONFLICT (app_uuid) DO NOTHING
    RETURNING 1
    `,
    [toleranceMeters, defaultRegion]
  );

  const connectorsInserted = insertResult.rowCount || 0;
  
  if (connectorsInserted > 0) {
    // Log details about the connectors created
    const connectorDetails = await pgClient.query(`
      SELECT name, length_km, app_uuid 
      FROM ${stagingSchema}.trails 
      WHERE app_uuid LIKE 'connector-%' 
      ORDER BY length_km DESC
      LIMIT 5
    `);
    
    if (connectorDetails.rows.length > 0) {
      console.log(`🔗 Created ${connectorsInserted} connectors. Longest connectors:`);
      connectorDetails.rows.forEach((connector: any, index: number) => {
        console.log(`   ${index + 1}. ${connector.name} (${connector.length_km.toFixed(3)}km) - ${connector.app_uuid}`);
      });
    }
  }
  
  return { connectorsInserted };
}


