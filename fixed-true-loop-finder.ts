import { Client } from 'pg';
import { loadConfig } from './src/utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

interface TrueLoopRoute {
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
}

class FixedTrueLoopFinder {
  private client: Client;
  private schema: string;

  constructor(schema: string) {
    this.schema = schema;
    this.client = new Client(loadConfig().database.connection);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  /**
   * Find true loops by excluding outbound path edges from return path search
   * This ensures we get truly different paths for the return journey
   */
  async findTrueLoops(): Promise<TrueLoopRoute[]> {
    console.log(`🔍 Finding fixed true loops in schema: ${this.schema}`);
    console.log(`🔍 Using edge exclusion approach for true loops`);

    // Get high-degree nodes as anchor points
    const anchorNodes = await this.client.query(`
      SELECT id, 
             (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) as degree
      FROM ${this.schema}.ways_noded_vertices_pgr
      WHERE (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 3
      ORDER BY degree DESC
      LIMIT 10
    `);

    console.log(`🔍 Found ${anchorNodes.rows.length} anchor nodes for true loop discovery`);

    const allLoops: TrueLoopRoute[] = [];

    for (const anchorNode of anchorNodes.rows) {
      console.log(`🔍 Exploring true loops from anchor node ${anchorNode.id} (${anchorNode.degree} connections)`);
      
      const loops = await this.findTrueLoopsFromAnchor(anchorNode.id);
      allLoops.push(...loops);
      
      if (allLoops.length >= 20) {  // Limit to prevent excessive computation
        console.log(`🔍 Found ${allLoops.length} loops, stopping search`);
        break;
      }
    }

    return allLoops;
  }

  private async findTrueLoopsFromAnchor(anchorNode: number): Promise<TrueLoopRoute[]> {
    const targetDistance = 20; // 20km target distance
    
    // Find reachable nodes within target distance range
    const reachableNodes = await this.client.query(`
      WITH direct_reachable AS (
        SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
        FROM pgr_dijkstra(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.schema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint,
          (SELECT array_agg(id) FROM ${this.schema}.ways_noded_vertices_pgr WHERE (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 2),
          false
        )
        WHERE agg_cost BETWEEN $2 * 0.3 AND $2 * 0.7
        AND end_vid != $1
      ),
      nearby_nodes AS (
        SELECT DISTINCT rn2.id as node_id,
               ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) as distance_meters
        FROM ${this.schema}.ways_noded_vertices_pgr rn1
        JOIN ${this.schema}.ways_noded_vertices_pgr rn2 ON rn2.id != rn1.id
        WHERE rn1.id = $1
        AND (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = rn2.id OR target = rn2.id) >= 2
        AND ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) <= 100
        AND rn2.id != $1
      )
      SELECT node_id, distance_km, 'direct' as connection_type
      FROM direct_reachable
      UNION ALL
      SELECT node_id, distance_meters/1000.0 as distance_km, 'nearby' as connection_type
      FROM nearby_nodes
      ORDER BY distance_km DESC
      LIMIT 10
    `, [anchorNode, targetDistance]);
    
    console.log(`🔍 Found ${reachableNodes.rows.length} reachable nodes`);
    
    const loopPaths: TrueLoopRoute[] = [];
    
    for (const destNode of reachableNodes.rows.slice(0, 5)) {  // Limit to 5 for testing
      console.log(`🔍 Exploring true loop from ${anchorNode} → ${destNode.node_id} (${destNode.distance_km.toFixed(1)}km outbound, ${destNode.connection_type} connection)`);
      
      // Get outbound path
      const outboundPaths = await this.client.query(`
        SELECT seq, node, edge, cost, agg_cost
        FROM pgr_dijkstra(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.schema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint, $2::bigint, false
        )
        WHERE edge != -1
        ORDER BY seq
      `, [anchorNode, destNode.node_id]);
      
      if (outboundPaths.rows.length === 0) {
        console.log(`      ❌ No outbound path found`);
        continue;
      }
      
      const outboundDistance = outboundPaths.rows[outboundPaths.rows.length - 1].agg_cost;
      console.log(`      📏 Outbound distance: ${outboundDistance.toFixed(2)}km`);
      
      if (outboundDistance < 5) {
        console.log(`      ❌ Outbound distance too short: ${outboundDistance.toFixed(2)}km`);
        continue;
      }
      
      const outboundEdges = outboundPaths.rows
        .filter(row => row.edge !== -1)
        .map(row => row.edge);
      
      console.log(`      📊 Outbound path uses ${outboundEdges.length} edges`);
      
      // Get return path EXCLUDING outbound edges
      const excludedEdgesStr = outboundEdges.join(',');
      const returnPaths = await this.client.query(`
        SELECT seq, node, edge, cost, agg_cost
        FROM pgr_dijkstra(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.schema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL AND id NOT IN (${excludedEdgesStr})',
          $1::bigint, $2::bigint, false
        )
        WHERE edge != -1
        ORDER BY seq
      `, [destNode.node_id, anchorNode]);
      
      if (returnPaths.rows.length === 0) {
        console.log(`      ❌ No return path found (excluding outbound edges)`);
        continue;
      }
      
      const returnDistance = returnPaths.rows[returnPaths.rows.length - 1].agg_cost;
      const returnEdges = returnPaths.rows
        .filter(row => row.edge !== -1)
        .map(row => row.edge);
      
      console.log(`      📏 Return distance: ${returnDistance.toFixed(2)}km`);
      console.log(`      📊 Return path uses ${returnEdges.length} edges`);
      
      // Check for edge overlap (should be 0 if our exclusion worked)
      const edgeOverlap = outboundEdges.filter(edge => returnEdges.includes(edge)).length;
      const overlapPercentage = (edgeOverlap / Math.max(outboundEdges.length, returnEdges.length)) * 100;
      
      console.log(`      📊 Edge overlap: ${edgeOverlap} edges (${overlapPercentage.toFixed(1)}%)`);
      
      if (overlapPercentage > 10) {  // Allow small overlap due to graph structure
        console.log(`      ❌ Too much edge overlap: ${overlapPercentage.toFixed(1)}%`);
        continue;
      }
      
      const totalDistance = outboundDistance + returnDistance;
      console.log(`      ✅ Found true loop: ${totalDistance.toFixed(2)}km total (${outboundDistance.toFixed(2)}km out + ${returnDistance.toFixed(2)}km back)`);
      
      // Create route geometry
      const routeShape = await this.createRouteGeometry(outboundPaths.rows, returnPaths.rows);
      
      const loopRoute: TrueLoopRoute = {
        anchor_node: anchorNode,
        dest_node: destNode.node_id,
        outbound_distance: outboundDistance,
        return_distance: returnDistance,
        total_distance: totalDistance,
        path_id: 1,
        connection_type: destNode.connection_type,
        route_shape: routeShape,
        edge_overlap_count: edgeOverlap,
        edge_overlap_percentage: overlapPercentage
      };
      
      loopPaths.push(loopRoute);
      console.log(`      ✅ Added true loop: ${totalDistance.toFixed(2)}km, ${overlapPercentage.toFixed(1)}% overlap`);
    }
    
    return loopPaths;
  }

  private async createRouteGeometry(outboundPath: any[], returnPath: any[]): Promise<string> {
    const allEdges = [
      ...outboundPath.filter(row => row.edge !== -1).map(row => row.edge),
      ...returnPath.filter(row => row.edge !== -1).map(row => row.edge)
    ];

    const geometryResult = await this.client.query(`
      SELECT ST_AsGeoJSON(ST_Collect(ST_Transform(the_geom, 4326))) as route_geometry
      FROM ${this.schema}.ways_noded
      WHERE id = ANY($1)
    `, [allEdges]);

    return geometryResult.rows[0]?.route_geometry || '{}';
  }

  async exportToGeoJSON(loops: TrueLoopRoute[]): Promise<string> {
    const features = loops.map(loop => ({
      type: 'Feature',
      properties: {
        anchor_node: loop.anchor_node,
        dest_node: loop.dest_node,
        outbound_distance_km: loop.outbound_distance,
        return_distance_km: loop.return_distance,
        total_distance_km: loop.total_distance,
        path_id: loop.path_id,
        connection_type: loop.connection_type,
        edge_overlap_count: loop.edge_overlap_count,
        edge_overlap_percentage: loop.edge_overlap_percentage
      },
      geometry: JSON.parse(loop.route_shape)
    }));

    const geojson = {
      type: 'FeatureCollection',
      features: features
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `test-output/fixed-true-loops-${this.schema}-${timestamp}.geojson`;
    
    await fs.promises.mkdir('test-output', { recursive: true });
    await fs.promises.writeFile(filename, JSON.stringify(geojson, null, 2));
    
    return filename;
  }
}

// Main execution
async function main() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('Usage: npx ts-node fixed-true-loop-finder.ts <schema>');
    process.exit(1);
  }

  const finder = new FixedTrueLoopFinder(schema);
  
  try {
    await finder.connect();
    const loops = await finder.findTrueLoops();
    
    if (loops.length === 0) {
      console.log('❌ No true loops found');
      return;
    }
    
    console.log(`✅ Generated ${loops.length} true loop candidates`);
    
    const filename = await finder.exportToGeoJSON(loops);
    console.log(`✅ Exported ${loops.length} true loops to ${filename}`);
    console.log(`🎯 Found ${loops.length} true loops!`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await finder.disconnect();
  }
}

if (require.main === module) {
  main();
}
