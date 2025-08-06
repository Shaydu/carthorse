import { Pool } from 'pg';

export interface ConnectivityAnalysis {
  missingConnections: MissingConnection[];
  disconnectedComponents: DisconnectedComponent[];
  connectivityScore: number;
  networkMetrics: NetworkMetrics;
  recommendations: string[];
}

export interface MissingConnection {
  trail1_id: string;
  trail1_name: string;
  trail1_endpoint: [number, number];
  trail2_id: string;
  trail2_name: string;
  trail2_endpoint: [number, number];
  distance_meters: number;
  connection_type: 'endpoint-to-endpoint' | 'endpoint-to-trail' | 'trail-to-trail';
  recommended_tolerance: number;
}

export interface DisconnectedComponent {
  component_id: number;
  trail_count: number;
  trails: string[];
  total_length_km: number;
  bounding_box: [number, number, number, number];
}

export interface NetworkMetrics {
  total_nodes: number;
  total_edges: number;
  isolated_nodes: number;
  articulation_points: number;
  bridges: number;
  average_degree: number;
  network_density: number;
  largest_component_size: number;
  component_count: number;
  average_path_length: number;
  network_diameter: number;
}

export interface NetworkConnectivityAnalyzerConfig {
  stagingSchema: string;
  intersectionTolerance: number; // meters
  endpointTolerance: number; // meters
  maxConnectionDistance: number; // meters
  minTrailLength: number; // meters
}

export class NetworkConnectivityAnalyzer {
  constructor(
    private pgClient: Pool,
    private config: NetworkConnectivityAnalyzerConfig
  ) {}

  /**
   * Analyze network connectivity and identify missing connections
   */
  async analyzeConnectivity(): Promise<ConnectivityAnalysis> {
    console.log('🔍 Analyzing network connectivity...');
    
    const missingConnections = await this.findMissingConnections();
    const disconnectedComponents = await this.findDisconnectedComponents();
    const connectivityScore = await this.calculateConnectivityScore();
    const networkMetrics = await this.calculateNetworkMetrics();
    const recommendations = this.generateRecommendations(missingConnections, disconnectedComponents, networkMetrics);
    
    console.log(`✅ Connectivity analysis complete:`);
    console.log(`   🔗 Missing connections: ${missingConnections.length}`);
    console.log(`   🧩 Disconnected components: ${disconnectedComponents.length}`);
    console.log(`   📊 Connectivity score: ${connectivityScore.toFixed(2)}%`);
    console.log(`   📈 Network metrics calculated`);
    
    return {
      missingConnections,
      disconnectedComponents,
      connectivityScore,
      networkMetrics,
      recommendations
    };
  }

