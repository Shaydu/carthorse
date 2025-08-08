import { Pool } from 'pg';
import crypto from 'crypto';

export interface CachedKspPaths {
  paths: number[][]; // Array of paths, each is an ordered list of edge IDs
}

export interface CachedReachableNodes {
  results: Array<{ node_id: number; distance_km: number }>; // Ordered by distance desc or as queried
}

export class RouteCacheService {
  private readonly cacheSchema: string;
  private readonly pg: Pool;

  constructor(pgClient: Pool, cacheSchema: string) {
    this.pg = pgClient;
    this.cacheSchema = cacheSchema;
  }

  async ensureSchemaAndTables(): Promise<void> {
    // Create schema and tables with indexes if not exist
    await this.pg.query(`CREATE SCHEMA IF NOT EXISTS ${this.cacheSchema}`);

    await this.pg.query(`
      CREATE TABLE IF NOT EXISTS ${this.cacheSchema}.ksp_paths_cache (
        graph_sig TEXT NOT NULL,
        start_node INTEGER NOT NULL,
        end_node INTEGER NOT NULL,
        k INTEGER NOT NULL,
        constraints_sig TEXT NOT NULL,
        paths JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY(graph_sig, start_node, end_node, k, constraints_sig)
      )
    `);
    await this.pg.query(`CREATE INDEX IF NOT EXISTS idx_${this.cacheSchema}_ksp_paths_start ON ${this.cacheSchema}.ksp_paths_cache(start_node)`);
    await this.pg.query(`CREATE INDEX IF NOT EXISTS idx_${this.cacheSchema}_ksp_paths_end ON ${this.cacheSchema}.ksp_paths_cache(end_node)`);
    await this.pg.query(`CREATE INDEX IF NOT EXISTS idx_${this.cacheSchema}_ksp_paths_graph ON ${this.cacheSchema}.ksp_paths_cache(graph_sig)`);

    await this.pg.query(`
      CREATE TABLE IF NOT EXISTS ${this.cacheSchema}.reachable_nodes_cache (
        graph_sig TEXT NOT NULL,
        start_node INTEGER NOT NULL,
        max_distance_km REAL NOT NULL,
        results JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY(graph_sig, start_node, max_distance_km)
      )
    `);
    await this.pg.query(`CREATE INDEX IF NOT EXISTS idx_${this.cacheSchema}_reachable_start ON ${this.cacheSchema}.reachable_nodes_cache(start_node)`);
    await this.pg.query(`CREATE INDEX IF NOT EXISTS idx_${this.cacheSchema}_reachable_graph ON ${this.cacheSchema}.reachable_nodes_cache(graph_sig)`);

    // Cache of fully processed routes (algorithm-agnostic)
    await this.pg.query(`
      CREATE TABLE IF NOT EXISTS ${this.cacheSchema}.routes_cache (
        graph_sig TEXT NOT NULL,
        start_node INTEGER NOT NULL,
        end_node INTEGER NOT NULL,
        constraints_sig TEXT NOT NULL,
        route_hash TEXT NOT NULL,
        discovered_at TIMESTAMP DEFAULT NOW(),
        meta JSONB,
        PRIMARY KEY(graph_sig, start_node, end_node, constraints_sig, route_hash)
      )
    `);
    await this.pg.query(`CREATE INDEX IF NOT EXISTS idx_${this.cacheSchema}_routes_start ON ${this.cacheSchema}.routes_cache(start_node)`);
    await this.pg.query(`CREATE INDEX IF NOT EXISTS idx_${this.cacheSchema}_routes_end ON ${this.cacheSchema}.routes_cache(end_node)`);
    await this.pg.query(`CREATE INDEX IF NOT EXISTS idx_${this.cacheSchema}_routes_graph ON ${this.cacheSchema}.routes_cache(graph_sig)`);
  }

