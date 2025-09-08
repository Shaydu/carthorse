import { Pool } from 'pg';
import { LollipopRouteGeneratorService } from './src/services/layer3/LollipopRouteGeneratorService';
import { getDatabasePoolConfig } from './src/utils/config-loader';

// Custom Trailhead Lollipop Service that only uses degree 1 endpoints (trailheads)
class TrailheadLollipopRouteGeneratorService extends LollipopRouteGeneratorService {
  
  /**
   * Override the generateLollipopRoutes method to only use degree 1 endpoints (trailheads)
   */
  async generateLollipopRoutes(): Promise<any[]> {
    console.log('🏔️ Starting TRAILHEAD-ONLY lollipop route generation...');
    console.log(`   Target distance: ${this.config.targetDistance}km`);
    console.log(`   Max anchor nodes: ${this.config.maxAnchorNodes}`);
    console.log(`   Edge overlap threshold: ${this.config.edgeOverlapThreshold}%`);
    console.log(`   🎯 ONLY using degree 1 endpoints (trailheads) as anchors and destinations`);

    // Find degree 1 anchor nodes (trailheads only)
    const anchorNodes = await this.pgClient.query(`
      SELECT id, 
             (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) as connection_count
      FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr
      WHERE (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) = 1
      ORDER BY id
      LIMIT ${this.config.maxAnchorNodes}
    `);
    
    console.log(`   Found ${anchorNodes.rows.length} trailhead anchor nodes (degree 1)`);
    
    if (anchorNodes.rows.length === 0) {
      console.log('❌ No trailhead nodes found! Cannot generate trailhead routes.');
      return [];
    }
    
    const allLoops: any[] = [];
    
    for (const anchorNode of anchorNodes.rows) {
      console.log(`   Processing trailhead anchor ${anchorNode.id} (${anchorNode.connection_count} connections)`);
      
      const loops = await this.findTrailheadLoopPaths(anchorNode.id, this.config.targetDistance);
      allLoops.push(...loops);
      
      // Stop if we have enough high-quality loops
      if (allLoops.length >= 50) {
        console.log(`   Found ${allLoops.length} loops, stopping search`);
        break;
      }
    }
    
    // Sort by total distance descending
    allLoops.sort((a, b) => b.total_distance - a.total_distance);
    
    console.log(`✅ Generated ${allLoops.length} trailhead lollipop routes`);
    return allLoops;
  }

  /**
   * Find loop paths starting and ending at trailheads (degree 1 nodes)
   */
  private async findTrailheadLoopPaths(
    anchorNode: number,
    targetDistance: number
  ): Promise<any[]> {
    // Find reachable trailhead nodes (degree 1 only)
    const reachableNodes = await this.pgClient.query(`
      WITH direct_reachable AS (
        SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
        FROM pgr_dijkstra(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint,
          (SELECT array_agg(id) FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr 
           WHERE (SELECT COUNT(*) FROM ${this.config.stagingSchema}.ways_noded WHERE source = ways_noded_vertices_pgr.id OR target = ways_noded_vertices_pgr.id) = 1),
          false
        )
        WHERE agg_cost > 0 AND agg_cost < $2
      )
      SELECT node_id, distance_km
      FROM direct_reachable
      WHERE distance_km >= $3 AND distance_km <= $4
      ORDER BY distance_km DESC
      LIMIT $5
    `, [
      anchorNode,
      targetDistance * 1.2, // Allow some buffer
      this.config.minOutboundDistance,
      targetDistance * this.config.distanceRangeMax,
      this.config.maxReachableNodes
    ]);

    console.log(`     Found ${reachableNodes.rows.length} reachable trailhead destinations`);

    const loops: any[] = [];

    for (const destNode of reachableNodes.rows) {
      const outboundDistance = destNode.distance_km;
      const targetReturnDistance = targetDistance - outboundDistance;

      if (targetReturnDistance < this.config.minOutboundDistance) {
        continue;
      }

      // Find return paths using KSP (K-Shortest Paths) to the same trailhead
      const returnPaths = await this.pgClient.query(`
        SELECT path_seq, node, edge, cost, agg_cost
        FROM pgr_ksp(
          'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
          $1::bigint,
          $2::bigint,
          $3,
          false
        )
        WHERE agg_cost BETWEEN $4 AND $5
        ORDER BY agg_cost
      `, [
        destNode.node_id,
        anchorNode, // Return to the same trailhead
        this.config.kspPaths,
        targetReturnDistance * 0.8,
        targetReturnDistance * 1.2
      ]);

      if (returnPaths.rows.length === 0) {
        continue;
      }

      // Process each return path
      for (const returnPath of returnPaths.rows.slice(0, 3)) { // Take top 3 return paths
        const returnDistance = returnPath.agg_cost;
        const totalDistance = outboundDistance + returnDistance;

        // Check edge overlap
        const edgeOverlap = await this.calculateEdgeOverlap(anchorNode, destNode.node_id, returnPath);
        const overlapPercentage = (edgeOverlap.overlap_count / edgeOverlap.total_edges) * 100;

        if (overlapPercentage <= this.config.edgeOverlapThreshold) {
          const route = {
            anchor_node: anchorNode,
            dest_node: destNode.node_id,
            outbound_distance: outboundDistance,
            return_distance: returnDistance,
            total_distance: totalDistance,
            path_id: loops.length + 1,
            connection_type: 'trailhead_to_trailhead',
            route_shape: 'MultiLineString',
            edge_overlap_count: edgeOverlap.overlap_count,
            edge_overlap_percentage: overlapPercentage,
            route_geometry: await this.buildRouteGeometry(anchorNode, destNode.node_id, returnPath),
            edge_ids: await this.getRouteEdgeIds(anchorNode, destNode.node_id, returnPath)
          };

          loops.push(route);
        }
      }
    }

    return loops;
  }

