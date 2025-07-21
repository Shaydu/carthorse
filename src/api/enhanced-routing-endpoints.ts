import { Client } from 'pg';
import Database from 'better-sqlite3';

export interface RoutingNode {
  id: number;
  node_uuid: string;
  lat: number;
  lng: number;
  elevation: number;
  node_type: 'intersection' | 'endpoint';
  connected_trails: string;
}

export interface RoutingEdge {
  id: number;
  from_node_id: number;
  to_node_id: number;
  trail_id: string;
  trail_name: string;
  distance_km: number;
  elevation_gain: number;
}

export interface BBoxQuery {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export class EnhancedRoutingEndpoints {
  private db: any; // Using any to avoid type conflicts with better-sqlite3

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
    this.db.loadExtension('/opt/homebrew/lib/mod_spatialite.dylib');
  }

  /**
   * Enhanced routing graph endpoint with spatial filtering and validation
   */
  async getRoutingGraph(bbox?: BBoxQuery): Promise<{
    nodes: RoutingNode[];
    edges: RoutingEdge[];
    stats: {
      totalNodes: number;
      totalEdges: number;
      intersectionNodes: number;
      endpointNodes: number;
      nodeToTrailRatio: number;
    };
  }> {
    try {
      // Build spatial filter query
      let spatialFilter = '';
      let params: any[] = [];
      
      if (bbox) {
        spatialFilter = `
          WHERE ST_Within(
            ST_SetSRID(ST_Point(lng, lat), 4326),
            ST_MakeEnvelope(?, ?, ?, ?, 4326)
          )
        `;
        params = [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];
      }

      // Get routing nodes with spatial filtering
      const nodesQuery = `
        SELECT 
          id, node_uuid, lat, lng, elevation, node_type, connected_trails
        FROM routing_nodes
        ${spatialFilter}
        ORDER BY id
      `;
      
      const nodes = this.db.prepare(nodesQuery).all(params) as RoutingNode[];

      // Get routing edges for the filtered nodes
      const nodeIds = nodes.map(n => n.id);
      let edgesQuery = `
        SELECT 
          id, from_node_id, to_node_id, trail_id, trail_name, 
          distance_km, elevation_gain
        FROM routing_edges
      `;
      
      if (nodeIds.length > 0) {
        edgesQuery += ` WHERE from_node_id IN (${nodeIds.map(() => '?').join(',')}) 
                         OR to_node_id IN (${nodeIds.map(() => '?').join(',')})`;
        params = [...nodeIds, ...nodeIds];
      }
      
      edgesQuery += ' ORDER BY id';
      const edges = this.db.prepare(edgesQuery).all(params) as RoutingEdge[];

      // Calculate statistics
      const totalNodes = nodes.length;
      const totalEdges = edges.length;
      const intersectionNodes = nodes.filter(n => n.node_type === 'intersection').length;
      const endpointNodes = nodes.filter(n => n.node_type === 'endpoint').length;
      
      // Get total trails for ratio calculation
      const trailCount = this.db.prepare('SELECT COUNT(*) as count FROM trails').get() as { count: number };
      const nodeToTrailRatio = trailCount.count > 0 ? totalNodes / trailCount.count : 0;

      return {
        nodes,
        edges,
        stats: {
          totalNodes,
          totalEdges,
          intersectionNodes,
          endpointNodes,
          nodeToTrailRatio
        }
      };
    } catch (error) {
      throw new Error(`Failed to get routing graph: ${error}`);
    }
  }

  /**
   * Get nodes within a specific distance of a point using spatial functions
   */
  async getNodesNearPoint(lat: number, lng: number, distanceKm: number): Promise<RoutingNode[]> {
    try {
      const query = `
        SELECT 
          id, node_uuid, lat, lng, elevation, node_type, connected_trails
        FROM routing_nodes
        WHERE ST_DWithin(
          ST_SetSRID(ST_Point(lng, lat), 4326),
          ST_SetSRID(ST_Point(routing_nodes.lng, routing_nodes.lat), 4326),
          ?
        )
        ORDER BY ST_Distance(
          ST_SetSRID(ST_Point(?, ?), 4326),
          ST_SetSRID(ST_Point(routing_nodes.lng, routing_nodes.lat), 4326)
        )
      `;
      
      return this.db.prepare(query).all([distanceKm * 1000, lng, lat]) as RoutingNode[];
    } catch (error) {
      throw new Error(`Failed to get nodes near point: ${error}`);
    }
  }