  /**
   * Find missing connections between trails within tolerance using PostGIS spatial functions
   */
  private async findMissingConnections(): Promise<MissingConnection[]> {
    console.log('🔍 Finding missing trail connections...');
    
    const result = await this.pgClient.query(`
      WITH trail_endpoints AS (
        -- Get all trail endpoints with their coordinates using PostGIS
        SELECT 
          t.app_uuid as trail_id,
          t.name as trail_name,
          ST_StartPoint(t.geometry) as start_point,
          ST_EndPoint(t.geometry) as end_point,
          ST_X(ST_StartPoint(t.geometry)) as start_lon,
          ST_Y(ST_StartPoint(t.geometry)) as start_lat,
          ST_X(ST_EndPoint(t.geometry)) as end_lon,
          ST_Y(ST_EndPoint(t.geometry)) as end_lat,
          ST_Length(t.geometry) as trail_length
        FROM ${this.config.stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL
          AND ST_Length(t.geometry) >= $1
      ),
      potential_connections AS (
        -- Find all potential connections using PostGIS spatial functions
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.start_lon as trail1_lon,
          t1.start_lat as trail1_lat,
          t1.start_point as trail1_point,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.start_lon as trail2_lon,
          t2.start_lat as trail2_lat,
          t2.start_point as trail2_point,
          ST_Distance(t1.start_point, t2.start_point) as distance_meters,
          'endpoint-to-endpoint' as connection_type
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id -- Avoid duplicates
          AND ST_DWithin(t1.start_point, t2.start_point, $2) -- Use PostGIS spatial index
          AND ST_Distance(t1.start_point, t2.start_point) > 0
          
        UNION ALL
        
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.end_lon as trail1_lon,
          t1.end_lat as trail1_lat,
          t1.end_point as trail1_point,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.start_lon as trail2_lon,
          t2.start_lat as trail2_lat,
          t2.start_point as trail2_point,
          ST_Distance(t1.end_point, t2.start_point) as distance_meters,
          'endpoint-to-endpoint' as connection_type
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id != t2.trail_id
          AND ST_DWithin(t1.end_point, t2.start_point, $2) -- Use PostGIS spatial index
          AND ST_Distance(t1.end_point, t2.start_point) > 0
          
        UNION ALL
        
        SELECT 
          t1.trail_id as trail1_id,
          t1.trail_name as trail1_name,
          t1.end_lon as trail1_lon,
          t1.end_lat as trail1_lat,
          t1.end_point as trail1_point,
          t2.trail_id as trail2_id,
          t2.trail_name as trail2_name,
          t2.end_lon as trail2_lon,
          t2.end_lat as trail2_lat,
          t2.end_point as trail2_point,
          ST_Distance(t1.end_point, t2.end_point) as distance_meters,
          'endpoint-to-endpoint' as connection_type
        FROM trail_endpoints t1
        CROSS JOIN trail_endpoints t2
        WHERE t1.trail_id < t2.trail_id
          AND ST_DWithin(t1.end_point, t2.end_point, $2) -- Use PostGIS spatial index
          AND ST_Distance(t1.end_point, t2.end_point) > 0
      ),
      existing_connections AS (
        -- Get existing connections from routing edges using pgRouting
        SELECT DISTINCT
          em1.app_uuid as trail1_id,
          em2.app_uuid as trail2_id
        FROM ${this.config.stagingSchema}.routing_edges re1
        JOIN ${this.config.stagingSchema}.edge_mapping em1 ON re1.id = em1.pg_id
        JOIN ${this.config.stagingSchema}.routing_edges re2 ON re1.source = re2.source OR re1.target = re2.target
        JOIN ${this.config.stagingSchema}.edge_mapping em2 ON re2.id = em2.pg_id
        WHERE em1.app_uuid != em2.app_uuid
      )
      SELECT 
        pc.trail1_id,
        pc.trail1_name,
        ARRAY[pc.trail1_lon, pc.trail1_lat] as trail1_endpoint,
        pc.trail2_id,
        pc.trail2_name,
        ARRAY[pc.trail2_lon, pc.trail2_lat] as trail2_endpoint,
        pc.distance_meters,
        pc.connection_type,
        CASE 
          WHEN pc.distance_meters <= $3 THEN $3
          WHEN pc.distance_meters <= $4 THEN $4
          ELSE $5
        END as recommended_tolerance
      FROM potential_connections pc
      LEFT JOIN existing_connections ec ON 
        (pc.trail1_id = ec.trail1_id AND pc.trail2_id = ec.trail2_id) OR
        (pc.trail1_id = ec.trail2_id AND pc.trail2_id = ec.trail1_id)
      WHERE ec.trail1_id IS NULL -- Only missing connections
      ORDER BY pc.distance_meters ASC
      LIMIT 100
    `, [
      this.config.minTrailLength,
      this.config.maxConnectionDistance,
      this.config.intersectionTolerance,
      this.config.endpointTolerance,
      this.config.maxConnectionDistance
    ]);

    const missingConnections: MissingConnection[] = result.rows.map(row => ({
      trail1_id: row.trail1_id,
      trail1_name: row.trail1_name,
      trail1_endpoint: row.trail1_endpoint,
      trail2_id: row.trail2_id,
      trail2_name: row.trail2_name,
      trail2_endpoint: row.trail2_endpoint,
      distance_meters: row.distance_meters,
      connection_type: row.connection_type,
      recommended_tolerance: row.recommended_tolerance
    }));

    console.log(`✅ Found ${missingConnections.length} missing connections`);
    return missingConnections;
  }

