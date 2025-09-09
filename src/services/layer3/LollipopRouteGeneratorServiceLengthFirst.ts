import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface LollipopRoute {
  anchor_node: number;
  dest_node: number;
  outbound_distance: number;
  return_distance: number;
  total_distance: number;
  path_id: number;
  connection_type: string;
  route_shape: string;
  edge_overlap_count: number;
  edge_overlap_percentage: number;
  route_geometry: string;
  edge_ids: number[];
}

export interface LollipopRouteGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetDistance: number;
  maxAnchorNodes: number;
  maxReachableNodes: number;
  maxDestinationExploration: number;
  distanceRangeMin: number;
  distanceRangeMax: number;
  edgeOverlapThreshold: number;
  kspPaths: number;
  minOutboundDistance: number;
  outputPath?: string;
  specificAnchorNodes?: number[]; // Optional: specify exact anchor nodes to use
}

export class LollipopRouteGeneratorServiceLengthFirst {
  private pgClient: Pool;
  private config: LollipopRouteGeneratorConfig;

  constructor(pgClient: Pool, config: LollipopRouteGeneratorConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  async generateLollipopRoutes(): Promise<LollipopRoute[]> {
    console.log('🍭 Starting LENGTH-FIRST lollipop route generation...');
    console.log(`   Target distance: ${this.config.targetDistance}km`);
    console.log(`   Max anchor nodes: ${this.config.maxAnchorNodes}`);
    console.log(`   Strategy: Collect ALL routes, filter by length later`);

    // Find anchor nodes - either specific ones or high-degree nodes
    let anchorNodes;
    if (this.config.specificAnchorNodes && this.config.specificAnchorNodes.length > 0) {
      // Use specific anchor nodes
      const nodeIds = this.config.specificAnchorNodes.join(',');
      anchorNodes = await this.pgClient.query(`
        SELECT id, 
          (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) as connection_count
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
        WHERE id IN (${nodeIds})
        ORDER BY connection_count DESC
      `);
      console.log(`   Using ${anchorNodes.rows.length} specific anchor nodes: ${this.config.specificAnchorNodes.join(', ')}`);
    } else {
      // Find high-degree anchor nodes (3+ connections)
      anchorNodes = await this.pgClient.query(`
        SELECT id, 
          (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) as connection_count
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
        WHERE (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 3
        ORDER BY connection_count DESC
        LIMIT ${this.config.maxAnchorNodes}
      `);
    }
    
    console.log(`   Found ${anchorNodes.rows.length} anchor nodes`);

    const allRoutes: LollipopRoute[] = [];

    for (const anchorNodeRow of anchorNodes.rows) {
      const anchorNode = anchorNodeRow.id;
      console.log(`\n🔍 Exploring anchor node ${anchorNode} (${anchorNodeRow.connection_count} connections)`);
      
      const reachableNodes = await this.findReachableNodes(anchorNode, this.config.targetDistance);
      console.log(`   Found ${reachableNodes.rows.length} reachable nodes`);

      const loopPaths: LollipopRoute[] = [];
      
      // Explore ALL destinations (no filtering during discovery)
      const destinations = reachableNodes.rows.slice(0, this.config.maxDestinationExploration);
      
      for (const destNode of destinations) {
        console.log(`     Exploring destination ${destNode.node_id} (${destNode.connection_type})`);
        
        // Get outbound path
        const outboundPaths = await this.pgClient.query(`
          SELECT seq, node, edge, cost, agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
            $1::bigint, $2::bigint, false
          )
          WHERE edge != -1
          ORDER BY seq
        `, [anchorNode, destNode.node_id]);

        if (outboundPaths.rows.length === 0) {
          console.log(`       ❌ No outbound path found`);
          continue;
        }
        
        const outboundDistance = outboundPaths.rows[outboundPaths.rows.length - 1].agg_cost;
        console.log(`       📏 Outbound distance: ${outboundDistance.toFixed(2)}km`);
        
        // Skip only if outbound distance is extremely short
        if (outboundDistance < this.config.minOutboundDistance) {
          console.log(`       ❌ Outbound distance too short: ${outboundDistance.toFixed(2)}km`);
          continue;
        }

        const outboundEdges = outboundPaths.rows
          .filter(row => row.edge !== -1)
          .map(row => row.edge);
        
        // Get return paths using K-Shortest Paths for more alternatives
        const returnPaths = await this.pgClient.query(`
          SELECT seq, node, edge, cost, agg_cost, path_id
          FROM pgr_ksp(
            'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
            $1::bigint, $2::bigint, ${this.config.kspPaths}, false, false
          )
          WHERE edge != -1
          ORDER BY path_id, agg_cost ASC
        `, [destNode.node_id, anchorNode]);
        
        if (returnPaths.rows.length === 0) {
          console.log(`       ❌ No return paths found`);
          continue;
        }

        // Group return paths by path_id
        const returnPathGroups = new Map<number, any[]>();
        for (const row of returnPaths.rows) {
          if (!returnPathGroups.has(row.path_id)) {
            returnPathGroups.set(row.path_id, []);
          }
          returnPathGroups.get(row.path_id)!.push(row);
        }
        
        let bestReturnPath: any[] | null = null;
        let minEdgeOverlap = Infinity;
        let bestReturnDistance = 0;
        
        // Find the return path with minimal edge overlap
        for (const [pathId, pathRows] of returnPathGroups) {
          const returnDistance = pathRows[pathRows.length - 1].agg_cost;
          const returnEdges = pathRows
            .filter(row => row.edge !== -1)
            .map(row => row.edge);
          
          const edgeOverlap = outboundEdges.filter(edge => returnEdges.includes(edge)).length;
          const overlapPercentage = (edgeOverlap / Math.max(outboundEdges.length, returnEdges.length)) * 100;
          
          console.log(`       🔄 Return path ${pathId}: ${returnDistance.toFixed(2)}km, ${edgeOverlap} overlapping edges`);
          
          if (edgeOverlap < minEdgeOverlap) {
            minEdgeOverlap = edgeOverlap;
            bestReturnPath = pathRows;
            bestReturnDistance = returnDistance;
          }
        }

        if (!bestReturnPath) {
          console.log(`       ❌ No valid return path found`);
          continue;
        }
        
        const totalDistance = outboundDistance + bestReturnDistance;
        const overlapPercentage = (minEdgeOverlap / Math.max(outboundEdges.length, bestReturnPath.filter(row => row.edge !== -1).length)) * 100;
        
        console.log(`       ✅ Found route: ${totalDistance.toFixed(2)}km total (${outboundDistance.toFixed(2)}km out + ${bestReturnDistance.toFixed(2)}km back)`);
        console.log(`       📊 Edge overlap: ${minEdgeOverlap} edges (${overlapPercentage.toFixed(1)}%)`);
        
        // NO FILTERING - collect ALL routes regardless of overlap
        console.log(`       ✅ Collecting route - no filtering applied`);
        
        // Create route geometry
        const routeShape = await this.createRouteGeometry(outboundPaths.rows, bestReturnPath);
        
        // Collect all edge IDs from outbound and return paths
        const outboundEdgeIds = outboundPaths.rows
          .filter(row => row.edge !== -1)
          .map(row => row.edge);
        const returnEdgeIds = bestReturnPath
          .filter(row => row.edge !== -1)
          .map(row => row.edge);
        const allEdgeIds = [...outboundEdgeIds, ...returnEdgeIds];

        const route: LollipopRoute = {
          anchor_node: anchorNode,
          dest_node: destNode.node_id,
          outbound_distance: outboundDistance,
          return_distance: bestReturnDistance,
          total_distance: totalDistance,
          path_id: 1,
          connection_type: destNode.connection_type,
          route_shape: routeShape,
          edge_overlap_count: minEdgeOverlap,
          edge_overlap_percentage: overlapPercentage,
          route_geometry: routeShape,
          edge_ids: allEdgeIds
        };

        loopPaths.push(route);
        console.log(`       📝 Route added to collection (${loopPaths.length} total for this anchor)`);
      }

      // Add all routes from this anchor to the global collection
      allRoutes.push(...loopPaths);
      console.log(`   📊 Anchor ${anchorNode} contributed ${loopPaths.length} routes (${allRoutes.length} total routes collected)`);
    }

    console.log(`\n🎯 LENGTH-FIRST COLLECTION COMPLETE:`);
    console.log(`   • Total routes collected: ${allRoutes.length}`);
    console.log(`   • No filtering applied during discovery`);
    console.log(`   • Ready for length-based filtering`);

    return allRoutes;
  }

  private async findReachableNodes(
    anchorNode: number,
    targetDistance: number
  ): Promise<{ rows: any[] }> {
    // Enhanced node selection with wider range and more nodes
    const reachableNodes = await this.pgClient.query(`
      WITH direct_reachable AS (
        SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
        FROM pgr_dijkstra(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint,
          (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr WHERE (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 2),
          false
        )
        WHERE agg_cost BETWEEN $2 * 0.2 AND $2 * 0.8
        AND end_vid != $1
      ),
      nearby_nodes AS (
        SELECT DISTINCT rn2.id as node_id,
               ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) as distance_meters
        FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr rn1
        CROSS JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr rn2
        WHERE rn1.id = $1
        AND rn2.id != $1
        AND (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = rn2.id OR target = rn2.id) >= 2
        AND ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) <= $2 * 1000
      )
      SELECT node_id, distance_meters/1000.0 as distance_km, 'nearby' as connection_type
      FROM nearby_nodes
      ORDER BY distance_km DESC
      LIMIT ${this.config.maxReachableNodes}
    `, [anchorNode, targetDistance]);

    return reachableNodes;
  }

  private async createRouteGeometry(outboundPaths: any[], returnPaths: any[]): Promise<string> {
    // Create route geometry by combining outbound and return paths
    const allPaths = [...outboundPaths, ...returnPaths];
    
    // Create a simple route shape description
    const routeShape = `Route with ${allPaths.length} segments`;
    
    return routeShape;
  }

  async saveToDatabase(routes: LollipopRoute[]): Promise<void> {
    console.log(`💾 Saving ${routes.length} routes to database...`);
    
    // Create table if it doesn't exist
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.lollipop_routes (
        id SERIAL PRIMARY KEY,
        anchor_node INTEGER,
        dest_node INTEGER,
        outbound_distance DECIMAL,
        return_distance DECIMAL,
        total_distance DECIMAL,
        path_id INTEGER,
        connection_type VARCHAR(50),
        route_shape TEXT,
        edge_overlap_count INTEGER,
        edge_overlap_percentage DECIMAL,
        route_geometry TEXT,
        edge_ids INTEGER[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Drop and recreate table to ensure correct schema
    await this.pgClient.query(`DROP TABLE IF EXISTS ${this.config.stagingSchema}.lollipop_routes`);
    await this.pgClient.query(`
      CREATE TABLE ${this.config.stagingSchema}.lollipop_routes (
        id SERIAL PRIMARY KEY,
        anchor_node INTEGER,
        dest_node INTEGER,
        outbound_distance DECIMAL,
        return_distance DECIMAL,
        total_distance DECIMAL,
        path_id INTEGER,
        connection_type VARCHAR(50),
        route_shape TEXT,
        edge_overlap_count INTEGER,
        edge_overlap_percentage DECIMAL,
        route_geometry TEXT,
        edge_ids INTEGER[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Clear existing routes
    await this.pgClient.query(`DELETE FROM ${this.config.stagingSchema}.lollipop_routes`);

    // Insert new routes
    for (const route of routes) {
      await this.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.lollipop_routes 
        (anchor_node, dest_node, outbound_distance, return_distance, total_distance, 
         path_id, connection_type, route_shape, edge_overlap_count, edge_overlap_percentage, 
         route_geometry, edge_ids)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        route.anchor_node,
        route.dest_node,
        route.outbound_distance,
        route.return_distance,
        route.total_distance,
        route.path_id,
        route.connection_type,
        route.route_shape,
        route.edge_overlap_count,
        route.edge_overlap_percentage,
        route.route_geometry,
        route.edge_ids
      ]);
    }

    console.log(`✅ Saved ${routes.length} routes to database`);
  }

  async exportToGeoJSON(routes: LollipopRoute[], outputPath: string): Promise<void> {
    console.log(`📁 Exporting ${routes.length} routes to GeoJSON...`);
    
    const geojson: any = {
      type: 'FeatureCollection',
      features: []
    };

    // Generate actual geometry for each route
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      console.log(`   🔧 Generating geometry for route ${i + 1}/${routes.length} (${route.edge_ids.length} edges)`);
      
      // Get the actual geometry from the edge IDs
      const geometryResult = await this.pgClient.query(`
        SELECT ST_AsGeoJSON(ST_LineMerge(ST_Collect(
          CASE 
            WHEN source = $1 THEN the_geom 
            ELSE ST_Reverse(the_geom) 
          END
        ))) as route_geom
        FROM ${this.config.stagingSchema}.ways_noded 
        WHERE id = ANY($2::int[])
      `, [route.anchor_node, route.edge_ids]);

      let geometry;
      if (geometryResult.rows.length > 0 && geometryResult.rows[0].route_geom) {
        try {
          geometry = JSON.parse(geometryResult.rows[0].route_geom);
        } catch (e) {
          console.log(`   ⚠️  Failed to parse geometry for route ${i + 1}, using placeholder`);
          geometry = {
            type: 'LineString',
            coordinates: [[0, 0, 0], [0, 0, 0]]
          };
        }
      } else {
        console.log(`   ⚠️  No geometry found for route ${i + 1}, using placeholder`);
        geometry = {
          type: 'LineString',
          coordinates: [[0, 0, 0], [0, 0, 0]]
        };
      }

      geojson.features.push({
        type: 'Feature',
        properties: {
          id: i + 1,
          anchor_node: route.anchor_node,
          dest_node: route.dest_node,
          outbound_distance: route.outbound_distance,
          return_distance: route.return_distance,
          total_distance: route.total_distance,
          path_id: route.path_id,
          connection_type: route.connection_type,
          route_shape: route.route_shape,
          edge_overlap_count: route.edge_overlap_count,
          edge_overlap_percentage: route.edge_overlap_percentage,
          edge_ids: route.edge_ids
        },
        geometry: geometry
      });
    }

    // Add metadata
    const metadata = {
      generated_at: new Date().toISOString(),
      schema: this.config.stagingSchema,
      region: this.config.region,
      strategy: 'LENGTH-FIRST',
      total_routes: routes.length,
      max_distance_km: routes.length > 0 ? Math.max(...routes.map(r => r.total_distance)) : 0,
      average_distance_km: routes.length > 0 ? (routes.reduce((sum, r) => sum + r.total_distance, 0) / routes.length) : 0
    };

    geojson.metadata = metadata;

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write to file
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
    console.log(`✅ Exported to: ${outputPath}`);
  }
}
