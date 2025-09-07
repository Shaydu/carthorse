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

class TrueLoopFinderAdapted {
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
   * Find true loops using the adapted 20250827-big-loops approach
   * True loops: start and end at same node, minimal edge overlap
   */
  async findTrueLoops(): Promise<TrueLoopRoute[]> {
    console.log(`🔍 Finding true loops using adapted 20250827-big-loops approach`);
    
    // Get high-degree nodes as potential route anchors
    const anchorNodes = await this.client.query(`
      SELECT rn.id as node_id, 
             (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = rn.id OR target = rn.id) as connection_count,
             rn.x as lon, rn.y as lat
      FROM ${this.schema}.ways_noded_vertices_pgr rn
      WHERE (SELECT COUNT(*) FROM ${this.schema}.ways_noded WHERE source = rn.id OR target = rn.id) >= 3
      ORDER BY connection_count DESC
      LIMIT 20
    `);
    
    console.log(`🔍 Found ${anchorNodes.rows.length} anchor nodes for true loop discovery`);
    
    const trueLoops: TrueLoopRoute[] = [];
    
    for (const anchor of anchorNodes.rows.slice(0, 10)) {
      console.log(`🔍 Exploring true loops from anchor node ${anchor.node_id} (${anchor.connection_count} connections)`);
      
      // Find potential true loop paths from this anchor
      const loopPaths = await this.findTrueLoopPaths(
        anchor.node_id,
        20 // 20km target distance
      );
      
      trueLoops.push(...loopPaths);
    }
    
    console.log(`✅ Generated ${trueLoops.length} true loop candidates`);
    return trueLoops;
  }

  /**
   * Find potential true loop paths from an anchor node
   * Adapted from 20250827-big-loops findLargeLoopPaths method
   */
  private async findTrueLoopPaths(
    anchorNode: number,
    targetDistance: number
  ): Promise<TrueLoopRoute[]> {
    console.log(`🔍 Finding true loop paths from anchor node ${anchorNode} for ${targetDistance}km target`);
    
    // Find nodes reachable within target distance, including nearby nodes within 100m
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
      LIMIT 15
    `, [anchorNode, targetDistance]);
    
    console.log(`🔍 Found ${reachableNodes.rows.length} reachable nodes (including nearby nodes within 100m)`);
    
    const loopPaths: TrueLoopRoute[] = [];
    
    for (const destNode of reachableNodes.rows.slice(0, 8)) {
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

      // Get outbound edges
      const outboundEdges = outboundPaths.rows
        .filter(row => row.edge !== -1)
        .map(row => row.edge);

      // Try to find return paths using K-Shortest Paths
      const returnPaths = await this.client.query(`
        SELECT seq, node, edge, cost, agg_cost, path_id
        FROM pgr_ksp(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.schema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint, $2::bigint, 5, false, false
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
      returnPaths.rows.forEach(row => {
        if (!returnPathGroups.has(row.path_id)) {
          returnPathGroups.set(row.path_id, []);
        }
        returnPathGroups.get(row.path_id)!.push(row);
      });

      // Find the best return path with minimal edge overlap
      let bestReturnPath: any[] | null = null;
      let minEdgeOverlap = Infinity;

      for (const [pathId, pathRows] of returnPathGroups) {
        const returnEdges = pathRows.map(row => row.edge);
        const returnDistance = pathRows[pathRows.length - 1].agg_cost;
        
        // Calculate edge overlap
        const overlappingEdges = outboundEdges.filter(edge => returnEdges.includes(edge));
        const edgeOverlap = overlappingEdges.length;
        
        console.log(`      🔄 Return path ${pathId}: ${returnDistance.toFixed(2)}km, ${edgeOverlap} overlapping edges`);
        
        if (edgeOverlap < minEdgeOverlap) {
          minEdgeOverlap = edgeOverlap;
          bestReturnPath = pathRows;
        }
      }

      if (!bestReturnPath) {
        console.log(`      ❌ No valid return path found`);
        continue;
      }

      const returnDistance = bestReturnPath[bestReturnPath.length - 1].agg_cost;
      const totalDistance = outboundDistance + returnDistance;
      const returnEdges = bestReturnPath.map(row => row.edge);
      const overlapPercentage = (minEdgeOverlap / Math.max(outboundEdges.length, returnEdges.length)) * 100;

      console.log(`      ✅ Found true loop: ${totalDistance.toFixed(2)}km total (${outboundDistance.toFixed(2)}km out + ${returnDistance.toFixed(2)}km back)`);
      console.log(`      📊 Edge overlap: ${minEdgeOverlap} edges (${overlapPercentage.toFixed(1)}%)`);

      // Only accept loops with minimal edge overlap (true loops)
      if (overlapPercentage > 20) {
        console.log(`      ❌ Too much edge overlap: ${overlapPercentage.toFixed(1)}%`);
        continue;
      }

      // Create route shape from outbound and return paths
      const routeShape = await this.createRouteShape(outboundPaths.rows, bestReturnPath);

      const trueLoop: TrueLoopRoute = {
        anchor_node: anchorNode,
        dest_node: destNode.node_id,
        outbound_distance: outboundDistance,
        return_distance: returnDistance,
        total_distance: totalDistance,
        path_id: 1, // Single path for this loop
        connection_type: destNode.connection_type,
        route_shape: routeShape,
        edge_overlap_count: minEdgeOverlap,
        edge_overlap_percentage: overlapPercentage
      };

      loopPaths.push(trueLoop);
      console.log(`      ✅ Added true loop: ${totalDistance.toFixed(2)}km, ${overlapPercentage.toFixed(1)}% overlap`);
    }

    return loopPaths;
  }

