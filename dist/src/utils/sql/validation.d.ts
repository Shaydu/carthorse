import { Client } from 'pg';
export declare function validateStagingData(pgClient: Client, stagingSchema: string, region: string, regionBbox: any, verbose?: boolean): Promise<any>;
export declare function calculateAndDisplayRegionBbox(pgClient: Client, stagingSchema: string, region: string, verbose?: boolean): Promise<any>;
//# sourceMappingURL=validation.d.ts.map