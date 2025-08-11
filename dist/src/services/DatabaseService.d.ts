import { Client } from 'pg';
export interface DatabaseOperation {
    sql: string;
    params?: any[];
}
export interface DataAvailabilityResult {
    trailCount: number;
    hasData: boolean;
    regions: string[];
}
export interface DatabaseService {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    executeQuery(sql: string, params?: any[]): Promise<any>;
    executeTransaction(operations: DatabaseOperation[]): Promise<void>;
    checkSchemaVersion(expectedVersion: number): Promise<void>;
    checkRequiredFunctions(requiredFunctions: string[]): Promise<void>;
    checkRequiredTables(requiredTables: string[]): Promise<void>;
    checkDataAvailability(region: string, bbox?: [number, number, number, number]): Promise<DataAvailabilityResult>;
}
export declare class PostgresDatabaseService implements DatabaseService {
    private client;
    constructor(client: Client);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    executeQuery(sql: string, params?: any[]): Promise<any>;
    executeTransaction(operations: DatabaseOperation[]): Promise<void>;
    checkSchemaVersion(expectedVersion: number): Promise<void>;
    checkRequiredFunctions(requiredFunctions: string[]): Promise<void>;
    checkRequiredTables(requiredTables: string[]): Promise<void>;
    checkDataAvailability(region: string, bbox?: [number, number, number, number]): Promise<DataAvailabilityResult>;
}
//# sourceMappingURL=DatabaseService.d.ts.map