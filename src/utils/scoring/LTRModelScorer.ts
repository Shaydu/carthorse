import * as fs from 'fs';
import * as path from 'path';
import { RouteScorer, RouteScorerContext, RouteCandidate } from './RouteScorer';
import { computeRouteFeaturesFromEdges } from './RouteFeatures';

type GenericModel = {
  // Minimal shape to allow future plug-in of XGBoost/LightGBM JSON
  // For now, expect a simple linear model: weights: { featureName: number }, bias?: number
  type: 'linear' | 'xgboost-json' | string;
  weights?: Record<string, number>;
  bias?: number;
};

export class LTRModelScorer implements RouteScorer {
  name = 'ltr';
  private model: GenericModel | null = null;

  constructor(private modelPath?: string) {
    if (modelPath) this.load(modelPath);
  }

  load(modelPath: string): void {
    const p = path.isAbsolute(modelPath) ? modelPath : path.join(process.cwd(), modelPath);
    if (!fs.existsSync(p)) {
      throw new Error(`Model file not found: ${p}`);
    }
    const raw = fs.readFileSync(p, 'utf8');
    this.model = JSON.parse(raw);
  }

  async score(candidates: RouteCandidate[], _ctx: RouteScorerContext): Promise<number[]> {
    if (!this.model) {
      // No model: neutral scores to preserve input order
      return candidates.map(() => 0);
    }

    if (this.model.type === 'linear' && this.model.weights) {
      return candidates.map((c) => {
        const edges = (c.route || {}).route_edges || [];
        const f = computeRouteFeaturesFromEdges(edges);
        const bias = this.model!.bias || 0;
        let s = bias;
        for (const [k, w] of Object.entries(this.model!.weights!)) {
          const v = (f as any)[k] || 0;
          s += w * v;
        }
        return s;
      });
    }

    // Fallback: neutral
    return candidates.map(() => 0);
  }
}


