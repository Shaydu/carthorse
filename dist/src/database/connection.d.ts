import { Client } from 'pg';
export declare function getTestDbConfig(): {
    host: string | undefined;
    port: number | undefined;
    database: string;
    user: string;
    password: string;
};
export declare function getProductionDbConfig(): {
    host: string | undefined;
    port: number | undefined;
    database: string;
    user: string;
    password: string;
};
export declare function getBboxPhase2DbConfig(): {
    host: string | undefined;
    port: number | undefined;
    database: string;
    user: string;
    password: string;
};
export declare function validateDbConfig(config: any): boolean;
export declare function testConnection(config: any): Promise<boolean>;
export declare function getProductionConnection(): Promise<Client | null>;
import type { EnvironmentConfig } from '../types';
export declare class DatabaseConnection {
    private static instance;
    private client;
    private currentEnvironment;
    private constructor();
    static getInstance(): DatabaseConnection;
    /**
     * Get configuration for a specific environment
     */
    getEnvironmentConfig(environment?: string): EnvironmentConfig;
    /**
   * Create a new database client for the specified environment
   */
    createClient(environment?: string): Promise<Client>;
    /**
     * Get the current database client
     */
    getClient(): Client | null;
    /**
     * Get the current environment name
     */
    getCurrentEnvironment(): string;
    /**
     * Get the current environment configuration
     */
    getCurrentConfig(): EnvironmentConfig;
    /**
     * Disconnect the current client
     */
    disconnect(): Promise<void>;
    /**
     * Test the connection to a specific environment
     */
    testConnection(environment?: string): Promise<boolean>;
}
export declare const dbConnection: DatabaseConnection;
//# sourceMappingURL=connection.d.ts.map