export interface RouteScorerContext {
  region: string;
  userProfile?: {
    fitness?: number;
    avoidsRoads?: boolean;
  };
}

export interface RouteCandidate {
  id: string;
  // Minimal shape to avoid importing types; contains the full recommendation object
  route: any;
}

export interface RouteScorer {
  name: string;
  score(candidates: RouteCandidate[], ctx: RouteScorerContext): Promise<number[]>;
}


