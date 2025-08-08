import { Pool } from 'pg';
import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';
import { RoutePatternSqlHelpers } from '../sql/route-pattern-sql-helpers';
import { RouteGenerationBusinessLogic, ToleranceLevel } from '../business/route-generation-business-logic';
import { ConstituentTrailAnalysisService } from './constituent-trail-analysis-service';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';

export interface DijkstraRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
}

export class DijkstraRouteGeneratorService {
  private sqlHelpers: RoutePatternSqlHelpers;
  private constituentAnalysisService: ConstituentTrailAnalysisService;
  private configLoader: RouteDiscoveryConfigLoader;

  constructor(
    private pgClient: Pool,
    private config: DijkstraRouteGeneratorConfig
  ) {
    this.sqlHelpers = new RoutePatternSqlHelpers(pgClient);
    this.constituentAnalysisService = new ConstituentTrailAnalysisService(pgClient);
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
  }

  async generateRoutes(): Promise<RouteRecommendation[]> {
    const patterns = await this.sqlHelpers.loadOutAndBackPatterns();
    const all: RouteRecommendation[] = [];
    for (const pattern of patterns) {
      const routes = await this.generateForPattern(pattern);
      all.push(...routes);
    }
    return all;
  }

  private async generateForPattern(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    const cfg = this.configLoader.loadConfig();
    const trailheads = cfg.trailheads;
    const nodes = await this.sqlHelpers.getNetworkEntryPoints(
      this.config.stagingSchema,
      trailheads.enabled,
      trailheads.maxTrailheads,
      trailheads.locations
    );
    if (nodes.length < 2) return [];

    const routes: RouteRecommendation[] = [];
    const tolerances = RouteGenerationBusinessLogic.getToleranceLevels(pattern);
    for (const tol of tolerances) {
      for (const start of nodes) {
        const maxDist = Math.max(pattern.target_distance_km / 2 * 2, pattern.target_distance_km * 1.5);
        const reachable = await this.sqlHelpers.findReachableNodes(this.config.stagingSchema, start.id, maxDist);
        for (const r of reachable) {
          const endNode = r.node_id;
          const rows = await this.sqlHelpers.executeBidirectionalDijkstra(this.config.stagingSchema, start.id, endNode);
          let seq = 1;
          const path = rows.filter(x => typeof x.edge === 'number' && x.edge !== -1).map(x => ({ path_id: 1, path_seq: seq++, edge: x.edge }));
          const groups = new Map<number, any[]>();
          groups.set(1, path);
          for (const [pid, steps] of groups) {
            const rec = await this.processRoute(pattern, tol, pid, steps, start.lon, start.lat);
            if (rec) routes.push(rec);
          }
        }
      }
    }
    return routes;
  }

  private async processRoute(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    pathId: number,
    routeSteps: any[],
    startLon: number,
    startLat: number
  ): Promise<RouteRecommendation | null> {
    const edgeIds = RouteGenerationBusinessLogic.extractEdgeIds(routeSteps);
    if (edgeIds.length === 0) return null;
    const edges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
    if (edges.length === 0) return null;

    const { totalDistance, totalElevationGain } = RouteGenerationBusinessLogic.calculateRouteMetrics(edges);
    const reversed = edges.map(e => ({ ...e, source: e.target, target: e.source }));
    const outBackEdges = [...edges, ...reversed];
    const { outAndBackDistance, outAndBackElevation } = RouteGenerationBusinessLogic.calculateOutAndBackMetrics(totalDistance, totalElevationGain);
    const { distanceOk, elevationOk } = RouteGenerationBusinessLogic.meetsToleranceCriteria(outAndBackDistance, outAndBackElevation, pattern, tolerance);
    if (!distanceOk || !elevationOk) return null;
    await this.constituentAnalysisService.analyzeRouteConstituentTrails(this.config.stagingSchema, edges);
    const score = RouteGenerationBusinessLogic.calculateRouteScore(outAndBackDistance, outAndBackElevation, pattern, tolerance, edges);
    return RouteGenerationBusinessLogic.createRouteRecommendation(pattern, pathId, routeSteps, outBackEdges, outAndBackDistance, outAndBackElevation, score, this.config.region);
  }
}


