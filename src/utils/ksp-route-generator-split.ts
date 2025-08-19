import { Pool, Client } from 'pg';
import { RouteRecommendation, RoutePattern } from '../types/route-types';

export interface KspRouteGeneratorConfig {
  pgClient: Pool | Client;
  stagingSchema: string;
}

export class KspRouteGeneratorSplit {
  private pgClient: Pool | Client;
  private stagingSchema: string;

  constructor(config: KspRouteGeneratorConfig) {
    this.pgClient = config.pgClient;
    this.stagingSchema = config.stagingSchema;
  }

  /**
   * Initialize the routing tables using existing ways_split tables
   */
  async initializeRoutingTables(): Promise<boolean> {
    try {
      console.log('🔄 Initializing routing tables using existing ways_split tables...');
      
      // Check if ways_split tables exist
      const tablesExist = await this.pgClient.query(`
        SELECT 
          (EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 
            AND table_name = 'ways_split_vertices_pgr'
          ) AND EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 
            AND table_name = 'ways_split'
          )) as both_exist
      `, [this.stagingSchema]);
      
      if (!tablesExist.rows[0].both_exist) {
        console.error('❌ ways_split and ways_split_vertices_pgr tables do not exist');
        return false;
      }
      
      console.log('✅ Found existing ways_split tables');
      
      // Step 1: Add length and elevation columns to ways_split for KSP routing
      console.log('📏 Adding length and elevation columns to ways_split...');
      
      // Add length_km column if it doesn't exist
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.ways_split
        ADD COLUMN IF NOT EXISTS length_km REAL
      `);
      
      // Update length_km from geometry
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways_split
        SET length_km = ST_Length(the_geom::geography) / 1000
        WHERE length_km IS NULL OR length_km = 0
      `);
      
      // Add elevation_gain column if it doesn't exist
      await this.pgClient.query(`
        ALTER TABLE ${this.stagingSchema}.ways_split
        ADD COLUMN IF NOT EXISTS elevation_gain REAL DEFAULT 0
      `);
      
      // Update elevation_gain from original ways table if available
      await this.pgClient.query(`
        UPDATE ${this.stagingSchema}.ways_split w
        SET elevation_gain = COALESCE(orig.elevation_gain, 0)
        FROM ${this.stagingSchema}.ways orig
        WHERE w.old_id = orig.id
      `);
      
      console.log('✅ Added length_km and elevation_gain columns to ways_split');
      
      // Step 2: Ensure topology is properly set up
      console.log('🔗 Ensuring topology is properly set up...');
      
      // Check if source/target columns exist
      const columnsExist = await this.pgClient.query(`
        SELECT 
          (EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = $1 
            AND table_name = 'ways_split' 
            AND column_name = 'source'
          ) AND EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = $1 
            AND table_name = 'ways_split' 
            AND column_name = 'target'
          )) as both_exist
      `, [this.stagingSchema]);
      
      if (!columnsExist.rows[0].both_exist) {
        console.log('⚠️ Source/target columns missing, creating topology...');
        
        // Create topology using pgRouting
        await this.pgClient.query(`
          SELECT pgr_createTopology('${this.stagingSchema}.ways_split', 0.00001, 'the_geom', 'id')
        `);
        
        console.log('✅ Created topology for ways_split');
      } else {
        console.log('✅ Topology already exists for ways_split');
      }
      
      // Step 3: Validate the network
      const networkStats = await this.pgClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_split) as edges,
          (SELECT COUNT(*) FROM ${this.stagingSchema}.ways_split_vertices_pgr) as vertices
      `);
      
      console.log(`📊 Network stats: ${networkStats.rows[0].edges} edges, ${networkStats.rows[0].vertices} vertices`);
      
      return true;
    } catch (error) {
      console.error('❌ Error initializing routing tables:', error);
      return false;
    }
  }

  /**
   * Generate point-to-point routes using existing ways_split tables
   */
  async generatePointToPointRoutes(pattern: RoutePattern, targetRoutes: number = 5): Promise<RouteRecommendation[]> {
    try {
      console.log(`🔄 Generating point-to-point routes for pattern: ${pattern.input_length_km}km, ${pattern.input_elevation_gain}m`);
      
      // Get intersection nodes (degree >= 2)
      const nodesResult = await this.pgClient.query(`
        SELECT id, the_geom, cnt as degree
        FROM ${this.stagingSchema}.ways_split_vertices_pgr
        WHERE cnt >= 2
        ORDER BY RANDOM()
        LIMIT ${targetRoutes * 2}
      `);
      
      if (nodesResult.rows.length < 2) {
        console.log('⚠️ Not enough intersection nodes for point-to-point routing');
        return [];
      }
      
      const routes: RouteRecommendation[] = [];
      
      // Generate routes between pairs of nodes
      for (let i = 0; i < nodesResult.rows.length - 1; i += 2) {
        const startNode = nodesResult.rows[i];
        const endNode = nodesResult.rows[i + 1];
        
        console.log(`🔄 Trying point-to-point from node ${startNode.id} to ${endNode.id}`);
        
        try {
          // Use pgr_dijkstra for point-to-point routing
          const dijkstraResult = await this.pgClient.query(`
            SELECT * FROM pgr_dijkstra(
              'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_split',
              $1::integer, $2::integer, false
            )
          `, [startNode.id, endNode.id]);
          
          if (dijkstraResult.rows.length === 0) continue;
          
          // Calculate metrics
          let totalDistance = 0;
          let totalElevationGain = 0;
          const edgeIds = dijkstraResult.rows.map((row: any) => row.edge).filter((edge: number) => edge !== -1);
          
          if (edgeIds.length === 0) continue;
          
          const routeEdges = await this.pgClient.query(`
            SELECT * FROM ${this.stagingSchema}.ways_split 
            WHERE id = ANY($1::integer[])
          `, [edgeIds]);
          
          for (const edge of routeEdges.rows) {
            totalDistance += edge.length_km || 0;
            totalElevationGain += edge.elevation_gain || 0;
          }
          
          // Check if route meets pattern criteria
          const distanceDiff = Math.abs(totalDistance - pattern.input_length_km);
          const elevationDiff = Math.abs(totalElevationGain - pattern.input_elevation_gain);
          
          if (distanceDiff <= pattern.input_length_km * 0.5 && elevationDiff <= pattern.input_elevation_gain * 0.5) {
            const route: RouteRecommendation = {
              route_uuid: `split-point-to-point-${Date.now()}-${i}`,
              input_length_km: pattern.input_length_km,
              input_elevation_gain: pattern.input_elevation_gain,
              recommended_length_km: totalDistance,
              recommended_elevation_gain: totalElevationGain,
              route_score: this.calculateRouteScore(totalDistance, totalElevationGain, pattern),
              route_type: 'point-to-point',
              route_name: `Point-to-Point via ${routeEdges.rows[0]?.name || 'Trail'}`,
              route_shape: 'point-to-point',
              trail_count: routeEdges.rows.length,
              route_path: { steps: dijkstraResult.rows },
              route_edges: edgeIds,
              created_at: new Date().toISOString()
            };
            
            routes.push(route);
            console.log(`✅ Generated point-to-point route: ${totalDistance.toFixed(2)}km, ${totalElevationGain.toFixed(1)}m`);
          }
        } catch (error) {
          console.log(`⚠️ Failed to generate route from ${startNode.id} to ${endNode.id}: ${error}`);
        }
      }
      
      console.log(`✅ Generated ${routes.length} point-to-point routes`);
      return routes;
    } catch (error) {
      console.error('❌ Error generating point-to-point routes:', error);
      return [];
    }
  }

  /**
   * Generate out-and-back routes using existing ways_split tables
   */
  async generateOutAndBackRoutes(pattern: RoutePattern, targetRoutes: number = 5): Promise<RouteRecommendation[]> {
    try {
      console.log(`🔄 Generating out-and-back routes for pattern: ${pattern.input_length_km}km, ${pattern.input_elevation_gain}m`);
      
      // Get nodes with degree >= 2 (intersections)
      const nodesResult = await this.pgClient.query(`
        SELECT id, the_geom, cnt as degree
        FROM ${this.stagingSchema}.ways_split_vertices_pgr
        WHERE cnt >= 2
        ORDER BY RANDOM()
        LIMIT ${targetRoutes}
      `);
      
      const routes: RouteRecommendation[] = [];
      
      for (const node of nodesResult.rows) {
        try {
          // Find edges connected to this node
          const connectedEdges = await this.pgClient.query(`
            SELECT * FROM ${this.stagingSchema}.ways_split
            WHERE source = $1 OR target = $1
            ORDER BY length_km DESC
            LIMIT 3
          `, [node.id]);
          
          if (connectedEdges.rows.length === 0) continue;
          
          // Use the longest connected edge for out-and-back
          const edge = connectedEdges.rows[0];
          const totalDistance = (edge.length_km || 0) * 2; // Out and back
          const totalElevationGain = (edge.elevation_gain || 0) * 2;
          
          // Check if route meets pattern criteria
          const distanceDiff = Math.abs(totalDistance - pattern.input_length_km);
          const elevationDiff = Math.abs(totalElevationGain - pattern.input_elevation_gain);
          
          if (distanceDiff <= pattern.input_length_km * 0.5 && elevationDiff <= pattern.input_elevation_gain * 0.5) {
            const route: RouteRecommendation = {
              route_uuid: `split-out-and-back-${Date.now()}-${node.id}`,
              input_length_km: pattern.input_length_km,
              input_elevation_gain: pattern.input_elevation_gain,
              recommended_length_km: totalDistance,
              recommended_elevation_gain: totalElevationGain,
              route_score: this.calculateRouteScore(totalDistance, totalElevationGain, pattern),
              route_type: 'out-and-back',
              route_name: `Out-and-Back via ${edge.name || 'Trail'}`,
              route_shape: 'out-and-back',
              trail_count: 1,
              route_path: { steps: [{ edge: edge.id, cost: edge.length_km }] },
              route_edges: [edge.id],
              created_at: new Date().toISOString()
            };
            
            routes.push(route);
            console.log(`✅ Generated out-and-back route: ${totalDistance.toFixed(2)}km, ${totalElevationGain.toFixed(1)}m`);
          }
        } catch (error) {
          console.log(`⚠️ Failed to generate out-and-back route for node ${node.id}: ${error}`);
        }
      }
      
      console.log(`✅ Generated ${routes.length} out-and-back routes`);
      return routes;
    } catch (error) {
      console.error('❌ Error generating out-and-back routes:', error);
      return [];
    }
  }

  /**
   * Calculate route score based on how well it matches the target pattern
   */
  private calculateRouteScore(actualDistance: number, actualElevation: number, pattern: RoutePattern): number {
    const distanceDiff = Math.abs(actualDistance - pattern.input_length_km) / pattern.input_length_km;
    const elevationDiff = Math.abs(actualElevation - pattern.input_elevation_gain) / pattern.input_elevation_gain;
    
    // Lower score is better (closer to target)
    return (distanceDiff + elevationDiff) / 2;
  }
}
