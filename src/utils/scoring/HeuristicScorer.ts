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

      // Simple weighted utility; higher is better
      const score = (
        0
        - 0.6 * (f.elevation_gain || 0)
        - 0.2 * (f.road_percentage || 0)
        - 0.1 * (f.turn_sharpness || 0)
        - 0.1 * (f.crossings || 0)
        + 0.3 * (f.singletrack_percentage || 0)
        + 0.05 * (f.unique_trails || 0)
      );

      scores.push(score);
    }
    return scores;
  }
}


