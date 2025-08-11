#!/usr/bin/env npx ts-node
interface GeoJSONFeature {
    type: 'Feature';
    geometry: {
        type: string;
        coordinates: number[][];
    };
    properties: Record<string, any>;
}
interface GeoJSONCollection {
    type: 'FeatureCollection';
    features: GeoJSONFeature[];
}
interface ExportOptions {
    input: string;
    output: string;
    includeNodes: boolean;
    includeEdges: boolean;
    includeTrails: boolean;
    includeRecommendations: boolean;
    nodeTypes: string[];
    routeTypes: string[];
    verbose: boolean;
}
declare class GeoJSONExporter {
    private db;
    private options;
    constructor(dbPath: string, options: ExportOptions);
    private log;
    private parseGeometry;
    private createPointFeature;
    private createLineStringFeature;
    exportNodes(): GeoJSONFeature[];
    exportEdges(): GeoJSONFeature[];
    exportTrails(): GeoJSONFeature[];
    exportRecommendations(): GeoJSONFeature[];
    exportAll(): GeoJSONCollection;
    close(): void;
}
export { GeoJSONExporter, ExportOptions };
//# sourceMappingURL=geojson-export.d.ts.map