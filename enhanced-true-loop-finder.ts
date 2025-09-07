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

class EnhancedTrueLoopFinder {
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
   * Find true loops using enhanced approach for larger loops
   * Key improvements:
   * - Increased target distance to 40km
   * - Expanded node selection range (0.2-0.8 of target)
   * - Increased node limit to 25
   * - Relaxed edge overlap to 30%
   * - More outbound path exploration
   */
  async findTrueLoops(): Promise<TrueLoopRoute[]> {
    console.log(`🔍 Finding enhanced true loops in schema: ${this.schema}`);
    console.log(`🔍 Using enhanced approach for larger loops`);
    
    // Find high-degree anchor nodes (3+ connections)
    const anchorNodes = await this.client.query(`
      SELECT id, 
             (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) as connection_count
      FROM ${this.schema}.ways_noded_vertices_pgr
      WHERE (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 3
      ORDER BY connection_count DESC
      LIMIT 25
    `);
    
    console.log(`🔍 Found ${anchorNodes.rows.length} anchor nodes for enhanced true loop discovery`);
    
    const allLoops: TrueLoopRoute[] = [];
    const targetDistance = 40; // Increased from 20km to 40km
    
    for (const anchorNode of anchorNodes.rows) {
      console.log(`🔍 Exploring enhanced true loops from anchor node ${anchorNode.id} (${anchorNode.connection_count} connections)`);
      
      const loops = await this.findEnhancedTrueLoopPaths(anchorNode.id, targetDistance);
      allLoops.push(...loops);
      
      // Stop if we have enough high-quality loops
      if (allLoops.length >= 50) {
        console.log(`🔍 Found ${allLoops.length} loops, stopping search`);
        break;
      }
    }
    
    // Sort by total distance descending
    allLoops.sort((a, b) => b.total_distance - a.total_distance);
    
    console.log(`✅ Generated ${allLoops.length} enhanced true loop candidates`);
    return allLoops;
  }

  /**
   * Enhanced true loop path finding with larger target distances
   */
  private async findEnhancedTrueLoopPaths(
    anchorNode: number,
    targetDistance: number
  ): Promise<TrueLoopRoute[]> {
    console.log(`🔍 Finding enhanced true loop paths from anchor node ${anchorNode} for ${targetDistance}km target`);
    
    // Enhanced node selection with wider range and more nodes
    const reachableNodes = await this.client.query(`
      WITH direct_reachable AS (
        SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
        FROM pgr_dijkstra(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.schema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint,
          (SELECT array_agg(id) FROM ${this.schema}.ways_noded_vertices_pgr WHERE (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 2),
          false
        )
        WHERE agg_cost BETWEEN $2 * 0.2 AND $2 * 0.8  -- Expanded range from 0.3-0.7 to 0.2-0.8
        AND end_vid != $1
      ),
      nearby_nodes AS (
        SELECT DISTINCT rn2.id as node_id, 
               ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) as distance_meters
        FROM ${this.schema}.ways_noded_vertices_pgr rn1
        JOIN ${this.schema}.ways_noded_vertices_pgr rn2 ON rn2.id != rn1.id
        WHERE rn1.id = $1
        AND (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = rn2.id OR target = rn2.id) >= 2
        AND ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) <= 150  -- Increased from 100m to 150m
        AND rn2.id != $1
      )
      SELECT node_id, distance_km, 'direct' as connection_type
      FROM direct_reachable
      UNION ALL
      SELECT node_id, distance_meters/1000.0 as distance_km, 'nearby' as connection_type
      FROM nearby_nodes
      ORDER BY distance_km DESC
      LIMIT 25  -- Increased from 15 to 25
    `, [anchorNode, targetDistance]);
    
    console.log(`🔍 Found ${reachableNodes.rows.length} reachable nodes (enhanced selection)`);
    
    const loopPaths: TrueLoopRoute[] = [];
    
    // Explore more destination nodes
    for (const destNode of reachableNodes.rows.slice(0, 12)) {  // Increased from 8 to 12
      console.log(`🔍 Exploring enhanced true loop from ${anchorNode} → ${destNode.node_id} (${destNode.distance_km.toFixed(1)}km outbound, ${destNode.connection_type} connection)`);
      
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
      
      // Skip if outbound distance is too short (lowered threshold for longer loops)
      if (outboundDistance < 8) {  // Lowered from 5km to 8km for longer loops
        console.log(`      ❌ Outbound distance too short: ${outboundDistance.toFixed(2)}km`);
        continue;
      }
      
      const outboundEdges = outboundPaths.rows
        .filter(row => row.edge !== -1)
        .map(row => row.edge);
      
      // Get return paths using K-Shortest Paths for more alternatives
      const returnPaths = await this.client.query(`
        SELECT seq, node, edge, cost, agg_cost, path_id
        FROM pgr_ksp(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.schema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint, $2::bigint, 8, false, false  -- Increased from 5 to 8 paths
        )
        WHERE edge != -1
        ORDER BY path_id, agg_cost ASC
      `, [destNode.node_id, anchorNode]);
      
      if (returnPaths.rows.length === 0) {
        console.log(`      ❌ No return paths found`);
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
        
        console.log(`      🔄 Return path ${pathId}: ${returnDistance.toFixed(2)}km, ${edgeOverlap} overlapping edges`);
        
        if (edgeOverlap < minEdgeOverlap) {
          minEdgeOverlap = edgeOverlap;
          bestReturnPath = pathRows;
          bestReturnDistance = returnDistance;
        }
      }
      
      if (!bestReturnPath) {
        console.log(`      ❌ No valid return path found`);
        continue;
      }
      
      const totalDistance = outboundDistance + bestReturnDistance;
      const overlapPercentage = (minEdgeOverlap / Math.max(outboundEdges.length, bestReturnPath.filter(row => row.edge !== -1).length)) * 100;
      
      console.log(`      ✅ Found enhanced true loop: ${totalDistance.toFixed(2)}km total (${outboundDistance.toFixed(2)}km out + ${bestReturnDistance.toFixed(2)}km back)`);
      console.log(`      📊 Edge overlap: ${minEdgeOverlap} edges (${overlapPercentage.toFixed(1)}%)`);
      
      // Relaxed edge overlap threshold from 20% to 30%
      if (overlapPercentage > 30) {
        console.log(`      ❌ Too much edge overlap: ${overlapPercentage.toFixed(1)}%`);
        continue;
      }
      
      // Create route geometry
      const routeShape = await this.createRouteGeometry(outboundPaths.rows, bestReturnPath);
      
      const loopRoute: TrueLoopRoute = {
        anchor_node: anchorNode,
        dest_node: destNode.node_id,
        outbound_distance: outboundDistance,
        return_distance: bestReturnDistance,
        total_distance: totalDistance,
        path_id: 1,
        connection_type: destNode.connection_type,
        route_shape: routeShape,
        edge_overlap_count: minEdgeOverlap,
        edge_overlap_percentage: overlapPercentage
      };
      
      loopPaths.push(loopRoute);
      console.log(`      ✅ Added enhanced true loop: ${totalDistance.toFixed(2)}km, ${overlapPercentage.toFixed(1)}% overlap`);
    }
    
    return loopPaths;
  }

