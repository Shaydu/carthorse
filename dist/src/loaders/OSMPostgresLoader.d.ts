import { TrailInsertData } from '../types';
export declare class OSMPostgresLoader {
    private client;
    constructor(databaseConfig: any);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    loadTrailsFromOSM(region: string): Promise<TrailInsertData[]>;
}
//# sourceMappingURL=OSMPostgresLoader.d.ts.map