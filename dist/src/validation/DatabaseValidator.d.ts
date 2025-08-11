export declare class DatabaseValidator {
    private client;
    constructor(databaseConfig: any);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    validateDatabase(): Promise<boolean>;
}
//# sourceMappingURL=DatabaseValidator.d.ts.map