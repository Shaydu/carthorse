#!/usr/bin/env ts-node
/**
 * Atomic Trail Insertion System
 *
 * This system ensures complete trail records are created atomically using PostgreSQL transactions.
 * It prevents the half-baked data issues that plagued SQLite/SpatiaLite by ensuring all
 * required data is present and valid before committing to the database.
 *
 * Usage:
 *   npx ts-node carthorse-postgres-atomic-insert.ts --db <database_name>
 */
interface CompleteTrailRecord {
    app_uuid: string;
    osm_id: string;
    name: string;
    trail_type: string;
    surface: string;
    difficulty: string;
    geometry: string;
    elevation_gain: number;
    elevation_loss: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
    length_km: number;
    bbox_min_lng: number;
    bbox_max_lng: number;
    bbox_min_lat: number;
    bbox_max_lat: number;
    source_tags: string;
    region: string;
    coordinate_count: number;
    has_3d_geometry: boolean;
    elevation_data_complete: boolean;
    validation_passed: boolean;
}
interface TrailInsertData {
    osm_id: string;
    name: string;
    trail_type: string;
    surface?: string;
    difficulty?: string;
    coordinates: number[][];
    source_tags: Record<string, string>;
    region: string;
}
interface InsertResult {
    success: boolean;
    trail_id?: string;
    error?: string;
    validation_errors?: string[];
    data_quality?: {
        has_3d_geometry: boolean;
        elevation_data_complete: boolean;
        coordinate_count: number;
        length_km: number;
        elevation_gain: number;
    };
    elevation_report?: {
        original_missing: boolean;
        fixed: boolean;
        source?: 'TIFF' | 'USGS_3DEP' | 'SRTM30m' | 'SRTM90m' | 'OpenTopoData';
        coordinates_processed: number;
        coordinates_with_elevation: number;
        elevation_range?: {
            min: number;
            max: number;
            gain: number;
        };
        sources_used: Array<{
            source: string;
            coordinates_found: number;
            total_coordinates: number;
        }>;
    };
}
declare class AtomicTrailInserter {
    private client;
    private dbName;
    private tiffFiles;
    private elevationCache;
    private elevationFallback;
    constructor(dbName: string, useFallbackElevation?: boolean);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    loadTiffFiles(): Promise<void>;
    private getTiffBBox;
    private isCoordinateInTiffBounds;
    private getElevationFromTiff;
    private readElevationFromTiff;
    private getElevationFromUSGS3DEP;
    private getElevationFromSRTM30m;
    private getElevationFromOpenTopoData;
    processTrailElevation(coordinates: number[][]): Promise<{
        elevation_gain: number;
        elevation_loss: number;
        max_elevation: number;
        min_elevation: number;
        avg_elevation: number;
        elevations: number[];
        coordinates3D: number[][];
    }>;
    private calculateBBox;
    private calculateLength;
    private haversineDistance;
    private validateTrailData;
    insertTrailAtomically(trailData: TrailInsertData): Promise<InsertResult>;
    insertTrailsBatch(trails: TrailInsertData[]): Promise<{
        total: number;
        successful: number;
        failed: number;
        results: InsertResult[];
    }>;
    /**
     * Process specific trails by OSM IDs
     */
    processTrailsByOsmIds(osmIds: string[]): Promise<{
        total: number;
        successful: number;
        failed: number;
        results: InsertResult[];
    }>;
}
export { AtomicTrailInserter, TrailInsertData, CompleteTrailRecord, InsertResult };
//# sourceMappingURL=carthorse-postgres-atomic-insert.d.ts.map