  /**
   * Find disconnected components using pgRouting's strongly connected components
   */
  private async findDisconnectedComponents(): Promise<DisconnectedComponent[]> {
    console.log('🔍 Finding disconnected trail components...');
    
    const result = await this.pgClient.query(`
      WITH strongly_connected_components AS (
        -- Use pgRouting's strongly connected components analysis
        SELECT 
          component,
          COUNT(*) as node_count
        FROM pgr_strongComponents(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
        )
        GROUP BY component
        ORDER BY node_count DESC
      ),
      component_trails AS (
        -- Map components to trails
        SELECT 
          scc.component,
          scc.node_count,
          ARRAY_AGG(DISTINCT t.name) as trails,
          SUM(ST_Length(t.geometry)) as total_length_km,
          ARRAY[
            ST_XMin(ST_Collect(t.geometry)),
            ST_YMin(ST_Collect(t.geometry)),
            ST_XMax(ST_Collect(t.geometry)),
            ST_YMax(ST_Collect(t.geometry))
          ] as bounding_box
        FROM strongly_connected_components scc
        JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr v ON v.id IN (
          SELECT node FROM pgr_strongComponents(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
          ) WHERE component = scc.component
        )
        JOIN ${this.config.stagingSchema}.node_mapping nm ON v.id = nm.pg_id
        JOIN ${this.config.stagingSchema}.edge_mapping em ON nm.pg_id = em.pg_id
        JOIN ${this.config.stagingSchema}.trails t ON em.app_uuid = t.app_uuid
        GROUP BY scc.component, scc.node_count
      )
      SELECT 
        component,
        node_count as trail_count,
        trails,
        total_length_km,
        bounding_box
      FROM component_trails
      ORDER BY trail_count DESC
    `);

    const disconnectedComponents: DisconnectedComponent[] = result.rows.map(row => ({
      component_id: parseInt(row.component),
      trail_count: parseInt(row.trail_count),
      trails: row.trails,
      total_length_km: parseFloat(row.total_length_km),
      bounding_box: row.bounding_box
    }));

    console.log(`✅ Found ${disconnectedComponents.length} disconnected components`);
    return disconnectedComponents;
  }