  async computeGraphSignature(stagingSchema: string, region: string, bbox?: [number, number, number, number]): Promise<string> {
    // Use edge count, vertex count, sum(length_km) as a compact signature of the routing graph
    const stats = await this.pg.query(`
      WITH e AS (
        SELECT COUNT(*)::bigint AS edges, COALESCE(SUM(length_km), 0)::double precision AS total_len
        FROM ${stagingSchema}.ways_noded
      ), v AS (
        SELECT COUNT(*)::bigint AS vertices
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      )
      SELECT e.edges, v.vertices, e.total_len
      FROM e, v
    `);
    const row = stats.rows[0] || { edges: 0, vertices: 0, total_len: 0 };
    const bboxPart = bbox ? bbox.join(',') : 'nobbox';
    const raw = `${region}|${bboxPart}|${row.edges}|${row.vertices}|${row.total_len}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  async getKspPaths(graphSig: string, startNode: number, endNode: number, k: number, constraintsSig: string): Promise<CachedKspPaths | null> {
    const res = await this.pg.query(
      `SELECT paths FROM ${this.cacheSchema}.ksp_paths_cache WHERE graph_sig = $1 AND start_node = $2 AND end_node = $3 AND k = $4 AND constraints_sig = $5`,
      [graphSig, startNode, endNode, k, constraintsSig]
    );
    if (res.rows.length === 0) return null;
    return { paths: res.rows[0].paths as number[][] };
  }

  async setKspPaths(graphSig: string, startNode: number, endNode: number, k: number, constraintsSig: string, paths: number[][]): Promise<void> {
    await this.pg.query(
      `INSERT INTO ${this.cacheSchema}.ksp_paths_cache (graph_sig, start_node, end_node, k, constraints_sig, paths)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (graph_sig, start_node, end_node, k, constraints_sig)
       DO UPDATE SET paths = EXCLUDED.paths, created_at = NOW()`,
      [graphSig, startNode, endNode, k, constraintsSig, JSON.stringify(paths)]
    );
  }

  async getReachableNodes(graphSig: string, startNode: number, maxDistanceKm: number): Promise<CachedReachableNodes | null> {
    const res = await this.pg.query(
      `SELECT results FROM ${this.cacheSchema}.reachable_nodes_cache WHERE graph_sig = $1 AND start_node = $2 AND max_distance_km = $3`,
      [graphSig, startNode, maxDistanceKm]
    );
    if (res.rows.length === 0) return null;
    return { results: res.rows[0].results as Array<{ node_id: number; distance_km: number }> };
  }

  async setReachableNodes(graphSig: string, startNode: number, maxDistanceKm: number, results: Array<{ node_id: number; distance_km: number }>): Promise<void> {
    await this.pg.query(
      `INSERT INTO ${this.cacheSchema}.reachable_nodes_cache (graph_sig, start_node, max_distance_km, results)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (graph_sig, start_node, max_distance_km)
       DO UPDATE SET results = EXCLUDED.results, created_at = NOW()`,
      [graphSig, startNode, maxDistanceKm, JSON.stringify(results)]
    );
  }

  async routeExists(
    graphSig: string,
    startNode: number,
    endNode: number,
    constraintsSig: string,
    routeHash: string
  ): Promise<boolean> {
    const res = await this.pg.query(
      `SELECT 1 FROM ${this.cacheSchema}.routes_cache 
       WHERE graph_sig = $1 AND start_node = $2 AND end_node = $3 AND constraints_sig = $4 AND route_hash = $5 
       LIMIT 1`,
      [graphSig, startNode, endNode, constraintsSig, routeHash]
    );
    return res.rows.length > 0;
  }

  async setRoute(
    graphSig: string,
    startNode: number,
    endNode: number,
    constraintsSig: string,
    routeHash: string,
    meta?: any
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO ${this.cacheSchema}.routes_cache (graph_sig, start_node, end_node, constraints_sig, route_hash, meta)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (graph_sig, start_node, end_node, constraints_sig, route_hash)
       DO NOTHING`,
      [graphSig, startNode, endNode, constraintsSig, routeHash, meta ? JSON.stringify(meta) : null]
    );
  }
}


