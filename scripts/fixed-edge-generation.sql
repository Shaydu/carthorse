
      INSERT INTO staging_example.routing_edges (source, target, trail_id, trail_name, length_km, elevation_gain, elevation_loss, geometry, geojson)
      WITH trail_segments AS (
        -- For each trail segment, find its start and end points
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          length_km,
          elevation_gain,
          elevation_loss,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          ST_Force2D(geometry) as trail_geometry
        FROM staging_example.trails
        WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry) 
        AND length_km > 0
      ),
      start_nodes AS (
        -- Find the closest node to each trail start point
        SELECT DISTINCT ON (ts.trail_id)
          ts.trail_id,
          ts.trail_name,
          ts.length_km,
          ts.elevation_gain,
          ts.elevation_loss,
          ts.trail_geometry,
          n.id as source_id,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            ts.start_point
          ) as start_distance
        FROM trail_segments ts
        JOIN staging_example.routing_nodes n ON 
          ST_DWithin(
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            ts.start_point,
            0.0001
          )
        ORDER BY ts.trail_id, start_distance ASC
      ),
      end_nodes AS (
        -- Find the closest node to each trail end point
        SELECT DISTINCT ON (sn.trail_id)
          sn.trail_id,
          sn.trail_name,
          sn.length_km,
          sn.elevation_gain,
          sn.elevation_loss,
          sn.trail_geometry,
          sn.source_id,
          n.id as target_id,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            ts.end_point
          ) as end_distance
        FROM start_nodes sn
        JOIN trail_segments ts ON sn.trail_id = ts.trail_id
        JOIN staging_example.routing_nodes n ON 
          ST_DWithin(
            ST_SetSRID(ST_MakePoint(n.lng, n.lat), 4326),
            ts.end_point,
            0.0001
          )
        ORDER BY sn.trail_id, end_distance ASC
      )
      SELECT DISTINCT
        source_id as source,
        target_id as target,
        trail_id,
        trail_name,
        length_km,
        elevation_gain,
        elevation_loss,
        ST_MakeLine(
          ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
          ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)
        ) as geometry,
        ST_AsGeoJSON(
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(n1.lng, n1.lat), 4326),
            ST_SetSRID(ST_MakePoint(n2.lng, n2.lat), 4326)
          ), 6, 0
        ) as geojson
      FROM end_nodes
      JOIN staging_example.routing_nodes n1 ON n1.id = source_id
      JOIN staging_example.routing_nodes n2 ON n2.id = target_id
      WHERE source_id IS NOT NULL 
      AND target_id IS NOT NULL
      AND source_id <> target_id
    