  /**
   * Create route geometry from path segments
   */
  private async createRouteGeometry(outboundPath: any[], returnPath: any[]): Promise<string> {
    const outboundEdges = outboundPath
      .filter(row => row.edge !== -1)
      .map(row => row.edge);
    
    const returnEdges = returnPath
      .filter(row => row.edge !== -1)
      .map(row => row.edge);
    
    const allEdges = [...outboundEdges, ...returnEdges];
    
    if (allEdges.length === 0) {
      return '';
    }
    
    const geometryResult = await this.client.query(`
      SELECT ST_AsGeoJSON(ST_Collect(ST_Transform(the_geom, 4326))) as route_geometry
      FROM ${this.schema}.ways_noded
      WHERE id = ANY($1)
    `, [allEdges]);
    
    return geometryResult.rows[0]?.route_geometry || '';
  }

  /**
   * Export true loops to GeoJSON
   */
  async exportToGeoJSON(loops: TrueLoopRoute[]): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `enhanced-true-loops-${this.schema}-${timestamp}.geojson`;
    const filepath = path.join('test-output', filename);
    
    const features = loops.map((loop, index) => ({
      type: 'Feature',
      properties: {
        id: index + 1,
        anchor_node: loop.anchor_node.toString(),
        dest_node: loop.dest_node.toString(),
        outbound_distance_km: loop.outbound_distance,
        return_distance_km: loop.return_distance,
        total_distance_km: loop.total_distance,
        connection_type: loop.connection_type,
        edge_overlap_count: loop.edge_overlap_count,
        edge_overlap_percentage: loop.edge_overlap_percentage,
        route_name: `Enhanced True Loop ${index + 1} (${loop.total_distance.toFixed(1)}km)`
      },
      geometry: loop.route_shape ? JSON.parse(loop.route_shape) : null
    }));
    
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };
    
    fs.writeFileSync(filepath, JSON.stringify(geojson, null, 2));
    console.log(`✅ Exported ${loops.length} enhanced true loops to ${filepath}`);
    
    return filepath;
  }
}

// Main execution
async function main() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('Usage: npx ts-node enhanced-true-loop-finder.ts <schema>');
    process.exit(1);
  }
  
  const finder = new EnhancedTrueLoopFinder(schema);
  
  try {
    await finder.connect();
    const loops = await finder.findTrueLoops();
    await finder.exportToGeoJSON(loops);
    console.log(`🎯 Found ${loops.length} enhanced true loops!`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await finder.disconnect();
  }
}

if (require.main === module) {
  main();
}