  /**
   * Calculate comprehensive network metrics using pgRouting and PostGIS
   */
  private async calculateNetworkMetrics(): Promise<NetworkMetrics> {
    console.log('📊 Calculating network metrics...');
    
    const result = await this.pgClient.query(`
      WITH network_stats AS (
        -- Basic network statistics
        SELECT 
          COUNT(DISTINCT v.id) as total_nodes,
          COUNT(DISTINCT e.id) as total_edges,
          AVG(degree) as average_degree
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        CROSS JOIN ${this.config.stagingSchema}.ways_noded e
        CROSS JOIN LATERAL (
          SELECT COUNT(*) as degree
          FROM ${this.config.stagingSchema}.ways_noded
          WHERE source = v.id OR target = v.id
        ) deg
      ),
      isolated_nodes AS (
        -- Find isolated nodes (degree = 0)
        SELECT COUNT(*) as isolated_count
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
        WHERE NOT EXISTS (
          SELECT 1 FROM ${this.config.stagingSchema}.ways_noded e
          WHERE e.source = v.id OR e.target = v.id
        )
      ),
      articulation_points AS (
        -- Find articulation points using pgRouting
        SELECT COUNT(DISTINCT node) as articulation_count
        FROM pgr_articulationPoints(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
        )
      ),
      bridges AS (
        -- Find bridges using pgRouting
        SELECT COUNT(*) as bridge_count
        FROM pgr_bridges(
          'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
        )
      ),
      component_analysis AS (
        -- Analyze strongly connected components
        SELECT 
          COUNT(*) as component_count,
          MAX(node_count) as largest_component_size
        FROM (
          SELECT component, COUNT(*) as node_count
          FROM pgr_strongComponents(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded'
          )
          GROUP BY component
        ) comp
      ),
      path_analysis AS (
        -- Calculate average path length and network diameter
        SELECT 
          AVG(agg_cost) as avg_path_length,
          MAX(agg_cost) as network_diameter
        FROM (
          SELECT DISTINCT agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.config.stagingSchema}.ways_noded',
            (SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr LIMIT 1),
            (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr),
            false
          )
          WHERE agg_cost > 0 AND agg_cost < 1000 -- Filter out unreachable nodes
        ) paths
      )
      SELECT 
        ns.total_nodes,
        ns.total_edges,
        in.isolated_count as isolated_nodes,
        ap.articulation_count as articulation_points,
        b.bridge_count as bridges,
        ns.average_degree,
        CASE 
          WHEN ns.total_nodes > 1 THEN 
            (ns.total_edges::float / (ns.total_nodes * (ns.total_nodes - 1) / 2)) * 100
          ELSE 0 
        END as network_density,
        ca.largest_component_size,
        ca.component_count,
        COALESCE(pa.avg_path_length, 0) as average_path_length,
        COALESCE(pa.network_diameter, 0) as network_diameter
      FROM network_stats ns
      CROSS JOIN isolated_nodes in
      CROSS JOIN articulation_points ap
      CROSS JOIN bridges b
      CROSS JOIN component_analysis ca
      CROSS JOIN path_analysis pa
    `);

    const metrics = result.rows[0];
    const networkMetrics: NetworkMetrics = {
      total_nodes: parseInt(metrics.total_nodes),
      total_edges: parseInt(metrics.total_edges),
      isolated_nodes: parseInt(metrics.isolated_nodes),
      articulation_points: parseInt(metrics.articulation_points),
      bridges: parseInt(metrics.bridges),
      average_degree: parseFloat(metrics.average_degree),
      network_density: parseFloat(metrics.network_density),
      largest_component_size: parseInt(metrics.largest_component_size),
      component_count: parseInt(metrics.component_count),
      average_path_length: parseFloat(metrics.average_path_length),
      network_diameter: parseFloat(metrics.network_diameter)
    };

    console.log(`✅ Network metrics calculated`);
    return networkMetrics;
  }

  /**
   * Calculate overall network connectivity score
   */
  private async calculateConnectivityScore(): Promise<number> {
    const result = await this.pgClient.query(`
      WITH trail_connections AS (
        -- Get all trail connections through routing edges
        SELECT DISTINCT
          em1.app_uuid as trail1_id,
          em2.app_uuid as trail2_id
        FROM ${this.config.stagingSchema}.routing_edges re1
        JOIN ${this.config.stagingSchema}.edge_mapping em1 ON re1.id = em1.pg_id
        JOIN ${this.config.stagingSchema}.routing_edges re2 ON re1.source = re2.source OR re1.target = re2.target
        JOIN ${this.config.stagingSchema}.edge_mapping em2 ON re2.id = em2.pg_id
        WHERE em1.app_uuid != em2.app_uuid
      ),
      connected_trails AS (
        -- Get all trails that have connections
        SELECT DISTINCT trail1_id as trail_id FROM trail_connections
        UNION
        SELECT DISTINCT trail2_id as trail_id FROM trail_connections
      ),
      trail_stats AS (
        SELECT 
          COUNT(DISTINCT app_uuid) as total_trails,
          COUNT(DISTINCT CASE WHEN app_uuid IN (SELECT trail_id FROM connected_trails) THEN app_uuid END) as connected_trails
        FROM ${this.config.stagingSchema}.edge_mapping
      )
      SELECT 
        CASE 
          WHEN total_trails = 0 THEN 0
          ELSE (connected_trails::float / total_trails::float) * 100
        END as connectivity_score
      FROM trail_stats
    `);

    return parseFloat(result.rows[0]?.connectivity_score || '0');
  }

