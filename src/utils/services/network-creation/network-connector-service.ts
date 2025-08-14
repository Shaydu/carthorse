import { Pool, PoolClient } from 'pg';

export interface NetworkConnectorResult {
  connectorsCreated: number;
  gapsBridged: number;
  details: {
    longestConnector: number;
    averageConnectorLength: number;
    isolatedVerticesRemaining: number;
  };
}

/**
 * Network-level connector service that works with the actual network topology
 * to bridge gaps between degree-1 vertices (isolated endpoints)
 */
export class NetworkConnectorService {
  private stagingSchema: string;
  private pgClient: Pool | PoolClient;

  constructor(stagingSchema: string, pgClient: Pool | PoolClient) {
    this.stagingSchema = stagingSchema;
    this.pgClient = pgClient;
  }

  /**
   * Connect degree-1 vertices within the specified tolerance to bridge actual gaps
   */
  async connectIsolatedVertices(maxDistanceMeters: number = 50): Promise<NetworkConnectorResult> {
    console.log(`🔗 Connecting degree-1 vertices within ${maxDistanceMeters}m tolerance...`);

    // Find degree-1 vertices (endpoints that need connections)
    const degree1Vertices = await this.pgClient.query(`
      WITH vertex_degrees AS (
        SELECT 
          v.id,
          v.the_geom,
          COUNT(w.id) as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
        GROUP BY v.id, v.the_geom
      )
      SELECT id, the_geom, degree
      FROM vertex_degrees
      WHERE degree = 1
      ORDER BY id
    `);

    if (isolatedVertices.rows.length === 0) {
      console.log('✅ No isolated vertices found - network is already fully connected');
      return {
        connectorsCreated: 0,
        gapsBridged: 0,
        details: {
          longestConnector: 0,
          averageConnectorLength: 0,
          isolatedVerticesRemaining: 0
        }
      };
    }

    console.log(`📊 Found ${isolatedVertices.rows.length} isolated vertices`);

    // Find pairs of isolated vertices that are close enough to connect
    const connectorPairs = await this.pgClient.query(`
      WITH isolated_vertices AS (
        SELECT 
          v.id,
          v.the_geom,
          COUNT(w.id) as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
        GROUP BY v.id, v.the_geom
        HAVING COUNT(w.id) = 1
      ),
      candidate_pairs AS (
        SELECT 
          v1.id as vertex1_id,
          v2.id as vertex2_id,
          v1.the_geom as geom1,
          v2.the_geom as geom2,
          ST_Distance(v1.the_geom::geography, v2.the_geom::geography) as distance_meters
        FROM isolated_vertices v1
        JOIN isolated_vertices v2 ON v1.id < v2.id
        WHERE ST_DWithin(v1.the_geom::geography, v2.the_geom::geography, $1)
          AND ST_Distance(v1.the_geom::geography, v2.the_geom::geography) > 1.0  -- Minimum 1m gap
      ),
      -- Avoid creating connectors that would create artificial intersections
      filtered_pairs AS (
        SELECT *
        FROM candidate_pairs cp
        WHERE NOT EXISTS (
          -- Check if there's already a trail/edge that connects these vertices
          SELECT 1
          FROM ${this.stagingSchema}.ways_noded w
          WHERE (w.source = cp.vertex1_id AND w.target = cp.vertex2_id)
             OR (w.source = cp.vertex2_id AND w.target = cp.vertex1_id)
        )
      )
      SELECT 
        vertex1_id,
        vertex2_id,
        geom1,
        geom2,
        distance_meters
      FROM filtered_pairs
      ORDER BY distance_meters
      LIMIT 100  -- Limit to prevent too many connectors
    `, [maxDistanceMeters]);

    if (connectorPairs.rows.length === 0) {
      console.log('✅ No suitable connector pairs found');
      return {
        connectorsCreated: 0,
        gapsBridged: 0,
        details: {
          longestConnector: 0,
          averageConnectorLength: 0,
          isolatedVerticesRemaining: isolatedVertices.rows.length
        }
      };
    }

    console.log(`🔗 Found ${connectorPairs.rows.length} candidate connector pairs`);

    // Create connector edges
    let connectorsCreated = 0;
    const connectorLengths: number[] = [];

    for (const pair of connectorPairs.rows) {
      try {
        // Create a connector edge between the two vertices
        const insertResult = await this.pgClient.query(`
          INSERT INTO ${this.stagingSchema}.ways_noded (
            source, target, the_geom, length_km, app_uuid, name,
            elevation_gain, elevation_loss, old_id, sub_id
          ) VALUES (
            $1, $2, 
            ST_SetSRID(ST_MakeLine($3, $4), 4326),
            ST_Distance($3::geography, $4::geography) / 1000.0,
            'connector-' || gen_random_uuid()::text,
            'Network Connector',
            0, 0, -1, 1
          )
          ON CONFLICT DO NOTHING
        `, [pair.vertex1_id, pair.vertex2_id, pair.geom1, pair.geom2]);

        if (insertResult.rowCount && insertResult.rowCount > 0) {
          connectorsCreated++;
          connectorLengths.push(pair.distance_meters);
          console.log(`   🔗 Connected vertices ${pair.vertex1_id} ↔ ${pair.vertex2_id} (${pair.distance_meters.toFixed(1)}m)`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to create connector between vertices ${pair.vertex1_id} and ${pair.vertex2_id}:`, error);
      }
    }

    // Calculate statistics
    const longestConnector = connectorLengths.length > 0 ? Math.max(...connectorLengths) : 0;
    const averageConnectorLength = connectorLengths.length > 0 ? 
      connectorLengths.reduce((sum, len) => sum + len, 0) / connectorLengths.length : 0;

    // Check remaining isolated vertices
    const remainingIsolated = await this.pgClient.query(`
      WITH vertex_degrees AS (
        SELECT 
          v.id,
          COUNT(w.id) as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
        GROUP BY v.id
      )
      SELECT COUNT(*) as count
      FROM vertex_degrees
      WHERE degree = 1
    `);

    const isolatedVerticesRemaining = parseInt(remainingIsolated.rows[0].count);

    console.log(`✅ Network connector service completed:`);
    console.log(`   🔗 Connectors created: ${connectorsCreated}`);
    console.log(`   📏 Longest connector: ${longestConnector.toFixed(1)}m`);
    console.log(`   📏 Average connector: ${averageConnectorLength.toFixed(1)}m`);
    console.log(`   🏝️ Remaining isolated vertices: ${isolatedVerticesRemaining}`);

    return {
      connectorsCreated,
      gapsBridged: connectorsCreated,
      details: {
        longestConnector,
        averageConnectorLength,
        isolatedVerticesRemaining
      }
    };
  }

  /**
   * Get network connectivity statistics
   */
  async getConnectivityStats(): Promise<{
    totalVertices: number;
    isolatedVertices: number;
    connectedComponents: number;
    connectivityPercentage: number;
  }> {
    const stats = await this.pgClient.query(`
      WITH vertex_degrees AS (
        SELECT 
          v.id,
          COUNT(w.id) as degree
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.stagingSchema}.ways_noded w ON v.id = w.source OR v.id = w.target
        GROUP BY v.id
      ),
      reachable_nodes AS (
        SELECT DISTINCT target as node_id
        FROM ${this.stagingSchema}.ways_noded
        WHERE source = (SELECT MIN(id) FROM ${this.stagingSchema}.ways_noded_vertices_pgr)
        UNION
        SELECT source as node_id
        FROM ${this.stagingSchema}.ways_noded
        WHERE target = (SELECT MIN(id) FROM ${this.stagingSchema}.ways_noded_vertices_pgr)
      ),
      all_nodes AS (
        SELECT id as node_id FROM ${this.stagingSchema}.ways_noded_vertices_pgr
      )
      SELECT 
        (SELECT COUNT(*) FROM all_nodes) as total_vertices,
        (SELECT COUNT(*) FROM vertex_degrees WHERE degree = 1) as isolated_vertices,
        (SELECT COUNT(DISTINCT r.node_id) FROM reachable_nodes r CROSS JOIN all_nodes a) as reachable_nodes,
        (SELECT COUNT(*) FROM all_nodes) as total_nodes
    `);

    const row = stats.rows[0];
    const totalVertices = parseInt(row.total_vertices);
    const isolatedVertices = parseInt(row.isolated_vertices);
    const reachableNodes = parseInt(row.reachable_nodes);
    const totalNodes = parseInt(row.total_nodes);
    const connectivityPercentage = totalNodes > 0 ? (reachableNodes / totalNodes) * 100 : 0;

    return {
      totalVertices,
      isolatedVertices,
      connectedComponents: 1, // Simplified for now
      connectivityPercentage
    };
  }
}
