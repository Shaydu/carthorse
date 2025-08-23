import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from './types/network-types';
import { PostgisNodeStrategy } from './strategies/postgis-node-strategy';
import { SnapAndSplitStrategy } from './strategies/snap-and-split-strategy';
import { VertexBasedNetworkStrategy } from './vertex-based-network-strategy';
import { EndpointSnapAndSplitStrategy } from './strategies/endpoint-snap-and-split-strategy';
import { PgrNodeNetworkStrategy } from './strategies/pgr-node-network-strategy';
import { getConstants } from '../../config-loader';

export class NetworkCreationService {
  private strategy: NetworkCreationStrategy;

  constructor() {
    // Use pgr_nodeNetwork strategy to restore intersection detection for loop creation
    // This was the working approach in commit f66282bf5963e03fdcfcdaa9ebe54439e09889cf
    this.strategy = new PgrNodeNetworkStrategy();
  }

  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    console.log(`🎯 Network Creation Service: Using pgr_nodeNetwork strategy for intersection detection`);
    
    try {
      const result = await this.strategy.createNetwork(pgClient, config);
      
      if (result.success) {
        console.log(`✅ Network creation completed successfully:`);
        console.log(`   📍 Nodes created: ${result.stats.nodesCreated}`);
        console.log(`   🛤️ Edges created: ${result.stats.edgesCreated}`);
        console.log(`   🔗 Isolated nodes: ${result.stats.isolatedNodes}`);
        console.log(`   🚫 Orphaned edges: ${result.stats.orphanedEdges}`);
      } else {
        console.error(`❌ Network creation failed: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      console.error('❌ Network creation service failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stats: {
          nodesCreated: 0,
          edgesCreated: 0,
          isolatedNodes: 0,
          orphanedEdges: 0
        }
      };
    }
  }
} 