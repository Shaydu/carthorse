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
    // Strategy will be set dynamically based on configuration
    this.strategy = new PostgisNodeStrategy(); // Default fallback
  }

  async createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult> {
    // Dynamically choose strategy based on configuration
    const strategyClass = config.strategyClass || 'PostgisNodeStrategy';
    
    // Create strategy instance based on configuration
    switch (strategyClass) {
      case 'PostgisNodeStrategy':
        this.strategy = new PostgisNodeStrategy();
        console.log(`🎯 Network Creation Service: Using PostgisNodeStrategy (simple, reliable)`);
        break;
      case 'PgrNodeNetworkStrategy':
        this.strategy = new PgrNodeNetworkStrategy();
        console.log(`🎯 Network Creation Service: Using PgrNodeNetworkStrategy (complex, precise)`);
        break;
      case 'EndpointSnapAndSplitStrategy':
        this.strategy = new EndpointSnapAndSplitStrategy();
        console.log(`🎯 Network Creation Service: Using EndpointSnapAndSplitStrategy (endpoint-focused)`);
        break;
      case 'SnapAndSplitStrategy':
        this.strategy = new SnapAndSplitStrategy();
        console.log(`🎯 Network Creation Service: Using SnapAndSplitStrategy (snap and split)`);
        break;
      case 'VertexBasedNetworkStrategy':
        this.strategy = new VertexBasedNetworkStrategy();
        console.log(`🎯 Network Creation Service: Using VertexBasedNetworkStrategy (vertex-based)`);
        break;
      default:
        this.strategy = new PostgisNodeStrategy();
        console.log(`🎯 Network Creation Service: Using PostgisNodeStrategy (default fallback)`);
        break;
    }
    
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