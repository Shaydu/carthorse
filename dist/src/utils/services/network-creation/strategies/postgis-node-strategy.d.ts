import { Pool } from 'pg';
import { NetworkCreationStrategy, NetworkConfig, NetworkResult } from '../types/network-types';
export declare class PostgisNodeStrategy implements NetworkCreationStrategy {
    createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult>;
}
//# sourceMappingURL=postgis-node-strategy.d.ts.map