import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from './types/network-types';
import { ManualNetworkStrategy } from './strategies/manual-network-strategy';
import { PgNodeNetworkStrategy } from './strategies/pg-node-network-strategy';
import { PostgisNodeNetworkStrategy } from './strategies/postgis-node-network-strategy';

export class NetworkCreationService {
  private strategy: NetworkCreationStrategy;

  constructor(strategySelector?: 'pgnn' | 'postgis') {
    if (strategySelector === 'pgnn') {
      this.strategy = new PgNodeNetworkStrategy();
    } else if (strategySelector === 'postgis') {
      this.strategy = new PostgisNodeNetworkStrategy();
    } else {
      // Fallback to manual to preserve legacy behavior if selector missing
      this.strategy = new ManualNetworkStrategy();
    }
  }

  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    const selected = config.networkStrategy ?? (config.usePgNodeNetwork ? 'pgnn' : 'postgis');
    console.log(`🎯 Network Creation Service: Using ${selected} strategy`);
    
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