import { Pool } from 'pg';

export interface NetworkMetrics {
  edges: number;
  vertices: number;
  isolates: number;
  endpoints: number;
  intersections: number;
  avgDegree: number | null;
  componentsCount: number | null;
  giantComponentSize: number | null;
  bridges: number | null;
  articulationPoints: number | null;
  cyclomaticNumber: number | null;
  avgReachableKm25: number | null;
}

export async function computeNetworkMetrics(pg: Pool, schema: string): Promise<NetworkMetrics> {
  // Base degree/structure metrics
  const base = await pg.query(`
    WITH deg AS (
      SELECT v.id,
             COALESCE(src.cnt,0) + COALESCE(tgt.cnt,0) AS degree
      FROM ${schema}.ways_noded_vertices_pgr v
      LEFT JOIN (
        SELECT source AS id, COUNT(*) AS cnt FROM ${schema}.ways_noded GROUP BY source
      ) src ON src.id = v.id
      LEFT JOIN (
        SELECT target AS id, COUNT(*) AS cnt FROM ${schema}.ways_noded GROUP BY target
      ) tgt ON tgt.id = v.id
    )
    SELECT 
      (SELECT COUNT(*) FROM ${schema}.ways_noded) AS edges,
      (SELECT COUNT(*) FROM ${schema}.ways_noded_vertices_pgr) AS vertices,
      COUNT(*) FILTER (WHERE degree = 0) AS isolates,
      COUNT(*) FILTER (WHERE degree = 1) AS endpoints,
      COUNT(*) FILTER (WHERE degree >= 3) AS intersections,
      AVG(degree::float) AS avg_degree
    FROM deg
  `);

  const b = base.rows[0];
  const edges = Number(b.edges || 0);
  const vertices = Number(b.vertices || 0);
  const isolates = Number(b.isolates || 0);
  const endpoints = Number(b.endpoints || 0);
  const intersections = Number(b.intersections || 0);
  const avgDegree = b.avg_degree !== null ? Number(b.avg_degree) : null;

  // Connected components
  let componentsCount: number | null = null;
  let giantComponentSize: number | null = null;
  try {
    const comps = await pg.query(`
      WITH cc AS (
        SELECT * FROM pgr_connectedComponents(
          'SELECT id, source, target, length_km AS cost FROM ${schema}.ways_noded'
        )
      )
      SELECT 
        COUNT(DISTINCT component) AS components_count,
        MAX(cnt) AS giant_component_size
      FROM (
        SELECT component, COUNT(*) AS cnt FROM cc GROUP BY component
      ) s
    `);
    componentsCount = Number(comps.rows[0]?.components_count ?? 0);
    giantComponentSize = Number(comps.rows[0]?.giant_component_size ?? 0);
  } catch {
    componentsCount = null;
    giantComponentSize = null;
  }

  // Bridges and articulation points
  let bridges: number | null = null;
  let articulationPoints: number | null = null;
  try {
    const br = await pg.query(`
      SELECT COUNT(*) AS c FROM pgr_bridges(
        'SELECT id, source, target, length_km AS cost FROM ${schema}.ways_noded'
      )
    `);
    bridges = Number(br.rows[0]?.c ?? 0);
  } catch {
    bridges = null;
  }
  try {
    const ap = await pg.query(`
      SELECT COUNT(*) AS c FROM pgr_articulationPoints(
        'SELECT id, source, target, length_km AS cost FROM ${schema}.ways_noded'
      )
    `);
    articulationPoints = Number(ap.rows[0]?.c ?? 0);
  } catch {
    articulationPoints = null;
  }

  // Cyclomatic number
  const cyclomaticNumber = componentsCount !== null ? (edges - vertices + componentsCount) : null;

  // Reachability within 25 km (sample up to 100 start nodes for performance)
  let avgReachableKm25: number | null = null;
  try {
    const reach = await pg.query(`
      WITH samples AS (
        SELECT id AS start_vid
        FROM ${schema}.ways_noded_vertices_pgr
        ORDER BY random()
        LIMIT 100
      ),
      dd AS (
        SELECT * FROM pgr_drivingDistance(
          'SELECT id, source, target, length_km AS cost FROM ${schema}.ways_noded',
          ARRAY(SELECT start_vid FROM samples),
          25.0,
          directed := false
        )
      ),
      agg AS (
        SELECT dd.start_vid, SUM(e.length_km) AS reachable_km
        FROM dd
        JOIN ${schema}.ways_noded e ON dd.edge = e.id
        GROUP BY dd.start_vid
      )
      SELECT AVG(reachable_km) AS avg_reach FROM agg
    `);
    avgReachableKm25 = reach.rows[0]?.avg_reach !== null ? Number(reach.rows[0].avg_reach) : null;
  } catch {
    avgReachableKm25 = null;
  }

  return {
    edges,
    vertices,
    isolates,
    endpoints,
    intersections,
    avgDegree,
    componentsCount,
    giantComponentSize,
    bridges,
    articulationPoints,
    cyclomaticNumber,
    avgReachableKm25,
  };
}


