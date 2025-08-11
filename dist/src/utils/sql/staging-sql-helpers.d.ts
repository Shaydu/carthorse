import { Client } from 'pg';
export interface StagingConfig {
    stagingSchema: string;
    region: string;
    bbox?: [number, number, number, number];
}
export declare class StagingSqlHelpers {
    private pgClient;
    private config;
    constructor(pgClient: Client, config: StagingConfig);
    /**
     * Clear existing data in staging schema
     */
    clearStagingData(): Promise<void>;
    /**
     * Get original trails from public schema with filters
     */
    getOriginalTrails(bbox?: [number, number, number, number]): Promise<any[]>;
    /**
     * Check if a trail forms a loop
     */
    checkTrailLoop(geometry: any): Promise<{
        is_loop: boolean;
        start_end_distance: number;
    }>;
    /**
     * Split loop trail at intersection points
     */
    splitLoopTrail(geometry: any, trailUuid: string): Promise<any[]>;
    /**
     * Insert trail into staging schema
     */
    insertTrailToStaging(trailData: any): Promise<void>;
    /**
     * Copy region data to staging with loop splitting
     */
    copyRegionDataToStaging(bbox?: [number, number, number, number]): Promise<void>;
    /**
     * Create staging environment tables
     */
    createStagingTables(): Promise<void>;
}
//# sourceMappingURL=staging-sql-helpers.d.ts.map