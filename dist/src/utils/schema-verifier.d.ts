export interface SchemaColumn {
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    character_maximum_length: number | null;
}
export interface SchemaTable {
    table_name: string;
    columns: SchemaColumn[];
}
export interface SchemaComparison {
    tables: {
        missing_in_test: string[];
        missing_in_prod: string[];
        common: string[];
    };
    columns: {
        [tableName: string]: {
            missing_in_test: string[];
            missing_in_prod: string[];
            type_mismatches: Array<{
                column: string;
                test_type: string;
                prod_type: string;
            }>;
        };
    };
    isValid: boolean;
}
export declare class SchemaVerifier {
    private pgConfig;
    private sqlitePath?;
    private pgClient;
    private sqliteDb;
    constructor(pgConfig: {
        host: string;
        port: number;
        database: string;
        user: string;
        password?: string;
    }, sqlitePath?: string | undefined);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    /**
     * Get PostgreSQL table schema
     */
    getPostgresSchema(): Promise<SchemaTable[]>;
    /**
     * Get SQLite table schema
     */
    getSqliteSchema(): SchemaTable[];
    /**
     * Normalize SQLite data types to PostgreSQL equivalents
     */
    private normalizeSqliteType;
    /**
     * Compare schemas between PostgreSQL and SQLite
     */
    compareSchemas(): Promise<SchemaComparison>;
    /**
     * Print schema comparison report
     */
    printComparisonReport(comparison: SchemaComparison): void;
    /**
     * Verify that a specific table exists and has required columns
     */
    verifyTable(tableName: string, requiredColumns: string[]): Promise<boolean>;
}
/**
 * Utility function to verify test database schema
 */
export declare function verifyTestDatabaseSchema(pgConfig: any, sqlitePath?: string): Promise<boolean>;
//# sourceMappingURL=schema-verifier.d.ts.map