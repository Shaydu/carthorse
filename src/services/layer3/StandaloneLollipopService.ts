import { Pool, PoolClient } from 'pg';
import { LollipopRouteGeneratorService } from './LollipopRouteGeneratorService';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface StandaloneLollipopConfig {
  stagingSchema: string;
  region: string;
  outputPath?: string;
}

export interface StandaloneLollipopResult {
  routes: any[];
  metadata: {
    schema: string;
    git_commit: string;
    git_branch: string;
    run_timestamp: string;
    script: string;
    target_distance_km: number;
    max_anchor_nodes: number;
  };
  filepath: string | null;
}

export class StandaloneLollipopService {
  private pgClient: Pool;
  private config: StandaloneLollipopConfig;

  constructor(pgClient: Pool, config: StandaloneLollipopConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Run the standalone lollipop script logic against the provided staging schema
   */
  async generateRoutes(): Promise<StandaloneLollipopResult> {
    console.log(`🍭 Running standalone lollipop service against schema: ${this.config.stagingSchema}`);

    const outputPath = this.config.outputPath || path.join(process.cwd(), 'test-output', `lollipop-routes-${this.config.stagingSchema}-${new Date().toISOString().replace(/[:.]/g, '-')}.geojson`);

    try {
      // Use the LollipopRouteGeneratorService directly instead of calling external script
      const lollipopService = new LollipopRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetDistance: 150, // Pushed to 150km to find network limits
        maxAnchorNodes: 50, // Dramatically increased to explore all high-degree nodes
        maxReachableNodes: 50, // Explore maximum destination options
        maxDestinationExploration: 25, // Maximum thoroughness
        distanceRangeMin: 0.4, // Favor very long outbound legs (40% of target)
        distanceRangeMax: 0.95, // Allow very long return legs (95% of target)
        edgeOverlapThreshold: 20, // Reduced to allow more overlap for longer routes
        kspPaths: 15, // Maximum path exploration
        minOutboundDistance: 20, // Ensure substantial outbound distance
        outputPath: path.dirname(outputPath)
      });

      console.log('🚀 Generating MAXIMUM LENGTH lollipop routes...');
      console.log('⚠️  This may take longer due to aggressive exploration...');
      
      const lollipopRoutes = await lollipopService.generateLollipopRoutes();
      
      console.log(`✅ Generated ${lollipopRoutes.length} lollipop routes`);
      
      if (lollipopRoutes.length > 0) {
        console.log('📊 ALL routes sorted by length (showing top 20):');
        const sortedRoutes = lollipopRoutes.sort((a, b) => b.total_distance - a.total_distance);
        
        sortedRoutes.slice(0, 20).forEach((route, index) => {
          console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km (${route.edge_overlap_percentage.toFixed(1)}% overlap) - Anchor ${route.anchor_node} → ${route.dest_node}`);
        });

        // Detailed statistics for maximum route discovery
        const ultraLongRoutes = lollipopRoutes.filter(r => r.total_distance >= 100);
        const extremeRoutes = lollipopRoutes.filter(r => r.total_distance >= 150);
        const networkLimitRoutes = lollipopRoutes.filter(r => r.total_distance >= 200);
        
        console.log(`\n📈 MAXIMUM ROUTE DISCOVERY STATISTICS:`);
        console.log(`   • Total routes found: ${lollipopRoutes.length}`);
        console.log(`   • Routes ≥100km: ${ultraLongRoutes.length}`);
        console.log(`   • Routes ≥150km: ${extremeRoutes.length}`);
        console.log(`   • Routes ≥200km: ${networkLimitRoutes.length}`);
        console.log(`   • Average distance: ${(lollipopRoutes.reduce((sum, r) => sum + r.total_distance, 0) / lollipopRoutes.length).toFixed(2)}km`);
        console.log(`   • MAXIMUM distance found: ${Math.max(...lollipopRoutes.map(r => r.total_distance)).toFixed(2)}km`);
        console.log(`   • Median distance: ${sortedRoutes[Math.floor(sortedRoutes.length / 2)].total_distance.toFixed(2)}km`);
        
        // Show the absolute longest route details
        const longestRoute = sortedRoutes[0];
        console.log(`\n🏆 LONGEST ROUTE DISCOVERED:`);
        console.log(`   • Total Distance: ${longestRoute.total_distance.toFixed(2)}km`);
        console.log(`   • Outbound: ${longestRoute.outbound_distance.toFixed(2)}km`);
        console.log(`   • Return: ${longestRoute.return_distance.toFixed(2)}km`);
        console.log(`   • Anchor Node: ${longestRoute.anchor_node}`);
        console.log(`   • Destination Node: ${longestRoute.dest_node}`);
        console.log(`   • Edge Overlap: ${longestRoute.edge_overlap_percentage.toFixed(1)}%`);

        // Save to database
        await lollipopService.saveToDatabase(lollipopRoutes);
        
        // Get metadata information
        let gitCommit = 'unknown';
        let gitBranch = 'unknown';
        let runTimestamp = new Date().toISOString();
        
        try {
          const { execSync } = require('child_process');
          gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
          gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
        } catch (error) {
          console.log('⚠️  Could not get git information');
        }

        // Prepare metadata for orchestrator
        const metadata = {
          schema: this.config.stagingSchema,
          git_commit: gitCommit,
          git_branch: gitBranch,
          run_timestamp: runTimestamp,
          script: 'StandaloneLollipopService',
          target_distance_km: 150,
          max_anchor_nodes: 50
        };
        
        console.log(`📋 Routes saved to database in schema: ${this.config.stagingSchema}`);
        console.log(`📋 Metadata: commit ${gitCommit.substring(0, 8)}, schema ${this.config.stagingSchema}`);
        
        // Return route data without filepath - orchestrator will handle export
        return { routes: lollipopRoutes, metadata, filepath: null };
      } else {
        throw new Error('No routes were generated');
      }

    } catch (error) {
      console.error('❌ Failed to generate lollipop routes:', error);
      throw error;
    }
  }
}