  /**
   * Get trails that intersect with a given geometry using spatial functions
   */
  async getTrailsInBBox(bbox: BBoxQuery): Promise<any[]> {
    try {
      const query = `
        SELECT 
          id, app_uuid, name, trail_type, surface, difficulty,
          length_km, elevation_gain, elevation_loss,
          bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          AsText(geometry) as geometry_wkt
        FROM trails
        WHERE ST_Intersects(
          geometry,
          ST_MakeEnvelope(?, ?, ?, ?, 4326)
        )
        ORDER BY name
      `;
      
      return this.db.prepare(query).all([bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    } catch (error) {
      throw new Error(`Failed to get trails in bbox: ${error}`);
    }
  }

  /**
   * Validate routing graph data integrity
   */
  async validateRoutingGraph(): Promise<{
    isValid: boolean;
    issues: string[];
    stats: any;
  }> {
    const issues: string[] = [];
    
    try {
      // Check for orphaned edges
      const orphanedEdges = this.db.prepare(`
        SELECT COUNT(*) as count FROM routing_edges e
        LEFT JOIN routing_nodes n1 ON e.from_node_id = n1.id
        LEFT JOIN routing_nodes n2 ON e.to_node_id = n2.id
        WHERE n1.id IS NULL OR n2.id IS NULL
      `).get() as { count: number };
      
      if (orphanedEdges.count > 0) {
        issues.push(`${orphanedEdges.count} edges have invalid node references`);
      }

      // Check for self-loops
      const selfLoops = this.db.prepare(`
        SELECT COUNT(*) as count FROM routing_edges 
        WHERE from_node_id = to_node_id
      `).get() as { count: number };
      
      if (selfLoops.count > 0) {
        issues.push(`${selfLoops.count} edges are self-loops`);
      }

      // Check for duplicate nodes at same location
      const duplicateNodes = this.db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT lat, lng, COUNT(*) as node_count
          FROM routing_nodes
          GROUP BY lat, lng
          HAVING COUNT(*) > 1
        )
      `).get() as { count: number };
      
      if (duplicateNodes.count > 0) {
        issues.push(`${duplicateNodes.count} locations have duplicate nodes`);
      }

      // Get basic stats
      const nodeCount = this.db.prepare('SELECT COUNT(*) as count FROM routing_nodes').get() as { count: number };
      const edgeCount = this.db.prepare('SELECT COUNT(*) as count FROM routing_edges').get() as { count: number };
      const trailCount = this.db.prepare('SELECT COUNT(*) as count FROM trails').get() as { count: number };

      return {
        isValid: issues.length === 0,
        issues,
        stats: {
          nodes: nodeCount.count,
          edges: edgeCount.count,
          trails: trailCount.count,
          nodeToTrailRatio: trailCount.count > 0 ? nodeCount.count / trailCount.count : 0
        }
      };
    } catch (error) {
      issues.push(`Validation failed: ${error}`);
      return {
        isValid: false,
        issues,
        stats: {}
      };
    }
  }

  /**
   * Get intersection statistics using spatial analysis
   */
  async getIntersectionStats(): Promise<{
    totalIntersections: number;
    averageTrailsPerIntersection: number;
    mostConnectedIntersection: number;
    isolatedTrails: number;
  }> {
    try {
      // Count intersection nodes
      const intersectionCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM routing_nodes WHERE node_type = 'intersection'
      `).get() as { count: number };

      // Calculate average trails per intersection
      const avgTrailsPerIntersection = this.db.prepare(`
        SELECT AVG(trail_count) as avg_count FROM (
          SELECT 
            node_type,
            CASE 
              WHEN node_type = 'intersection' THEN 
                (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1)
              ELSE 1
            END as trail_count
          FROM routing_nodes
          WHERE node_type = 'intersection'
        )
      `).get() as { avg_count: number };

      // Find most connected intersection
      const mostConnected = this.db.prepare(`
        SELECT MAX(trail_count) as max_count FROM (
          SELECT 
            (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) as trail_count
          FROM routing_nodes
          WHERE node_type = 'intersection'
        )
      `).get() as { max_count: number };

      // Count isolated trails (endpoint nodes with only one trail)
      const isolatedTrails = this.db.prepare(`
        SELECT COUNT(*) as count FROM routing_nodes 
        WHERE node_type = 'endpoint' 
        AND (LENGTH(connected_trails) - LENGTH(REPLACE(connected_trails, ',', '')) + 1) = 1
      `).get() as { count: number };

      return {
        totalIntersections: intersectionCount.count,
        averageTrailsPerIntersection: avgTrailsPerIntersection.avg_count || 0,
        mostConnectedIntersection: mostConnected.max_count || 0,
        isolatedTrails: isolatedTrails.count
      };
    } catch (error) {
      throw new Error(`Failed to get intersection stats: ${error}`);
    }
  }

  close(): void {
    this.db.close();
  }
} 