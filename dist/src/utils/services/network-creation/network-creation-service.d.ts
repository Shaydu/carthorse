import { Pool } from 'pg';
import { NetworkConfig, NetworkResult } from './types/network-types';
export declare class NetworkCreationService {
    private strategy;
    constructor();
    createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult>;
}
//# sourceMappingURL=network-creation-service.d.ts.map