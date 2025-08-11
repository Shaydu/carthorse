import { TrailInsertData } from '../types';
export declare class AtomicTrailInserter {
    private client;
    constructor(databaseConfig: any);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    insertTrail(trail: TrailInsertData): Promise<void>;
    insertTrails(trails: TrailInsertData[]): Promise<void>;
}
//# sourceMappingURL=AtomicTrailInserter.d.ts.map