import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from './types/network-types';
import { PostgisNodeStrategy } from './strategies/postgis-node-strategy';
import { getConstants } from '../../config-loader';

export class NetworkCreationService {
  private strategy: NetworkCreationStrategy;

  constructor() {
    // Use PostGIS node strategy - the only available strategy
    this.strategy = new PostgisNodeStrategy();
  }

  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    console.log(`🎯 Network Creation Service: Using postgis-node strategy`);
    
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