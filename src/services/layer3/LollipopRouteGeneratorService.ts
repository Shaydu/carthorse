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
}

export class LollipopRouteGeneratorService {
  private pgClient: Pool;
  private config: LollipopRouteGeneratorConfig;

  constructor(pgClient: Pool, config: LollipopRouteGeneratorConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Generate lollipop routes (true loops) using the exact working algorithm
   */
  async generateLollipopRoutes(): Promise<LollipopRoute[]> {
    console.log('🍭 Starting lollipop route generation...');
    console.log(`   Target distance: ${this.config.targetDistance}km`);
    console.log(`   Max anchor nodes: ${this.config.maxAnchorNodes}`);
    console.log(`   Edge overlap threshold: ${this.config.edgeOverlapThreshold}%`);

    // Find high-degree anchor nodes (3+ connections)
    const anchorNodes = await this.pgClient.query(`
      SELECT id, 
             (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) as connection_count
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) >= 3
      ORDER BY connection_count DESC
      LIMIT ${this.config.maxAnchorNodes}
    `);
    
    console.log(`   Found ${anchorNodes.rows.length} anchor nodes`);
    
    const allLoops: LollipopRoute[] = [];
    
    for (const anchorNode of anchorNodes.rows) {
      console.log(`   Processing anchor ${anchorNode.id} (${anchorNode.connection_count} connections)`);
      
      const loops = await this.findEnhancedTrueLoopPaths(anchorNode.id, this.config.targetDistance);
      allLoops.push(...loops);
      
      // Stop if we have enough high-quality loops
      if (allLoops.length >= 50) {
        console.log(`   Found ${allLoops.length} loops, stopping search`);
        break;
      }
    }
    
    // Sort by total distance descending
    allLoops.sort((a, b) => b.total_distance - a.total_distance);
    
    console.log(`✅ Generated ${allLoops.length} lollipop routes`);
    return allLoops;
  }

  /**
   * Enhanced true loop path finding with larger target distances
   */
  private async findEnhancedTrueLoopPaths(
    anchorNode: number,
    targetDistance: number
  ): Promise<LollipopRoute[]> {
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
        JOIN ${this.config.stagingSchema}.ways_noded_vertices_pgr rn2 ON rn2.id != rn1.id
        WHERE rn1.id = $1
        AND (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = rn2.id OR target = rn2.id) >= 2
        AND ST_Distance(ST_SetSRID(ST_MakePoint(rn1.x, rn1.y), 4326), ST_SetSRID(ST_MakePoint(rn2.x, rn2.y), 4326)) <= 100
        AND rn2.id != $1
      )
      SELECT node_id, distance_km, 'direct' as connection_type
      FROM direct_reachable
      UNION ALL
      SELECT node_id, distance_meters/1000.0 as distance_km, 'nearby' as connection_type
      FROM nearby_nodes
      ORDER BY distance_km DESC
      LIMIT ${this.config.maxReachableNodes}
    `, [anchorNode, targetDistance]);

    const loopPaths: LollipopRoute[] = [];
    
    // Explore more destinations per anchor (increased from 8 to 12)
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
      
      // Skip if outbound distance is too short (lowered threshold for longer loops)
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
      
      console.log(`       ✅ Found enhanced true loop: ${totalDistance.toFixed(2)}km total (${outboundDistance.toFixed(2)}km out + ${bestReturnDistance.toFixed(2)}km back)`);
      console.log(`       📊 Edge overlap: ${minEdgeOverlap} edges (${overlapPercentage.toFixed(1)}%)`);
      
      // Check for overlap with existing routes - keep the longer one
      const existingRouteIndex = loopPaths.findIndex(existing => 
        existing.anchor_node === anchorNode && 
        existing.dest_node === destNode.node_id
      );
      
      if (existingRouteIndex !== -1) {
        const existingRoute = loopPaths[existingRouteIndex];
        if (totalDistance > existingRoute.total_distance) {
          console.log(`       🔄 Replacing shorter route (${existingRoute.total_distance.toFixed(2)}km) with longer route (${totalDistance.toFixed(2)}km)`);
          // Remove the shorter route and continue to add the longer one
          loopPaths.splice(existingRouteIndex, 1);
        } else {
          console.log(`       ❌ Skipping shorter route (${totalDistance.toFixed(2)}km) - keeping existing (${existingRoute.total_distance.toFixed(2)}km)`);
          continue;
        }
      } else if (overlapPercentage > this.config.edgeOverlapThreshold) {
        console.log(`       ⚠️  High edge overlap: ${overlapPercentage.toFixed(1)}% (threshold: ${this.config.edgeOverlapThreshold}%)`);
        console.log(`       ✅ Keeping route anyway - prioritizing length over overlap`);
      }
      
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
      
      const loopRoute: LollipopRoute = {
        anchor_node: anchorNode,
        dest_node: destNode.node_id,
        outbound_distance: outboundDistance,
        return_distance: bestReturnDistance,
        total_distance: totalDistance,
        path_id: 1,
        connection_type: destNode.connection_type,
        route_shape: 'loop',
        edge_overlap_count: minEdgeOverlap,
        edge_overlap_percentage: overlapPercentage,
        route_geometry: routeShape,
        edge_ids: allEdgeIds
      };
      
      loopPaths.push(loopRoute);
      console.log(`       ✅ Added enhanced true loop: ${totalDistance.toFixed(2)}km, ${overlapPercentage.toFixed(1)}% overlap`);
    }
    
    return loopPaths;
  }

  /**
   * Create route geometry from outbound and return paths
   */
  private async createRouteGeometry(outboundPaths: any[], returnPaths: any[]): Promise<string> {
    const allEdges = [...outboundPaths.map(p => p.edge), ...returnPaths.map(p => p.edge)];
    
    const geometryResult = await this.pgClient.query(`
      SELECT ST_AsGeoJSON(ST_Collect(ST_Transform(the_geom, 4326))) as route_geometry
      FROM ${this.config.stagingSchema}.ways_noded
      WHERE id = ANY($1)
    `, [allEdges]);

    return geometryResult.rows[0]?.route_geometry || '{}';
  }

  /**
   * Export lollipop routes to GeoJSON
   */
  async exportToGeoJSON(routes: LollipopRoute[], metadata?: any): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `lollipop-routes-${this.config.stagingSchema}-${timestamp}.geojson`;
    const outputPath = this.config.outputPath || 'test-output';
    const filepath = path.join(outputPath, filename);

    // Ensure output directory exists
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const features = routes.map((route, index) => ({
      type: 'Feature',
      properties: {
        id: index + 1,
        anchor_node: route.anchor_node,
        dest_node: route.dest_node,
        outbound_distance: route.outbound_distance,
        return_distance: route.return_distance,
        total_distance: route.total_distance,
        path_id: route.path_id,
        connection_type: route.connection_type,
        route_shape: route.route_shape,
        edge_overlap_count: route.edge_overlap_count,
        edge_overlap_percentage: route.edge_overlap_percentage
      },
      geometry: JSON.parse(route.route_geometry)
    }));

    const geojson: any = {
      type: 'FeatureCollection',
      features: features
    };

    // Add metadata if provided
    if (metadata) {
      geojson.metadata = {
        ...metadata,
        total_routes: routes.length,
        max_distance_km: routes.length > 0 ? Math.max(...routes.map(r => r.total_distance)) : 0,
        average_distance_km: routes.length > 0 ? (routes.reduce((sum, r) => sum + r.total_distance, 0) / routes.length) : 0
      };
    }

    fs.writeFileSync(filepath, JSON.stringify(geojson, null, 2));
    console.log(`📁 Exported ${routes.length} lollipop routes to: ${filepath}`);
    
    return filepath;
  }

  /**
   * Save lollipop routes to database
   */
  async saveToDatabase(routes: LollipopRoute[]): Promise<void> {
    console.log(`💾 Saving ${routes.length} lollipop routes to database...`);

    // Create lollipop_routes table if it doesn't exist
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.lollipop_routes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        anchor_node INTEGER NOT NULL,
        dest_node INTEGER NOT NULL,
        outbound_distance REAL NOT NULL,
        return_distance REAL NOT NULL,
        total_distance REAL NOT NULL,
        path_id INTEGER NOT NULL,
        connection_type TEXT NOT NULL,
        route_shape TEXT NOT NULL,
        edge_overlap_count INTEGER NOT NULL,
        edge_overlap_percentage REAL NOT NULL,
        route_geometry GEOMETRY(MULTILINESTRINGZ, 4326),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert routes
    for (const route of routes) {
      await this.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.lollipop_routes (
          anchor_node, dest_node, outbound_distance, return_distance,
          total_distance, path_id, connection_type, route_shape,
          edge_overlap_count, edge_overlap_percentage, route_geometry
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ST_GeomFromGeoJSON($11))
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
        route.route_geometry
      ]);
    }

    console.log(`✅ Saved ${routes.length} lollipop routes to ${this.config.stagingSchema}.lollipop_routes`);
    
    // Also save to route_recommendations table for export compatibility
    await this.saveToRouteRecommendations(routes);
  }

  /**
   * Save lollipop routes to route_recommendations table for export compatibility
   */
  private async saveToRouteRecommendations(routes: LollipopRoute[]): Promise<void> {
    console.log(`💾 Saving ${routes.length} lollipop routes to route_recommendations table...`);

    // Create route_recommendations table if it doesn't exist
    await this.pgClient.query(`
      CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.route_recommendations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        route_uuid TEXT UNIQUE NOT NULL,
        region TEXT NOT NULL,
        input_length_km REAL CHECK(input_length_km > 0),
        input_elevation_gain REAL,
        recommended_length_km REAL CHECK(recommended_length_km > 0),
        recommended_elevation_gain REAL,
        route_shape TEXT,
        trail_count INTEGER,
        route_score REAL,
        similarity_score REAL CHECK(similarity_score >= 0 AND similarity_score <= 1),
        route_path JSONB,
        route_edges JSONB,
        route_name TEXT,
        route_geometry GEOMETRY(MULTILINESTRINGZ, 4326),
        route_geometry_geojson TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert routes into route_recommendations table
    for (const route of routes) {
      const routeUuid = `lollipop-${route.anchor_node}-${route.dest_node}-${route.path_id}`;
      const routeName = `Lollipop Route ${route.anchor_node}-${route.dest_node}`;
      
      // Get edge metadata for constituent trail analysis
      const edgeMetadata = await this.getEdgeMetadata(route.edge_ids);
      
      await this.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.route_recommendations (
          route_uuid, region, input_length_km, input_elevation_gain,
          recommended_length_km, recommended_elevation_gain, route_shape,
          trail_count, route_score, similarity_score, route_path, route_edges,
          route_name, route_geometry, route_geometry_geojson
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, ST_GeomFromGeoJSON($14), $15)
        ON CONFLICT (route_uuid) DO UPDATE SET
          recommended_length_km = EXCLUDED.recommended_length_km,
          recommended_elevation_gain = EXCLUDED.recommended_elevation_gain,
          route_score = EXCLUDED.route_score,
          similarity_score = EXCLUDED.similarity_score,
          route_path = EXCLUDED.route_path,
          route_edges = EXCLUDED.route_edges,
          route_name = EXCLUDED.route_name,
          route_geometry = EXCLUDED.route_geometry,
          route_geometry_geojson = EXCLUDED.route_geometry_geojson
      `, [
        routeUuid,
        this.config.region,
        route.total_distance, // input_length_km
        0, // input_elevation_gain (not available for lollipop routes)
        route.total_distance, // recommended_length_km
        0, // recommended_elevation_gain (not available for lollipop routes)
        route.route_shape,
        1, // trail_count (lollipop routes are single routes)
        1.0 - (route.edge_overlap_percentage / 100), // route_score (higher is better, lower overlap is better)
        1.0 - (route.edge_overlap_percentage / 100), // similarity_score
        JSON.stringify([]), // route_path (empty for lollipop routes)
        JSON.stringify(edgeMetadata), // route_edges (edge metadata for constituent analysis)
        routeName,
        route.route_geometry, // PostGIS geometry
        route.route_geometry // Original GeoJSON string
      ]);
    }

    console.log(`✅ Saved ${routes.length} lollipop routes to ${this.config.stagingSchema}.route_recommendations`);
  }

  /**
   * Get edge metadata for constituent trail analysis
   */
  private async getEdgeMetadata(edgeIds: number[]): Promise<any[]> {
    if (edgeIds.length === 0) {
      return [];
    }

    try {
      const result = await this.pgClient.query(`
        SELECT 
          wn.id,
          wn.original_trail_uuid as app_uuid,
          wn.original_trail_name as trail_name,
          wn.length_km,
          wn.elevation_gain,
          wn.elevation_loss,
          wn.difficulty,
          wn.surface,
          wn.trail_type,
          t.min_elevation,
          t.max_elevation,
          t.avg_elevation
        FROM ${this.config.stagingSchema}.ways_noded wn
        LEFT JOIN ${this.config.stagingSchema}.trails t ON wn.original_trail_uuid = t.app_uuid
        WHERE wn.id = ANY($1::integer[])
        ORDER BY wn.id
      `, [edgeIds]);

      return result.rows;
    } catch (error) {
      console.warn(`⚠️ Failed to get edge metadata for edge IDs ${edgeIds.join(', ')}:`, error);
      return [];
    }
  }
}