  /**
   * Calculate edge overlap between outbound and return paths
   */
  private async calculateEdgeOverlap(anchorNode: number, destNode: number, returnPath: any): Promise<{overlap_count: number, total_edges: number}> {
    // Get outbound path edges
    const outboundPath = await this.pgClient.query(`
      SELECT edge
      FROM pgr_dijkstra(
        'SELECT id, source, target, COALESCE(length_km, 0.1) as cost FROM ${this.config.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL AND length_km IS NOT NULL',
        $1::bigint,
        $2::bigint,
        false
      )
      WHERE edge IS NOT NULL
    `, [anchorNode, destNode]);

    const outboundEdges = new Set(outboundPath.rows.map(r => r.edge));
    
    // Get return path edges (from the KSP result)
    const returnEdges = new Set(returnPath.edge ? [returnPath.edge] : []);
    
    // Calculate overlap
    const overlap = [...outboundEdges].filter(edge => returnEdges.has(edge)).length;
    const totalEdges = outboundEdges.size + returnEdges.size - overlap;

    return { overlap_count: overlap, total_edges: totalEdges };
  }

  /**
   * Build route geometry (simplified version)
   */
  private async buildRouteGeometry(anchorNode: number, destNode: number, returnPath: any): Promise<string> {
    // This is a simplified version - in practice you'd build the full MultiLineString
    return `MultiLineString((outbound_path), (return_path))`;
  }

  /**
   * Get route edge IDs (simplified version)
   */
  private async getRouteEdgeIds(anchorNode: number, destNode: number, returnPath: any): Promise<number[]> {
    // This is a simplified version - in practice you'd collect all edge IDs
    return [1, 2, 3]; // Placeholder
  }
}

async function testTrailheadLollipopIntegration() {
  console.log('🏔️ Testing TRAILHEAD-ONLY LollipopRouteGeneratorService integration...');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-trailheads.ts <schema_name>');
    process.exit(1);
  }

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Test the trailhead-only lollipop service
    const trailheadService = new TrailheadLollipopRouteGeneratorService(pgClient, {
      stagingSchema: schema,
      region: 'boulder',
      targetDistance: 60, // Moderate target for trailhead routes
      maxAnchorNodes: 20, // Limit to reasonable number of trailheads
      maxReachableNodes: 20,
      maxDestinationExploration: 10,
      distanceRangeMin: 0.3, // Favor longer outbound legs
      distanceRangeMax: 0.8, // Allow reasonable return legs
      edgeOverlapThreshold: 30,
      kspPaths: 8,
      minOutboundDistance: 8, // Ensure substantial outbound distance
      outputPath: 'test-output'
    });

    console.log('🏔️ Generating TRAILHEAD-ONLY lollipop routes...');
    const trailheadRoutes = await trailheadService.generateLollipopRoutes();
    
    console.log(`✅ Generated ${trailheadRoutes.length} trailhead lollipop routes`);
    
    if (trailheadRoutes.length > 0) {
      console.log('📊 Top 10 TRAILHEAD routes:');
      trailheadRoutes
        .sort((a, b) => b.total_distance - a.total_distance)
        .slice(0, 10)
        .forEach((route, index) => {
          console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Trailhead ${route.anchor_node} → Trailhead ${route.dest_node}`);
        });

      // Show statistics for trailhead routes
      const longTrailheadRoutes = trailheadRoutes.filter(r => r.total_distance >= 40);
      const veryLongTrailheadRoutes = trailheadRoutes.filter(r => r.total_distance >= 60);
      
      console.log(`\n📈 Trailhead Route Statistics:`);
      console.log(`   • Total trailhead routes: ${trailheadRoutes.length}`);
      console.log(`   • Routes ≥40km: ${longTrailheadRoutes.length}`);
      console.log(`   • Routes ≥60km: ${veryLongTrailheadRoutes.length}`);
      console.log(`   • Average distance: ${(trailheadRoutes.reduce((sum, r) => sum + r.total_distance, 0) / trailheadRoutes.length).toFixed(2)}km`);
      console.log(`   • Max distance: ${Math.max(...trailheadRoutes.map(r => r.total_distance)).toFixed(2)}km`);

      // Show unique trailheads used
      const uniqueTrailheads = new Set([
        ...trailheadRoutes.map(r => r.anchor_node),
        ...trailheadRoutes.map(r => r.dest_node)
      ]);
      console.log(`   • Unique trailheads used: ${uniqueTrailheads.size}`);

      // Save to database
      await trailheadService.saveToDatabase(trailheadRoutes);
      
      // Export to GeoJSON
      const filepath = await trailheadService.exportToGeoJSON(trailheadRoutes);
      console.log(`📁 Exported to: ${filepath}`);
    } else {
      console.log('❌ No trailhead routes generated. This could mean:');
      console.log('   • No degree 1 nodes (trailheads) found in the network');
      console.log('   • Trailheads are too far apart for the target distance');
      console.log('   • Network connectivity issues');
    }

  } catch (error) {
    console.error('❌ Error testing trailhead lollipop integration:', error);
  } finally {
    await pgClient.end();
  }
}

testTrailheadLollipopIntegration().catch(console.error);
