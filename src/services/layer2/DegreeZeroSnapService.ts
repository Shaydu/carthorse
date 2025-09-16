import { Pool } from 'pg';

export interface DegreeZeroSnapConfig {
  stagingSchema: string;
  endpointToleranceMeters: number; // T1
  edgeToleranceMeters: number;     // T2
  dryRun?: boolean;                // when true, only report
  verbose?: boolean;
}

export interface DegreeZeroReport {
  totalNodes: number;
  degreeZero: number;
  nearEndpoint: number;
  nearEdge: number;
  onBboxBoundary: number;
  fixedByEndpointSnap?: number;
  fixedByEdgeProjection?: number;
  removedAsSpurious?: number;
}

export class DegreeZeroSnapService {
  constructor(private pgClient: Pool, private config: DegreeZeroSnapConfig) {}

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[DegreeZero] ${message}`);
    }
  }

  async analyze(): Promise<DegreeZeroReport> {
    const { stagingSchema, endpointToleranceMeters, edgeToleranceMeters } = this.config;

    // Count total nodes and degree
    const base = await this.pgClient.query(`
      WITH deg AS (
        SELECT n.id,
               COALESCE(in_degree, 0) + COALESCE(out_degree, 0) AS degree
        FROM ${stagingSchema}.routing_nodes n
        LEFT JOIN (
          SELECT source AS node_id, COUNT(*) AS out_degree
          FROM ${stagingSchema}.routing_edges GROUP BY source
        ) o ON o.node_id = n.id
        LEFT JOIN (
          SELECT target AS node_id, COUNT(*) AS in_degree
          FROM ${stagingSchema}.routing_edges GROUP BY target
        ) i ON i.node_id = n.id
      )
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.routing_nodes)::int AS total_nodes,
        (SELECT COUNT(*) FROM deg WHERE degree = 0)::int AS degree_zero
    `);

    const totalNodes = base.rows[0].total_nodes as number;
    const degreeZero = base.rows[0].degree_zero as number;

    // Degree-0 near any endpoint within tolerance
    const nearEp = await this.pgClient.query(`
      WITH dz AS (
        SELECT n.id, n.geometry
        FROM ${stagingSchema}.routing_nodes n
        LEFT JOIN (
          SELECT source AS node_id FROM ${stagingSchema}.routing_edges
          UNION ALL
          SELECT target AS node_id FROM ${stagingSchema}.routing_edges
        ) e ON e.node_id = n.id
        WHERE e.node_id IS NULL
      ),
      endpoints AS (
        SELECT source AS node_id FROM ${stagingSchema}.routing_edges
        UNION
        SELECT target AS node_id FROM ${stagingSchema}.routing_edges
      )
      SELECT COUNT(*)::int AS cnt
      FROM dz
      WHERE EXISTS (
        SELECT 1 FROM ${stagingSchema}.routing_nodes ep
        JOIN endpoints en ON en.node_id = ep.id
        WHERE ST_DWithin(dz.geometry::geography, ep.geometry::geography, $1)
      )
    `, [endpointToleranceMeters]);

    // Degree-0 near any edge within tolerance
    const nearEdge = await this.pgClient.query(`
      WITH dz AS (
        SELECT n.id, n.geometry
        FROM ${stagingSchema}.routing_nodes n
        LEFT JOIN (
          SELECT source AS node_id FROM ${stagingSchema}.routing_edges
          UNION ALL
          SELECT target AS node_id FROM ${stagingSchema}.routing_edges
        ) e ON e.node_id = n.id
        WHERE e.node_id IS NULL
      )
      SELECT COUNT(*)::int AS cnt
      FROM dz
      WHERE EXISTS (
        SELECT 1 FROM ${stagingSchema}.routing_edges ed
        WHERE ST_DWithin(dz.geometry::geography, ed.geometry::geography, $1)
      )
    `, [edgeToleranceMeters]);

    // Degree-0 on bbox boundary (heuristic using trails bbox)
    const onBoundary = await this.pgClient.query(`
      WITH bounds AS (
        SELECT 
          MIN(bbox_min_lng) AS min_lng,
          MAX(bbox_max_lng) AS max_lng,
          MIN(bbox_min_lat) AS min_lat,
          MAX(bbox_max_lat) AS max_lat
        FROM ${stagingSchema}.trails
      ), dz AS (
        SELECT n.id, n.geometry
        FROM ${stagingSchema}.routing_nodes n
        LEFT JOIN (
          SELECT source AS node_id FROM ${stagingSchema}.routing_edges
          UNION ALL
          SELECT target AS node_id FROM ${stagingSchema}.routing_edges
        ) e ON e.node_id = n.id
        WHERE e.node_id IS NULL
      )
      SELECT COUNT(*)::int AS cnt
      FROM dz, bounds
      WHERE 
        abs(ST_X(dz.geometry) - bounds.min_lng) < 1e-9 OR
        abs(ST_X(dz.geometry) - bounds.max_lng) < 1e-9 OR
        abs(ST_Y(dz.geometry) - bounds.min_lat) < 1e-9 OR
        abs(ST_Y(dz.geometry) - bounds.max_lat) < 1e-9
    `);

    return {
      totalNodes,
      degreeZero,
      nearEndpoint: nearEp.rows[0].cnt as number,
      nearEdge: nearEdge.rows[0].cnt as number,
      onBboxBoundary: onBoundary.rows[0].cnt as number
    };
  }

  async fix(): Promise<DegreeZeroReport> {
    const report = await this.analyze();
    if (this.config.dryRun) return report;

    const { stagingSchema, endpointToleranceMeters, edgeToleranceMeters } = this.config;

    // 1) Snap to nearest endpoint within T1
    const snapEp = await this.pgClient.query(`
      WITH dz AS (
        SELECT n.id, n.geometry
        FROM ${stagingSchema}.routing_nodes n
        LEFT JOIN (
          SELECT source AS node_id FROM ${stagingSchema}.routing_edges
          UNION ALL
          SELECT target AS node_id FROM ${stagingSchema}.routing_edges
        ) e ON e.node_id = n.id
        WHERE e.node_id IS NULL
      ), ep AS (
        SELECT DISTINCT ON (id) id, geometry
        FROM ${stagingSchema}.routing_nodes
        WHERE id IN (
          SELECT source FROM ${stagingSchema}.routing_edges
          UNION
          SELECT target FROM ${stagingSchema}.routing_edges
        )
      ), pairs AS (
        SELECT dz.id AS node_id, ep.id AS target_id,
               ST_Snap(dz.geometry, ep.geometry, 1e-9) AS snapped
        FROM dz
        JOIN ep ON ST_DWithin(dz.geometry::geography, ep.geometry::geography, $1)
      )
      UPDATE ${stagingSchema}.routing_nodes n
      SET geometry = p.snapped
      FROM pairs p
      WHERE n.id = p.node_id
      RETURNING n.id
    `, [endpointToleranceMeters]);

    // 2) Project onto nearest edge within T2 and split edge to insert connection (report only; full edge split is complex)
    // For now: move node onto edge line if close; edge splitting connection will be handled by existing splitting services.
    const snapEdge = await this.pgClient.query(`
      WITH dz AS (
        SELECT n.id, n.geometry
        FROM ${stagingSchema}.routing_nodes n
        LEFT JOIN (
          SELECT source AS node_id FROM ${stagingSchema}.routing_edges
          UNION ALL
          SELECT target AS node_id FROM ${stagingSchema}.routing_edges
        ) e ON e.node_id = n.id
        WHERE e.node_id IS NULL
      ), cand AS (
        SELECT dz.id AS node_id,
               (SELECT geometry FROM ${stagingSchema}.routing_edges ed
                ORDER BY dz.geometry <-> ed.geometry LIMIT 1) AS edge_geom
        FROM dz
      ), proj AS (
        SELECT node_id, ST_LineInterpolatePoint(edge_geom, ST_LineLocatePoint(edge_geom, (SELECT geometry FROM ${stagingSchema}.routing_nodes WHERE id = node_id))) AS snapped
        FROM cand
      )
      UPDATE ${stagingSchema}.routing_nodes n
      SET geometry = p.snapped
      FROM proj p
      WHERE n.id = p.node_id
        AND ST_DWithin(n.geometry::geography, p.snapped::geography, $1)
      RETURNING n.id
    `, [edgeToleranceMeters]);

    // Recompute report after fixes
    const after = await this.analyze();
    after.fixedByEndpointSnap = snapEp.rowCount || 0;
    after.fixedByEdgeProjection = snapEdge.rowCount || 0;

    return after;
  }
}


