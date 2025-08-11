export declare const env: {
    host: string | undefined;
    port: number | undefined;
    database: string;
    user: string;
    password: string;
    testHost: string | undefined;
    testPort: number | undefined;
    testDatabase: string;
    testUser: string;
    testPassword: string;
    nodeEnv: string;
    verbose: boolean;
    testLimit: number | undefined;
};
export declare function getDbConfig(): {
    host: string | undefined;
    port: number | undefined;
    database: string;
    user: string;
    password: string;
};
export declare function validateTestEnvironment(): boolean;
//# sourceMappingURL=env.d.ts.map