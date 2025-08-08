import { RouteScorer, RouteScorerContext, RouteCandidate } from './RouteScorer';
import { computeRouteFeaturesFromEdges } from './RouteFeatures';

export class HeuristicScorer implements RouteScorer {
  name = 'heuristic';

  async score(candidates: RouteCandidate[], _ctx: RouteScorerContext): Promise<number[]> {
    const scores: number[] = [];
    for (const c of candidates) {
      const route = c.route || {};
      const routeEdges = route.route_edges || [];
      const f = computeRouteFeaturesFromEdges(routeEdges);

      // Prioritize steepness: favor routes whose gain rate (m/km) meets or exceeds pattern target
      const totalKm = Math.max(f.length_km || 0, 0.001);
      const actualGainRate = (f.elevation_gain || 0) / totalKm; // m/km
      const inputDistanceKm = Math.max(route.input_length_km || 0, 0.001);
      const inputElevationGain = Math.max(route.input_elevation_gain || 0, 0);
      const targetGainRate = inputElevationGain / inputDistanceKm; // m/km desired for this pattern

      // Closeness to target (0..1); slight boost if exceeding target
      const closeness = targetGainRate > 0
        ? Math.max(0, 1 - Math.abs(actualGainRate - targetGainRate) / targetGainRate)
        : 0;
      const exceedBoost = actualGainRate > targetGainRate ? 0.1 : 0; // small reward for steeper

      // Support features: prefer singletrack, lightly penalize road
      const singletrack = (f.singletrack_percentage || 0);
      const road = (f.road_percentage || 0);
      const diversity = Math.min((f.unique_trails || 0) / 5, 1); // cap at 1

      // Final score normalized to a 0..100-style number (not strictly required by reranker)
      const score = 100 * (
        0.8 * Math.min(1, closeness + exceedBoost) +
        0.15 * singletrack +
        0.05 * (1 - Math.min(1, road)) +
        0.05 * diversity
      );

      scores.push(score);
    }
    return scores;
  }
}


