export declare const TEST_BBOX_CONFIGS: {
    readonly boulder: {
        readonly small: readonly [-105.28932, 39.99233, -105.282906, 39.99881];
        readonly medium: readonly [-105.295, 39.99, -105.275, 40.01];
        readonly full: undefined;
    };
    readonly seattle: {
        readonly small: readonly [-122.2, 47.55, -122.15, 47.6];
        readonly medium: readonly [-122.4, 47.55, -122.25, 47.7];
        readonly full: undefined;
    };
};
export declare function getTestBbox(region: string, size?: 'small' | 'medium' | 'full'): [number, number, number, number] | undefined;
export declare function getRegionDataCopySql(schemaName: string, region: string, bbox?: [number, number, number, number]): {
    sql: string;
    params: any[];
};
export declare function validateRegionExistsSql(): string;
//# sourceMappingURL=region-data.d.ts.map