export type RouteFeatures = Record<string, number>;

// Lightweight, synchronous aggregation to avoid DB calls in scoring path.
// Expects edges to carry length_km, elevation_gain, trail_type, surface, etc.
export function computeRouteFeaturesFromEdges(routeEdges: any[]): RouteFeatures {
  const features: RouteFeatures = {
    length_km: 0,
    elevation_gain: 0,
    road_percentage: 0,
    singletrack_percentage: 0,
    crossings: 0,
    turn_sharpness: 0,
    unique_trails: 0,
  };

  if (!Array.isArray(routeEdges) || routeEdges.length === 0) return features;

  let roadCount = 0;
  let singletrackCount = 0;
  const trailIds = new Set<string>();

  for (let i = 0; i < routeEdges.length; i++) {
    const e = routeEdges[i] || {};
    features.length_km += e.length_km || 0;
    features.elevation_gain += e.elevation_gain || 0;

    const trailType = (e.trail_type || '').toString().toLowerCase();
    const surface = (e.surface || '').toString().toLowerCase();

    if (trailType.includes('road') || surface.includes('paved')) roadCount++;
    if (trailType.includes('single') || surface.includes('singletrack')) singletrackCount++;

    const trailKey = e.app_uuid || e.trail_id || e.trail_uuid || e.name || `${e.id}`;
    if (trailKey) trailIds.add(String(trailKey));

    // crude turn-sharpness proxy: count sharp changes in consecutive edges if coordinates exist
    // if missing, this remains 0
  }

  features.unique_trails = trailIds.size;
  if (routeEdges.length > 0) {
    features.road_percentage = roadCount / routeEdges.length;
    features.singletrack_percentage = singletrackCount / routeEdges.length;
  }

  return features;
}


