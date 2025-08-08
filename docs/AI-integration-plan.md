## AI Integration Plan

### Goals
- Improve route quality (scenic, fewer zig-zags, better surfaces)
- Increase diversity (reduce near-duplicates among top results)
- Optional personalization (later)
- Keep core pgRouting fast; integrate via orchestrator; JSON-first outputs

### Phases

### Phase 0: Heuristic improvements (no ML)
- Multi-objective cost: grade, surface, crossings, turn penalties, overlap/diversity
- Better out-and-back handling when loops are not possible

### Phase 1: Learning-to-Rank (LTR) reranker (recommended)
- Generate top-K via KSP
- Compute route-level features
- Rerank with a local model (e.g., XGBoost Rank)

### Phase 2: Optional GNN/Personalization
- GNN for edge desirability to adjust costs pre-search
- Cohort-based → per-user personalization

### Architecture Changes (minimal)
- New scoring module:
  - `src/utils/scoring/RouteScorer.ts` (interface)
  - `src/utils/scoring/RouteFeatures.ts` (feature aggregation)
  - `src/utils/scoring/HeuristicScorer.ts` (baseline)
  - `src/utils/scoring/LTRModelScorer.ts` (loads model JSON)
- Hooks:
  - Call scorer after KSP in `src/utils/services/ksp-route-generator-service.ts`
  - Pass context from `src/utils/business/route-generation-business-logic.ts`
- Config (off by default) in `configs/carthorse.config.yaml`:
  - `scoring.enabled: false`
  - `scoring.scorer: heuristic | ltr`
  - `scoring.model-path: models/route_ltr_model.json`
- Model artifact:
  - `models/route_ltr_model.json` (small, local, no network)

### Orchestrator Workflow (required)
- Use `CarthorseOrchestrator` for all operations:

```
npx ts-node src/orchestrator/CarthorseOrchestrator.ts install
npx ts-node src/orchestrator/CarthorseOrchestrator.ts export --region <region> --out <file.db>
npx ts-node src/orchestrator/CarthorseOrchestrator.ts validate --region <region>
npx ts-node src/orchestrator/CarthorseOrchestrator.ts cleanup
```

- New (training data export):

```
npx ts-node src/orchestrator/CarthorseOrchestrator.ts export-training-data --region <region> --out training.json
```

- Implemented as an orchestrator method; no one-off scripts

### Data & Features
- Edge-wise: length, grade/elevation gain, surface, trail class, crossings, intersection angle, road/trail type, protected area proximity
- Route-wise (aggregated): avg/max grade, gain per km, % singletrack, % road, crossings count, turn sharpness, overlap ratio with prior routes, length buckets
- Region passed dynamically via config; avoid hardcoded regions

### Evaluation
- Offline: NDCG@K, diversity (Jaccard overlap penalty), elevation smoothness, road% reduction
- A/B or shadow: compare current vs reranked outputs; JSON diffs in staging exports
- Guardrails: if model missing/invalid, skip reranking (fallback to current behavior)

### Privacy & Ops
- Local-only models; no external calls
- Toggleable via config per environment
- Backwards-compatible; same KSP candidates if disabled

### Milestones
- M1: `HeuristicScorer` + hook + config toggle (1–2 days)
- M2: Orchestrator `export-training-data` + feature export (1–2 days)
- M3: Train LTR, ship `models/route_ltr_model.json`, enable in staging (2–3 days)
- M4: Metrics review; decide on enabling by default. Optional: GNN exploration

### Open Questions
- Preferred initial objective trade-offs (grade vs road% vs turns)?
- Minimum diversity target across top-5?
- Any region-specific constraints we should encode?

### Appendix: Interfaces (summary)

```ts
export interface RouteScorerContext {
  region: string;
  userProfile?: { fitness: number; avoidsRoads?: boolean };
}

export interface RouteCandidate {
  id: string;
  edgeIds: number[]; // pgRouting IDs
  features?: Record<string, number>;
}

export interface RouteScorer {
  name: string;
  score(candidates: RouteCandidate[], ctx: RouteScorerContext): Promise<number[]>;
}
```


