/**
 * CARTHORSE Type Definitions
 */
export type Coordinate3D = [number, number, number];
export type Coordinate2D = [number, number];
export type GeoJSONCoordinate = Coordinate2D | Coordinate3D;
export type LeafletCoordinate = [number, number];
export interface BoundingBox {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
}
export interface TrailInsertData {
    osm_id: string;
    name: string;
    trail_type: string;
    coordinates: Coordinate3D[];
    source_tags: Record<string, string>;
    region: string;
}
export interface CompleteTrailRecord {
    app_uuid: string;
    osm_id: string;
    name: string;
    trail_type: string;
    geojson: string;
    source_tags: Record<string, string>;
    region: string;
    created_at: Date;
    updated_at: Date;
}
export interface OrchestratorConfig {
    database: {
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
    };
    region: string;
    dataPath: string;
    elevationPath: string;
    osmPath: string;
}
export interface ValidationResult {
    passed: boolean;
    issues: ValidationIssue[];
    summary: ValidationSummary;
}
export interface ValidationIssue {
    type: 'error' | 'warning' | 'info';
    message: string;
    count?: number;
    details?: any;
}
export interface ValidationSummary {
    totalTrails: number;
    validTrails: number;
    invalidTrails: number;
    missingElevation: number;
    missingGeometry: number;
    invalidGeometry: number;
    not3DGeometry: number;
    zeroElevation: number;
}
export interface RoutingNode {
    id: number;
    nodeUuid: string;
    lat: number;
    lng: number;
    elevation: number;
    nodeType: string;
    connectedTrails: string;
}
export interface RoutingEdge {
    fromNodeId: number;
    toNodeId: number;
    trailId: string;
    trailName: string;
    distanceKm: number;
    elevationGain: number;
}
export interface IntersectionPoint {
    coordinate: GeoJSONCoordinate;
    idx: number;
    distance: number;
    visitorTrailId: string;
    visitorTrailName: string;
}
export interface ValidationResult {
    passed: boolean;
    issues: ValidationIssue[];
    summary: ValidationSummary;
}
export interface ValidationIssue {
    type: 'error' | 'warning' | 'info';
    message: string;
    count?: number;
    details?: any;
}
export interface ValidationSummary {
    totalTrails: number;
    validTrails: number;
    invalidTrails: number;
    missingElevation: number;
    missingGeometry: number;
    invalidGeometry: number;
    not3DGeometry: number;
    zeroElevation: number;
    spatialContainmentIssues: number;
}
export interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: boolean;
}
export interface EnvironmentConfig {
    name: string;
    database: DatabaseConfig;
    dataPaths: {
        sourceDataDir: string;
        elevationTiffDir: string;
        osmDataPath: string;
    };
    processing: {
        batchSize: number;
        timeoutMs: number;
        logLevel: string;
        verbose: boolean;
    };
}
export interface CarthorseOrchestratorConfig {
    region: string;
    outputPath: string;
    simplifyTolerance: number;
    intersectionTolerance: number;
    replace: boolean;
    validate: boolean;
    verbose: boolean;
    skipBackup: boolean;
    buildMaster: boolean;
    targetSizeMB: number | null;
    maxSqliteDbSizeMB: number;
    skipIncompleteTrails: boolean;
    bbox?: [number, number, number, number];
    noCleanup?: boolean;
    edgeTolerance?: number;
    useSqlite?: boolean;
    useIntersectionNodes?: boolean;
    useSplitTrails?: boolean;
    aggressiveCleanup?: boolean;
    cleanupOldStagingSchemas?: boolean;
    cleanupTempFiles?: boolean;
    maxStagingSchemasToKeep?: number;
    cleanupDatabaseLogs?: boolean;
    skipValidation?: boolean;
    skipBboxValidation?: boolean;
    skipGeometryValidation?: boolean;
    skipTrailValidation?: boolean;
    skipRecommendations?: boolean;
    targetSchemaVersion?: number;
}
export interface SchemaColumn {
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
}
export interface SchemaTable {
    table_name: string;
    columns: SchemaColumn[];
}
export interface SchemaComparison {
    missingTables: string[];
    extraTables: string[];
    columnDifferences: Record<string, {
        missing: string[];
        extra: string[];
        typeMismatches: string[];
    }>;
}
export interface SchemaVersion {
    version: number;
    description: string;
    applied_at: Date;
}
export interface RoutingGraphResult {
    nodes: any[];
    edges: any[];
    stats: {
        totalNodes: number;
        totalEdges: number;
        intersectionNodes: number;
        endpointNodes: number;
        nodeToTrailRatio: number;
    };
}
export interface TrailSegment {
    originalTrailId: number;
    segmentNumber: number;
    appUuid: string;
    name: string;
    trailType: string;
    surface: string;
    difficulty: string;
    sourceTags: string;
    osmId: string;
    elevationGain: number;
    elevationLoss: number;
    maxElevation: number;
    minElevation: number;
    avgElevation: number;
    lengthKm: number;
    source: string;
    geometry: string;
    bboxMinLng: number;
    bboxMaxLng: number;
    bboxMinLat: number;
    bboxMaxLat: number;
}
//# sourceMappingURL=index.d.ts.map