  /**
   * Generate recommendations for improving connectivity
   */
  private generateRecommendations(
    missingConnections: MissingConnection[],
    disconnectedComponents: DisconnectedComponent[],
    networkMetrics: NetworkMetrics
  ): string[] {
    const recommendations: string[] = [];
    
    if (missingConnections.length > 0) {
      recommendations.push(`Add ${missingConnections.length} missing trail connections within ${this.config.maxConnectionDistance}m tolerance`);
      
      const closeConnections = missingConnections.filter(c => c.distance_meters <= this.config.intersectionTolerance);
      if (closeConnections.length > 0) {
        recommendations.push(`${closeConnections.length} connections are within ${this.config.intersectionTolerance}m and should be high priority`);
      }
    }
    
    if (disconnectedComponents.length > 1) {
      recommendations.push(`Connect ${disconnectedComponents.length} disconnected trail components`);
      
      const largestComponent = disconnectedComponents[0];
      const otherComponents = disconnectedComponents.slice(1);
      recommendations.push(`Largest component has ${largestComponent.trail_count} trails, ${otherComponents.length} smaller components need connection`);
    }

    // Network metrics based recommendations
    if (networkMetrics.isolated_nodes > 0) {
      recommendations.push(`Remove ${networkMetrics.isolated_nodes} isolated nodes to improve connectivity`);
    }

    if (networkMetrics.articulation_points > 0) {
      recommendations.push(`Add connections around ${networkMetrics.articulation_points} articulation points to improve network resilience`);
    }

    if (networkMetrics.network_density < 10) {
      recommendations.push(`Low network density (${networkMetrics.network_density.toFixed(1)}%) - add more connections for better route diversity`);
    }

    if (networkMetrics.average_path_length > 10) {
      recommendations.push(`High average path length (${networkMetrics.average_path_length.toFixed(1)}km) - add shortcuts for better connectivity`);
    }

    if (networkMetrics.component_count > 1) {
      recommendations.push(`Network has ${networkMetrics.component_count} disconnected components - connect them for better route options`);
    }
    
    if (missingConnections.length === 0 && disconnectedComponents.length <= 1 && networkMetrics.network_density > 20) {
      recommendations.push('Network connectivity is good - focus on route generation improvements');
    }
    
    return recommendations;
  }

  /**
   * Generate SQL to add missing connections to the routing network
   */
  async generateConnectionSQL(missingConnections: MissingConnection[]): Promise<string> {
    console.log('🔧 Generating SQL to add missing connections...');
    
    let sql = `-- Add missing trail connections to improve route diversity\n`;
    sql += `-- Generated by NetworkConnectivityAnalyzer using PostGIS and pgRouting\n\n`;
    
    for (const connection of missingConnections.slice(0, 50)) { // Limit to top 50
      sql += `-- Connect ${connection.trail1_name} to ${connection.trail2_name} (${connection.distance_meters.toFixed(1)}m)\n`;
      sql += `INSERT INTO ${this.config.stagingSchema}.routing_edges (source, target, trail_id, geometry, length_km, elevation_gain, elevation_loss)\n`;
      sql += `SELECT \n`;
      sql += `  (SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE ST_DWithin(the_geom, ST_SetSRID(ST_MakePoint(${connection.trail1_endpoint[0]}, ${connection.trail1_endpoint[1]}), 4326), ${connection.recommended_tolerance})) as source,\n`;
      sql += `  (SELECT id FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE ST_DWithin(the_geom, ST_SetSRID(ST_MakePoint(${connection.trail2_endpoint[0]}, ${connection.trail2_endpoint[1]}), 4326), ${connection.recommended_tolerance})) as target,\n`;
      sql += `  'connection-${connection.trail1_id}-${connection.trail2_id}' as trail_id,\n`;
      sql += `  ST_SetSRID(ST_MakeLine(ST_MakePoint(${connection.trail1_endpoint[0]}, ${connection.trail1_endpoint[1]}), ST_MakePoint(${connection.trail2_endpoint[0]}, ${connection.trail2_endpoint[1]})), 4326) as geometry,\n`;
      sql += `  ${connection.distance_meters / 1000} as length_km,\n`;
      sql += `  0 as elevation_gain,\n`;
      sql += `  0 as elevation_loss\n`;
      sql += `WHERE source IS NOT NULL AND target IS NOT NULL;\n\n`;
    }
    
    return sql;
  }
} 