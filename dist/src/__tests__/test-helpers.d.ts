import { Client } from 'pg';
export declare function createTestSchema(client: Client, schemaName: string): Promise<void>;
export declare function createTestTrailsTable(client: Client, schemaName: string): Promise<void>;
export declare function createTestRoutingTables(client: Client, schemaName: string): Promise<void>;
export declare function insertTestTrail(client: Client, schemaName: string, trailData: any): Promise<void>;
export declare function cleanupTestSchema(client: Client, schemaName: string): Promise<void>;
export declare function generateTestSchemaName(prefix?: string): string;
//# sourceMappingURL=test-helpers.d.ts.map