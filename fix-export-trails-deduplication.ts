// Fix for exportTrails method to deduplicate by geometry
// This prevents exporting multiple trails with the same geometry but different names

// The issue is in the exportTrails() method in src/utils/export/geojson-export-strategy.ts
// The current query doesn't deduplicate by geometry, causing duplicate geometries with different names

// Here's the fix for the exportTrails() method:

/*
  private async exportTrails(): Promise<GeoJSONFeature[]> {
    const trailsResult = await this.pgClient.query(`
      SELECT DISTINCT ON (ST_AsText(geometry))
        app_uuid, name, 
        trail_type, surface as surface_type, 
        CASE 
          WHEN difficulty = 'unknown' THEN 'moderate'
          ELSE difficulty
        END as difficulty,
        ST_AsGeoJSON(geometry, 6, 0) as geojson,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL
        AND ST_NumPoints(geometry) >= 2
        AND ST_Length(geometry::geography) > 0
      ORDER BY ST_AsText(geometry), name
    `);
    
    if (trailsResult.rows.length === 0) {
      throw new Error('No trails found to export');
    }
    
    const trailStyling = this.exportConfig.geojson?.styling?.trails || {
      color: "#228B22",
      stroke: "#228B22",
      strokeWidth: 2,
      fillOpacity: 0.6
    };
    
    return trailsResult.rows.map((trail: any) => ({
      type: 'Feature',
      properties: {
        id: trail.app_uuid,
        name: trail.name,
        source_identifier: trail.app_uuid, // Use app_uuid as generic source identifier
        trail_type: trail.trail_type,
        surface_type: trail.surface_type,
        difficulty: trail.difficulty,
        length_km: trail.length_km,
        elevation_gain: trail.elevation_gain,
        elevation_loss: trail.elevation_loss,
        max_elevation: trail.max_elevation,
        min_elevation: trail.min_elevation,
        avg_elevation: trail.avg_elevation,
        bbox_min_lng: trail.bbox_min_lng,
        bbox_max_lng: trail.bbox_max_lng,
        bbox_min_lat: trail.bbox_min_lat,
        bbox_max_lat: trail.bbox_max_lat,
        type: 'trail',
        color: trailStyling.color,
        stroke: trailStyling.stroke,
        strokeWidth: trailStyling.strokeWidth,
        fillOpacity: trailStyling.fillOpacity
      },
      geometry: JSON.parse(trail.geojson)
    }));
  }
*/

// Key changes:
// 1. Added DISTINCT ON (ST_AsText(geometry)) to deduplicate by geometry
// 2. Changed ORDER BY to ST_AsText(geometry), name to ensure consistent ordering
// 3. This will keep the first trail (alphabetically by name) for each unique geometry

// To apply this fix, you need to modify the exportTrails() method in:
// src/utils/export/geojson-export-strategy.ts around line 474