  /**
   * Create route shape from outbound and return paths
   */
  private async createRouteShape(outboundPath: any[], returnPath: any[]): Promise<string> {
    try {
      // Get geometries for all edges in the route
      const allEdges = [
        ...outboundPath.filter(row => row.edge !== -1).map(row => row.edge),
        ...returnPath.filter(row => row.edge !== -1).map(row => row.edge)
      ];

      const edgeGeometries = await this.client.query(`
        SELECT ST_AsGeoJSON(the_geom) as geom
        FROM ${this.schema}.ways_noded
        WHERE id = ANY($1)
        ORDER BY id
      `, [allEdges]);

      if (edgeGeometries.rows.length === 0) {
        return '';
      }

      // Create a combined LineString
      const geometries = edgeGeometries.rows.map(row => row.geom);
      const combinedGeom = await this.client.query(`
        SELECT ST_AsGeoJSON(ST_LineMerge(ST_Collect(ST_GeomFromGeoJSON(geom)))) as combined_geom
        FROM unnest($1::text[]) as geom
      `, [geometries]);

      return combinedGeom.rows[0]?.combined_geom || '';
    } catch (error) {
      console.error('Error creating route shape:', error);
      return '';
    }
  }

  /**
   * Export true loops to GeoJSON
   */
  async exportToGeoJSON(trueLoops: TrueLoopRoute[]): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `true-loops-${this.schema}-${timestamp}.geojson`;
    const filepath = path.join('test-output', filename);

    const features = trueLoops.map((loop, index) => ({
      type: 'Feature',
      properties: {
        id: index + 1,
        anchor_node: loop.anchor_node,
        dest_node: loop.dest_node,
        outbound_distance_km: parseFloat(loop.outbound_distance.toFixed(2)),
        return_distance_km: parseFloat(loop.return_distance.toFixed(2)),
        total_distance_km: parseFloat(loop.total_distance.toFixed(2)),
        connection_type: loop.connection_type,
        edge_overlap_count: loop.edge_overlap_count,
        edge_overlap_percentage: parseFloat(loop.edge_overlap_percentage.toFixed(1)),
        route_name: `True Loop ${index + 1} (${loop.total_distance.toFixed(1)}km)`
      },
      geometry: loop.route_shape ? JSON.parse(loop.route_shape) : null
    }));

    const geojson = {
      type: 'FeatureCollection',
      features: features
    };

    // Ensure test-output directory exists
    if (!fs.existsSync('test-output')) {
      fs.mkdirSync('test-output');
    }

    fs.writeFileSync(filepath, JSON.stringify(geojson, null, 2));
    console.log(`✅ Exported ${trueLoops.length} true loops to ${filepath}`);
  }
}

// Main execution
async function main() {
  const schema = process.argv[2];
  if (!schema) {
    console.error('Usage: npx ts-node true-loop-finder-adapted.ts <schema>');
    process.exit(1);
  }

  const finder = new TrueLoopFinderAdapted(schema);
  
  try {
    await finder.connect();
    console.log(`🔍 Finding true loops in schema: ${schema}`);
    
    const trueLoops = await finder.findTrueLoops();
    
    if (trueLoops.length > 0) {
      await finder.exportToGeoJSON(trueLoops);
      console.log(`🎯 Found ${trueLoops.length} true loops!`);
    } else {
      console.log('❌ No true loops found');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await finder.disconnect();
  }
}

if (require.main === module) {
  main();
}
