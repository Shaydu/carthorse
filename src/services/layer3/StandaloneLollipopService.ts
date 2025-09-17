import { Pool, PoolClient } from 'pg';
import { LollipopRouteGeneratorService } from './LollipopRouteGeneratorService';
import * as path from 'path';
import * as fs from 'fs/promises';
import { loadConfig } from '../../utils/config-loader';

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
      // Load YAML-configured lollipop parameters
      const appConfig = loadConfig();
      const lolli = (appConfig as any).layer3_routing?.routeGeneration?.lollipops || {} as any;
      const targetDistance = Number(lolli.targetDistance ?? 150);
      const maxAnchorNodes = Number(lolli.maxAnchorNodes ?? 50);
      const maxReachableNodes = Number(lolli.maxReachableNodes ?? 50);
      const maxDestinationExploration = Number(lolli.maxDestinationExploration ?? 25);
      const distanceRangeMin = Number(lolli.distanceRangeMin ?? 0.4);
      const distanceRangeMax = Number(lolli.distanceRangeMax ?? 0.95);
      const edgeOverlapThreshold = Number(lolli.edgeOverlapThreshold ?? 20);
      const kspPaths = Number(lolli.kspPaths ?? 15);
      const minOutboundDistance = Number(lolli.minOutboundDistance ?? 20);

      // Use the LollipopRouteGeneratorService directly instead of calling external script
      const lollipopService = new LollipopRouteGeneratorService(this.pgClient, {
        stagingSchema: this.config.stagingSchema,
        region: this.config.region,
        targetDistance,
        maxAnchorNodes,
        maxReachableNodes,
        maxDestinationExploration,
        distanceRangeMin,
        distanceRangeMax,
        edgeOverlapThreshold,
        kspPaths,
        minOutboundDistance,
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
          target_distance_km: targetDistance,
          max_anchor_nodes: maxAnchorNodes
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
