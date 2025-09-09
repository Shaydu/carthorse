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
  autoDiscoverEndpoints?: boolean; // New: automatically discover degree-1 endpoints
  maxRoutesToKeep?: number; // New: maximum number of longest routes to keep
}

export class LollipopRouteGeneratorServiceAutoDiscovery {
  private pgClient: Pool;
  private config: LollipopRouteGeneratorConfig;

  constructor(pgClient: Pool, config: LollipopRouteGeneratorConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  async generateLollipopRoutes(): Promise<LollipopRoute[]> {
    console.log('🍭 Starting AUTO-DISCOVERY lollipop route generation...');
    console.log(`   Target distance: ${this.config.targetDistance}km`);
    console.log(`   Auto-discover endpoints: ${this.config.autoDiscoverEndpoints || false}`);
    console.log(`   Strategy: Find degree-1 endpoints on network edges, generate longest possible routes`);

    // Find anchor nodes - either auto-discovered degree-1 endpoints or high-degree nodes
    let anchorNodes;
    if (this.config.autoDiscoverEndpoints) {
      // Auto-discover degree-1 endpoints on network edges
      anchorNodes = await this.discoverDegree1Endpoints();
      console.log(`   Auto-discovered ${anchorNodes.rows.length} degree-1 endpoints as anchors`);
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
      console.log(`   Found ${anchorNodes.rows.length} high-degree anchor nodes`);
    }
    
    if (anchorNodes.rows.length === 0) {
      console.log('❌ No anchor nodes found');
      return [];
    }

    const allRoutes: LollipopRoute[] = [];
    let maxRouteLength = 0;

    for (const anchorNodeRow of anchorNodes.rows) {
      const anchorNode = anchorNodeRow.id;
      console.log(`\n🔍 Exploring anchor node ${anchorNode} (${anchorNodeRow.connection_count || 'degree-1'} connections)`);
      
      const reachableNodes = await this.findReachableNodes(anchorNode, this.config.targetDistance);
      console.log(`   Found ${reachableNodes.rows.length} reachable nodes`);

      const loopPaths: LollipopRoute[] = [];
      
      // Explore ALL destinations (no filtering during discovery)
      const destinations = reachableNodes.rows.slice(0, this.config.maxDestinationExploration);
      
      for (const destNode of destinations) {
        console.log(`     Exploring destination ${destNode.node} (${destNode.connection_type})`);
        
        // Get outbound path
        const outboundPaths = await this.pgClient.query(`
          SELECT seq, node, edge, cost, agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
            $1::bigint, $2::bigint, false
          )
          WHERE edge IS NOT NULL
        `, [anchorNode, destNode.node]);

        if (outboundPaths.rows.length === 0) {
          console.log(`       No outbound path found`);
          continue;
        }

        const outboundDistance = outboundPaths.rows[outboundPaths.rows.length - 1].agg_cost;
        
        if (outboundDistance < this.config.minOutboundDistance) {
          console.log(`       Outbound distance too short: ${outboundDistance.toFixed(2)}km`);
          continue;
        }

        // Get return path using K-shortest paths
        const returnPaths = await this.pgClient.query(`
          SELECT seq, path_id, node, edge, cost, agg_cost
          FROM pgr_ksp(
            'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
            $1::bigint, $2::bigint, $3, false
          )
          WHERE edge IS NOT NULL
        `, [destNode.node, anchorNode, this.config.kspPaths]);

        if (returnPaths.rows.length === 0) {
          console.log(`       No return path found`);
          continue;
        }

        // Group return paths by path_id
        const returnPathsByPathId = new Map<number, any[]>();
        for (const path of returnPaths.rows) {
          if (!returnPathsByPathId.has(path.path_id)) {
            returnPathsByPathId.set(path.path_id, []);
          }
          returnPathsByPathId.get(path.path_id)!.push(path);
        }

        // Create lollipop routes for each return path
        for (const [pathId, returnPath] of returnPathsByPathId) {
          const returnDistance = returnPath[returnPath.length - 1].agg_cost;
          const totalDistance = outboundDistance + returnDistance;
          
          // Check if total distance is within target range
          const distanceRatio = totalDistance / this.config.targetDistance;
          if (distanceRatio < this.config.distanceRangeMin || distanceRatio > this.config.distanceRangeMax) {
            console.log(`       Distance ratio out of range: ${distanceRatio.toFixed(2)} (target: ${this.config.distanceRangeMin}-${this.config.distanceRangeMax})`);
            continue;
          }

          // Calculate edge overlap
          const outboundEdges = new Set(outboundPaths.rows.map(p => p.edge));
          const returnEdges = new Set(returnPath.map(p => p.edge));
          const overlapEdges = new Set([...outboundEdges].filter(edge => returnEdges.has(edge)));
          const edgeOverlapCount = overlapEdges.size;
          const edgeOverlapPercentage = (edgeOverlapCount / Math.max(outboundEdges.size, returnEdges.size)) * 100;

          // Always keep longer routes, even with high overlap
          if (totalDistance > maxRouteLength) {
            maxRouteLength = totalDistance;
            console.log(`       🏆 NEW MAX ROUTE LENGTH: ${totalDistance.toFixed(2)}km`);
          }

          // Generate geometry for the route
          const allEdgeIds = [...outboundPaths.rows.map(p => p.edge), ...returnPath.map(p => p.edge)];
          const geometryResult = await this.pgClient.query(`
            SELECT ST_AsText(ST_LineMerge(ST_Collect(
              CASE 
                WHEN source = $1 THEN the_geom 
                ELSE ST_Reverse(the_geom) 
              END
            ))) as route_geom
            FROM ${this.config.stagingSchema}.ways_noded 
            WHERE id = ANY($2::int[])
            GROUP BY ways_noded.id, ways_noded.the_geom, ways_noded.source
            ORDER BY array_position($2::int[], id)
          `, [anchorNode, allEdgeIds]);

          const routeGeometry = geometryResult.rows.length > 0 && geometryResult.rows[0].route_geom 
            ? geometryResult.rows[0].route_geom 
            : null;

          const route: LollipopRoute = {
            anchor_node: anchorNode,
            dest_node: destNode.node,
            outbound_distance: outboundDistance,
            return_distance: returnDistance,
            total_distance: totalDistance,
            path_id: pathId,
            connection_type: destNode.connection_type,
            route_shape: 'lollipop',
            edge_overlap_count: edgeOverlapCount,
            edge_overlap_percentage: edgeOverlapPercentage,
            route_geometry: routeGeometry || '',
            edge_ids: allEdgeIds
          };

          loopPaths.push(route);
          console.log(`       ✅ Route: ${totalDistance.toFixed(2)}km total (${outboundDistance.toFixed(2)}km out, ${returnDistance.toFixed(2)}km back, ${edgeOverlapPercentage.toFixed(1)}% overlap)`);
        }
      }

      allRoutes.push(...loopPaths);
      console.log(`   Generated ${loopPaths.length} routes from anchor ${anchorNode}`);
    }

    console.log(`\n📊 ROUTE GENERATION SUMMARY:`);
    console.log(`   Total routes found: ${allRoutes.length}`);
    console.log(`   Maximum route length: ${maxRouteLength.toFixed(2)}km`);

    // Sort by total distance (longest first) and keep only the top routes
    const sortedRoutes = allRoutes.sort((a, b) => b.total_distance - a.total_distance);
    const maxRoutes = this.config.maxRoutesToKeep || 7;
    const topRoutes = sortedRoutes.slice(0, maxRoutes);

    console.log(`   Keeping top ${topRoutes.length} longest routes:`);
    topRoutes.forEach((route, index) => {
      console.log(`     ${index + 1}. ${route.total_distance.toFixed(2)}km (anchor: ${route.anchor_node}, dest: ${route.dest_node}, overlap: ${route.edge_overlap_percentage.toFixed(1)}%)`);
    });

    return topRoutes;
  }

  /**
   * Auto-discover degree-1 endpoints from WEST and EAST boundaries + original custom endpoints
   */
  private async discoverDegree1Endpoints(): Promise<any> {
    console.log('🔍 Auto-discovering degree-1 endpoints from WEST and EAST boundaries + original custom endpoints...');
    
    // First, get the bounding box of the network
    const bboxResult = await this.pgClient.query(`
      SELECT 
        ST_XMin(ST_Extent(the_geom)) as min_lon,
        ST_YMin(ST_Extent(the_geom)) as min_lat,
        ST_XMax(ST_Extent(the_geom)) as max_lon,
        ST_YMax(ST_Extent(the_geom)) as max_lat
      FROM ${this.config.stagingSchema}.ways_noded
    `);
    
    const bbox = bboxResult.rows[0];
    const westBoundary = bbox.min_lon;
    const eastBoundary = bbox.max_lon;
    const centerLon = (bbox.min_lon + bbox.max_lon) / 2;
    const centerLat = (bbox.min_lat + bbox.max_lat) / 2;
    
    console.log(`   Network bbox: (${bbox.min_lon.toFixed(6)}, ${bbox.min_lat.toFixed(6)}) to (${bbox.max_lon.toFixed(6)}, ${bbox.max_lat.toFixed(6)})`);
    console.log(`   West boundary: ${westBoundary.toFixed(6)}, East boundary: ${eastBoundary.toFixed(6)}`);
    console.log(`   Network center: (${centerLon.toFixed(6)}, ${centerLat.toFixed(6)})`);
    
    // Find degree-1 endpoints from WEST and EAST boundaries, prioritizing those farthest from center
    const boundaryEndpoints = await this.pgClient.query(`
      SELECT 
        v.id,
        v.the_geom,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        1 as connection_count,
        -- Distance from network center (using simple lat/lng calculation)
        SQRT(
          POWER((ST_X(v.the_geom) - $1) * 111 * COS(RADIANS(ST_Y(v.the_geom))), 2) +
          POWER((ST_Y(v.the_geom) - $2) * 111, 2)
        ) as distance_from_center_km,
        -- Distance to west boundary
        ABS(ST_X(v.the_geom) - $3) * 111 as distance_to_west_km,
        -- Distance to east boundary  
        ABS(ST_X(v.the_geom) - $4) * 111 as distance_to_east_km,
        -- Closest boundary distance
        LEAST(
          ABS(ST_X(v.the_geom) - $3),  -- distance to west boundary
          ABS(ST_X(v.the_geom) - $4)   -- distance to east boundary
        ) * 111 as distance_to_closest_boundary_km,
        -- Boundary side
        CASE 
          WHEN ABS(ST_X(v.the_geom) - $3) < ABS(ST_X(v.the_geom) - $4) THEN 'WEST'
          ELSE 'EAST'
        END as boundary_side,
        'boundary' as endpoint_type
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      WHERE (
        SELECT COUNT(*) 
        FROM ${this.config.stagingSchema}.ways_noded w 
        WHERE w.source = v.id OR w.target = v.id
      ) = 1
      ORDER BY 
        distance_from_center_km DESC,  -- Prioritize endpoints farthest from center
        distance_to_closest_boundary_km ASC  -- Then those closest to boundaries
      LIMIT 8
    `, [centerLon, centerLat, westBoundary, eastBoundary]);

    // Add original custom endpoints using coordinates from earlier schema
    // These coordinates are from carthorse_1757379226996 where the custom endpoints were defined
    const customEndpointCoordinates = [
      { id: 2, lat: 40.004505, lng: -105.316515 },
      { id: 24, lat: 39.960585, lng: -105.242580 },
      { id: 51, lat: 39.964770, lng: -105.253785 },
      { id: 194, lat: 39.995370, lng: -105.264765 }
    ];

    const customEndpoints = await this.pgClient.query(`
      SELECT 
        v.id,
        v.the_geom,
        ST_X(v.the_geom) as lng,
        ST_Y(v.the_geom) as lat,
        (
          SELECT COUNT(*) 
          FROM ${this.config.stagingSchema}.ways_noded w 
          WHERE w.source = v.id OR w.target = v.id
        ) as connection_count,
        -- Distance from network center
        SQRT(
          POWER((ST_X(v.the_geom) - $1) * 111 * COS(RADIANS(ST_Y(v.the_geom))), 2) +
          POWER((ST_Y(v.the_geom) - $2) * 111, 2)
        ) as distance_from_center_km,
        -- Distance to west boundary
        ABS(ST_X(v.the_geom) - $3) * 111 as distance_to_west_km,
        -- Distance to east boundary  
        ABS(ST_X(v.the_geom) - $4) * 111 as distance_to_east_km,
        -- Closest boundary distance
        LEAST(
          ABS(ST_X(v.the_geom) - $3),  -- distance to west boundary
          ABS(ST_X(v.the_geom) - $4)   -- distance to east boundary
        ) * 111 as distance_to_closest_boundary_km,
        -- Boundary side
        CASE 
          WHEN ABS(ST_X(v.the_geom) - $3) < ABS(ST_X(v.the_geom) - $4) THEN 'WEST'
          ELSE 'EAST'
        END as boundary_side,
        'custom' as endpoint_type
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr v
      WHERE (
        (ST_Y(v.the_geom) BETWEEN $5 - 0.001 AND $5 + 0.001 AND ST_X(v.the_geom) BETWEEN $6 - 0.001 AND $6 + 0.001) OR
        (ST_Y(v.the_geom) BETWEEN $7 - 0.001 AND $7 + 0.001 AND ST_X(v.the_geom) BETWEEN $8 - 0.001 AND $8 + 0.001) OR
        (ST_Y(v.the_geom) BETWEEN $9 - 0.001 AND $9 + 0.001 AND ST_X(v.the_geom) BETWEEN $10 - 0.001 AND $10 + 0.001) OR
        (ST_Y(v.the_geom) BETWEEN $11 - 0.001 AND $11 + 0.001 AND ST_X(v.the_geom) BETWEEN $12 - 0.001 AND $12 + 0.001)
      )
    `, [
      centerLon, centerLat, westBoundary, eastBoundary,
      customEndpointCoordinates[0].lat, customEndpointCoordinates[0].lng,  // Node 2
      customEndpointCoordinates[1].lat, customEndpointCoordinates[1].lng,  // Node 24
      customEndpointCoordinates[2].lat, customEndpointCoordinates[2].lng,  // Node 51
      customEndpointCoordinates[3].lat, customEndpointCoordinates[3].lng   // Node 194
    ]);

    // Combine both sets of endpoints
    const allEndpoints = [...boundaryEndpoints.rows, ...customEndpoints.rows];
    
    console.log(`   Found ${boundaryEndpoints.rows.length} boundary degree-1 endpoints:`);
    boundaryEndpoints.rows.forEach((endpoint, index) => {
      console.log(`     ${index + 1}. Node ${endpoint.id}: (${endpoint.lat.toFixed(6)}, ${endpoint.lng.toFixed(6)}) - ${endpoint.boundary_side} side, ${endpoint.distance_from_center_km.toFixed(2)}km from center, ${endpoint.distance_to_closest_boundary_km.toFixed(2)}km to boundary`);
    });

    console.log(`   Found ${customEndpoints.rows.length} original custom endpoints:`);
    customEndpoints.rows.forEach((endpoint, index) => {
      console.log(`     ${index + 1}. Node ${endpoint.id}: (${endpoint.lat.toFixed(6)}, ${endpoint.lng.toFixed(6)}) - ${endpoint.boundary_side} side, ${endpoint.connection_count} connections, ${endpoint.distance_from_center_km.toFixed(2)}km from center`);
    });

    console.log(`   Total endpoints: ${allEndpoints.length} (${boundaryEndpoints.rows.length} boundary + ${customEndpoints.rows.length} custom)`);

    return { rows: allEndpoints };
  }

  /**
   * Find nodes reachable from an anchor within target distance
   */
  private async findReachableNodes(anchorNode: number, targetDistance: number): Promise<any> {
    const reachableNodes = await this.pgClient.query(`
      SELECT 
        node,
        agg_cost as distance,
        CASE 
          WHEN (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = node OR target = node) = 1 THEN 'endpoint'
          WHEN (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = node OR target = node) = 2 THEN 'connector'
          ELSE 'intersection'
        END as connection_type
      FROM pgr_dijkstra(
        'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
        $1::bigint, 
        (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr), 
        false
      )
      WHERE node != $1 
        AND agg_cost <= $2
        AND agg_cost >= 1.0
      ORDER BY agg_cost DESC
      LIMIT ${this.config.maxReachableNodes}
    `, [anchorNode, targetDistance]);

    return reachableNodes;
  }

  /**
   * Save routes to database
   */
  async saveToDatabase(routes: LollipopRoute[]): Promise<void> {
    console.log(`💾 Saving ${routes.length} lollipop routes to database...`);
    
    try {
      // Drop and recreate the table to ensure clean schema
      await this.pgClient.query(`DROP TABLE IF EXISTS ${this.config.stagingSchema}.lollipop_routes`);
      
      await this.pgClient.query(`
        CREATE TABLE ${this.config.stagingSchema}.lollipop_routes (
          id SERIAL PRIMARY KEY,
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
          edge_ids INTEGER[] NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      for (const route of routes) {
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.lollipop_routes (
            anchor_node, dest_node, outbound_distance, return_distance, total_distance,
            path_id, connection_type, route_shape, edge_overlap_count, edge_overlap_percentage,
            route_geometry, edge_ids
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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

      console.log(`✅ Saved ${routes.length} lollipop routes to database`);
    } catch (error) {
      console.error('❌ Error saving lollipop routes to database:', error);
      throw error;
    }
  }

  /**
   * Export routes to GeoJSON
   */
  async exportToGeoJSON(routes: LollipopRoute[]): Promise<void> {
    console.log(`📤 Exporting ${routes.length} lollipop routes to GeoJSON...`);
    
    try {
      const geojson: any = {
        type: 'FeatureCollection',
        metadata: {
          generated_at: new Date().toISOString(),
          schema: this.config.stagingSchema,
          region: this.config.region,
          total_routes: routes.length,
          max_route_length: Math.max(...routes.map(r => r.total_distance)),
          strategy: 'auto-discovery-degree1-endpoints'
        },
        features: []
      };

      for (const route of routes) {
        // Generate actual geometry from edge IDs
        const geometryResult = await this.pgClient.query(`
          SELECT ST_AsGeoJSON(ST_LineMerge(ST_Collect(
            CASE 
              WHEN source = $1 THEN the_geom 
              ELSE ST_Reverse(the_geom) 
            END
          ))) as route_geom
          FROM ${this.config.stagingSchema}.ways_noded 
          WHERE id = ANY($2::int[])
          GROUP BY ways_noded.id, ways_noded.the_geom, ways_noded.source
          ORDER BY array_position($2::int[], id)
        `, [route.anchor_node, route.edge_ids]);

        let routeGeometry = null;
        if (geometryResult.rows.length > 0 && geometryResult.rows[0].route_geom) {
          try {
            routeGeometry = JSON.parse(geometryResult.rows[0].route_geom);
          } catch (e) {
            console.warn(`Warning: Could not parse geometry for route ${route.anchor_node}-${route.dest_node}`);
          }
        }

        const feature = {
          type: 'Feature',
          properties: {
            id: `${route.anchor_node}-${route.dest_node}-${route.path_id}`,
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
          geometry: routeGeometry || {
            type: 'MultiLineString',
            coordinates: [[[0, 0, 0], [0, 0, 0]]]
          }
        };

        geojson.features.push(feature);
      }

      const outputPath = this.config.outputPath || 'test-output';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `lollipop-routes-${this.config.stagingSchema}-${timestamp}.geojson`;
      const filepath = path.join(outputPath, filename);

      await fs.promises.writeFile(filepath, JSON.stringify(geojson, null, 2));
      console.log(`✅ Exported ${routes.length} lollipop routes to ${filepath}`);
    } catch (error) {
      console.error('❌ Error exporting lollipop routes to GeoJSON:', error);
      throw error;
    }
  }
}
