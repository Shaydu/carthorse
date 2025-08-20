#!/usr/bin/env ts-node
"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtomicTrailInserter = void 0;
const pg_1 = require("pg");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const dotenv = __importStar(require("dotenv"));
const carthorse_global_config_1 = require("../config/carthorse.global.config");
dotenv.config();
// Source data directory (set via env or default)
const SOURCE_DATA_DIR = process.env.SOURCE_DATA_DIR || '/path/to/source-data';
// Elevation TIFF directory constant
const ELEVATION_TIFF_DIR = process.env.ELEVATION_TIFF_DIR || path.join(SOURCE_DATA_DIR, 'elevation-data');
// NOTE: All geometry handling in this inserter is binary (WKB) in the database.
// WKT is only used for conversion at import/export boundaries or for debugging/validation.
// Use ST_GeomFromText for inserts, and AsText(geometry) only for WKT conversion if needed.
class AtomicTrailInserter {
    constructor(dbName, useFallbackElevation = false) {
        this.tiffFiles = new Map();
        this.elevationCache = new Map();
        // Spatial index for fast TIFF lookup
        this.tiffSpatialIndex = new Map(); // gridKey -> filename
        this.gridResolution = 0.1; // 0.1 degree grid cells for fast lookup
        this.dbName = dbName;
        this.client = new pg_1.Client({
            host: process.env.PGHOST || 'localhost',
            port: parseInt(process.env.PGPORT || '5432'),
            database: process.env.PGDATABASE || dbName || 'postgres',
            user: process.env.PGUSER || 'postgres',
            password: process.env.PGPASSWORD || '',
        });
        // Initialize elevation fallback service
        this.elevationFallback = null; // Removed ElevationFallbackService initialization
    }
    async connect() {
        try {
            await this.client.connect();
            console.log('✅ Connected to PostgreSQL database');
            // Test PostGIS
            const result = await this.client.query('SELECT version()');
            console.log('🌍 PostgreSQL version:', result.rows[0].version);
            // Load TIFF files for elevation data
            await this.loadTiffFiles();
        }
        catch (error) {
            if (error instanceof Error) {
                console.error('❌ Failed to connect to PostgreSQL:', error.message);
                console.error(`   Stack trace: ${error.stack}`);
            }
            else {
                console.error('❌ Failed to connect to PostgreSQL:', error);
            }
            throw error;
        }
    }
    async disconnect() {
        await this.client.end();
        console.log('🔒 Disconnected from PostgreSQL');
    }
    async loadTiffMetadata() {
        // Alias for loadTiffFiles() - maintains backward compatibility
        return this.loadTiffFiles();
    }
    async loadTiffFiles() {
        console.log('🗻 Loading TIFF files for elevation data...');
        const tiffDir = ELEVATION_TIFF_DIR;
        console.log(`🔍 Looking for TIFF files in: ${tiffDir}`);
        if (!fs.existsSync(tiffDir)) {
            console.error('❌ CRITICAL: TIFF directory not found!');
            console.error(`   Expected location: ${tiffDir}`);
            console.error('   Elevation data is required for trail processing.');
            console.error('   Please ensure TIFF files are available before processing.');
            throw new Error('TIFF directory not found - elevation data required');
        }
        console.log(`✅ TIFF directory found: ${tiffDir}`);
        const files = fs.readdirSync(tiffDir).filter(f => f.endsWith('.tif'));
        console.log(`📁 Found ${files.length} TIFF files`);
        for (const file of files) {
            try {
                const filePath = path.join(tiffDir, file);
                console.log(`📖 Loading ${file} into memory...`);
                const nodeBuffer = fs.readFileSync(filePath);
                const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
                const GeoTIFF = await Promise.resolve().then(() => __importStar(require('geotiff')));
                const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
                const image = await tiff.getImage();
                const bbox = await this.getTiffBBox(image);
                this.tiffFiles.set(file, {
                    image,
                    filePath,
                    bbox
                });
                console.log(`✅ Loaded ${file} - Coverage: ${carthorse_global_config_1.configHelpers.roundCoordinate(bbox.minLng).toFixed(4)}°W to ${carthorse_global_config_1.configHelpers.roundCoordinate(bbox.maxLng).toFixed(4)}°W, ${carthorse_global_config_1.configHelpers.roundCoordinate(bbox.minLat).toFixed(4)}°N to ${carthorse_global_config_1.configHelpers.roundCoordinate(bbox.maxLat).toFixed(4)}°N`);
                // Add this TIFF to the spatial index
                this.addTiffToSpatialIndex(file, bbox);
            }
            catch (error) {
                if (error instanceof Error) {
                    console.error(`❌ Failed to load ${file}:`, error.message);
                    console.error(`   Stack trace: ${error.stack}`);
                }
                else {
                    console.error(`❌ Failed to load ${file}:`, error);
                }
            }
        }
        console.log(`🗺️ Built spatial index with ${this.tiffSpatialIndex.size} grid cells for fast TIFF lookup`);
        console.log(`📊 TIFF loading summary:`);
        console.log(`   - Total files found: ${files.length}`);
        console.log(`   - Successfully loaded: ${this.tiffFiles.size}`);
        console.log(`   - Failed to load: ${files.length - this.tiffFiles.size}`);
        console.log(`   - Loaded files: ${Array.from(this.tiffFiles.keys()).join(', ')}`);
        if (this.tiffFiles.size === 0) {
            console.error('❌ CRITICAL: No TIFF files were loaded successfully!');
            console.error('   Elevation data is required for trail processing.');
            console.error('   Please check that TIFF files are valid and accessible.');
            throw new Error('No TIFF files loaded - elevation data required');
        }
    }
    async getTiffBBox(image) {
        const bbox = image.getBoundingBox();
        // Check if the coordinates are in Web Mercator (EPSG:3857) or WGS84 (EPSG:4326)
        // Web Mercator coordinates are typically very large (millions)
        // WGS84 coordinates are typically small (-180 to 180 for lng, -90 to 90 for lat)
        const isWebMercator = Math.abs(bbox[0]) > 1000 || Math.abs(bbox[1]) > 1000;
        if (isWebMercator) {
            // Convert Web Mercator to WGS84
            const minLng = (bbox[0] * 180) / (20037508.34);
            const minLat = (Math.atan(Math.exp(bbox[1] * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
            const maxLng = (bbox[2] * 180) / (20037508.34);
            const maxLat = (Math.atan(Math.exp(bbox[3] * Math.PI / 20037508.34)) * 2 - Math.PI / 2) * 180 / Math.PI;
            return {
                minLng,
                minLat,
                maxLng,
                maxLat
            };
        }
        else {
            // Already in WGS84 - GeoTIFF bounding box is [minX, minY, maxX, maxY] 
            // where X = longitude, Y = latitude
            // But we need to ensure the bounds are in the correct order
            const minLng = Math.min(bbox[0], bbox[2]);
            const maxLng = Math.max(bbox[0], bbox[2]);
            const minLat = Math.min(bbox[1], bbox[3]);
            const maxLat = Math.max(bbox[1], bbox[3]);
            return {
                minLng,
                minLat,
                maxLng,
                maxLat
            };
        }
    }
    isCoordinateInTiffBounds(lng, lat, tiffBBox) {
        return lng >= tiffBBox.minLng && lng <= tiffBBox.maxLng &&
            lat >= tiffBBox.minLat && lat <= tiffBBox.maxLat;
    }
    async getElevationFromTiff(lng, lat) {
        const cacheKey = `${carthorse_global_config_1.configHelpers.roundCoordinate(lng).toFixed(4)},${carthorse_global_config_1.configHelpers.roundCoordinate(lat).toFixed(4)}`;
        if (this.elevationCache.has(cacheKey)) {
            const cached = this.elevationCache.get(cacheKey);
            if (typeof cached === 'number') {
                console.log(`[DEBUG] Using cached elevation for [${lng}, ${lat}]: ${cached}`);
                return cached;
            }
        }
        // Find the matching TIFF file for this coordinate
        const matchingTiff = this.findMatchingTiff(lng, lat);
        if (!matchingTiff) {
            console.log(`[DEBUG] Coordinate [${lng}, ${lat}] not found in any TIFF coverage area`);
            return null;
        }
        console.log(`[DEBUG] Found TIFF for [${lng}, ${lat}]: ${matchingTiff.filename}`);
        try {
            const elevation = await this.readElevationFromTiff(matchingTiff.image, lng, lat);
            if (elevation !== null) {
                this.elevationCache.set(cacheKey, elevation);
                return elevation;
            }
        }
        catch (error) {
            if (error instanceof Error) {
                console.error(`Error reading elevation from ${matchingTiff.filename}:`, error.message);
                console.error(`   Stack trace: ${error.stack}`);
            }
            else {
                console.error(`Error reading elevation from ${matchingTiff.filename}:`, error);
            }
        }
        return null;
    }
    findMatchingTiff(lng, lat) {
        // Use spatial index for fast lookup
        const gridKey = this.getGridKey(lng, lat);
        const filename = this.tiffSpatialIndex.get(gridKey);
        if (filename) {
            const tiffData = this.tiffFiles.get(filename);
            if (tiffData && this.isCoordinateInTiffBounds(lng, lat, tiffData.bbox)) {
                return { filename, image: tiffData.image, bbox: tiffData.bbox };
            }
        }
        // Fallback: check all TIFFs (should rarely happen if spatial index is correct)
        for (const [filename, tiffData] of this.tiffFiles) {
            if (this.isCoordinateInTiffBounds(lng, lat, tiffData.bbox)) {
                return { filename, image: tiffData.image, bbox: tiffData.bbox };
            }
        }
        return null;
    }
    getGridKey(lng, lat) {
        const gridX = Math.floor(lng / this.gridResolution);
        const gridY = Math.floor(lat / this.gridResolution);
        return `${gridX},${gridY}`;
    }
    addTiffToSpatialIndex(filename, bbox) {
        // Calculate grid cells that this TIFF covers
        const minGridX = Math.floor(bbox.minLng / this.gridResolution);
        const maxGridX = Math.floor(bbox.maxLng / this.gridResolution);
        const minGridY = Math.floor(bbox.minLat / this.gridResolution);
        const maxGridY = Math.floor(bbox.maxLat / this.gridResolution);
        // Add this TIFF to all grid cells it covers
        for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
            for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
                const gridKey = `${gridX},${gridY}`;
                this.tiffSpatialIndex.set(gridKey, filename);
            }
        }
    }
    async readElevationFromTiff(image, lng, lat) {
        try {
            const width = image.getWidth();
            const height = image.getHeight();
            // Use the same bounds calculation as getTiffBBox for consistency
            const tiffBBox = await this.getTiffBBox(image);
            const bbox = [tiffBBox.minLng, tiffBBox.minLat, tiffBBox.maxLng, tiffBBox.maxLat];
            // Convert lat/lng to pixel coordinates using the correct bbox
            const pixelX = Math.floor(((lng - bbox[0]) / (bbox[2] - bbox[0])) * width);
            const pixelY = Math.floor(((bbox[3] - lat) / (bbox[3] - bbox[1])) * height);
            console.log(`[DEBUG] Reading elevation for [${lng}, ${lat}] -> pixel [${pixelX}, ${pixelY}] from image ${width}x${height}`);
            console.log(`[DEBUG] TIFF bbox: [${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}]`);
            if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) {
                console.log(`[DEBUG] Pixel coordinates [${pixelX}, ${pixelY}] out of bounds for image ${width}x${height}`);
                return null;
            }
            const data = await image.readRasters({
                samples: [0],
                window: [pixelX, pixelY, pixelX + 1, pixelY + 1]
            });
            const elevation = data[0][0];
            console.log(`[DEBUG] Raw elevation value from TIFF: ${elevation} (type: ${typeof elevation})`);
            if (elevation !== undefined && elevation !== null) {
                console.log(`[DEBUG] Returning elevation: ${elevation}`);
                return elevation;
            }
            else {
                console.log(`[DEBUG] Elevation is undefined/null, returning null`);
                return null;
            }
        }
        catch (error) {
            if (error instanceof Error) {
                console.error(`Error reading elevation from TIFF:`, error.message);
                console.error(`   Stack trace: ${error.stack}`);
            }
            else {
                console.error(`Error reading elevation from TIFF:`, error);
            }
            return null;
        }
    }
    async getElevationFromUSGS3DEP(lng, lat) {
        const cacheKey = `usgs3dep:${carthorse_global_config_1.configHelpers.roundCoordinate(lng).toFixed(4)},${carthorse_global_config_1.configHelpers.roundCoordinate(lat).toFixed(4)}`;
        if (this.elevationCache.has(cacheKey)) {
            return this.elevationCache.get(cacheKey);
        }
        try {
            const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSample?geometry={"x":${lng},"y":${lat},"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPoint&returnGeometry=false&f=json`;
            const resp = await fetch(url);
            if (!resp.ok)
                return null;
            const data = await resp.json();
            if (data && Array.isArray(data.values) && data.values.length > 0 && data.values[0]) {
                const elevation = data.values[0].value;
                if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
                    this.elevationCache.set(cacheKey, elevation);
                    return elevation;
                }
            }
        }
        catch (err) {
            if (err instanceof Error) {
                console.error(`[USGS3DEP] Error fetching elevation for [${lng}, ${lat}]:`, err.message);
                console.error(`   Stack trace: ${err.stack}`);
            }
            else {
                console.error(`[USGS3DEP] Error fetching elevation for [${lng}, ${lat}]:`, err);
            }
        }
        return null;
    }
    async getElevationFromSRTM30m(lng, lat) {
        const cacheKey = `srtm30m:${carthorse_global_config_1.configHelpers.roundCoordinate(lng).toFixed(4)},${carthorse_global_config_1.configHelpers.roundCoordinate(lat).toFixed(4)}`;
        if (this.elevationCache.has(cacheKey)) {
            return this.elevationCache.get(cacheKey);
        }
        try {
            const url = `https://api.opentopodata.org/v1/srtm30m?locations=${lat},${lng}`;
            const resp = await fetch(url);
            if (!resp.ok)
                return null;
            const data = await resp.json();
            if (data && Array.isArray(data.results) && data.results.length > 0 && data.results[0]) {
                const elevation = data.results[0].elevation;
                if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
                    this.elevationCache.set(cacheKey, elevation);
                    return elevation;
                }
            }
        }
        catch (err) {
            if (err instanceof Error) {
                console.error(`[SRTM30m] Error fetching elevation for [${lng}, ${lat}]:`, err.message);
                console.error(`   Stack trace: ${err.stack}`);
            }
            else {
                console.error(`[SRTM30m] Error fetching elevation for [${lng}, ${lat}]:`, err);
            }
        }
        return null;
    }
    async getElevationFromOpenTopoData(lng, lat) {
        const cacheKey = `opentopo:${carthorse_global_config_1.configHelpers.roundCoordinate(lng).toFixed(4)},${carthorse_global_config_1.configHelpers.roundCoordinate(lat).toFixed(4)}`;
        if (this.elevationCache.has(cacheKey)) {
            return this.elevationCache.get(cacheKey);
        }
        try {
            const url = `https://api.opentopodata.org/v1/srtm90m?locations=${lat},${lng}`;
            const resp = await fetch(url);
            if (!resp.ok)
                return null;
            const data = await resp.json();
            if (data && Array.isArray(data.results) && data.results.length > 0 && data.results[0]) {
                const elevation = data.results[0].elevation;
                if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
                    this.elevationCache.set(cacheKey, elevation);
                    return elevation;
                }
            }
        }
        catch (err) {
            if (err instanceof Error) {
                console.error(`[OpenTopoData] Error fetching elevation for [${lng}, ${lat}]:`, err.message);
                console.error(`   Stack trace: ${err.stack}`);
            }
            else {
                console.error(`[OpenTopoData] Error fetching elevation for [${lng}, ${lat}]:`, err);
            }
        }
        return null;
    }
    async processTrailElevation(coordinates) {
        const elevations = [];
        const coordinates3D = [];
        let validElevationCount = 0;
        for (const [lng, lat] of coordinates) {
            if (typeof lng !== 'number' || typeof lat !== 'number') {
                console.log(`[DEBUG] Skipping invalid coordinate: [${lng}, ${lat}]`);
                continue;
            }
            const tiffElevation = await this.getElevationFromTiff(lng, lat); // number | null
            if (typeof tiffElevation === 'number' && tiffElevation > 0 && typeof lng === 'number' && typeof lat === 'number') {
                elevations.push(tiffElevation);
                coordinates3D.push([lng, lat, tiffElevation]);
                validElevationCount++;
            }
            else {
                console.log(`[DEBUG] Coordinate: [${lng}, ${lat}] -> No elevation data available from TIFF`);
            }
        }
        // If we don't have enough valid elevation data, fail
        if (validElevationCount < 2) {
            console.error(`❌ CRITICAL: Insufficient elevation data for trail!`);
            console.error(`   Only ${validElevationCount} valid elevation points out of ${coordinates.length} coordinates`);
            console.error(`   Trail coordinates may be outside all coverage areas`);
            console.error(`   First few coordinates: ${coordinates.slice(0, 3).map(([lng, lat]) => `[${lng}, ${lat}]`).join(', ')}`);
            throw new Error(`Insufficient elevation data: only ${validElevationCount} valid points out of ${coordinates.length}`);
        }
        // Calculate elevation statistics
        let elevation_gain = 0;
        let elevation_loss = 0;
        let max_elevation = elevations.length > 0 ? Math.max(...elevations) : 0;
        let min_elevation = elevations.length > 0 ? Math.min(...elevations) : 0;
        let avg_elevation = elevations.length > 0 ? elevations.reduce((sum, elev) => sum + elev, 0) / elevations.length : 0;
        // Calculate gain/loss
        for (let i = 1; i < elevations.length; i++) {
            if (typeof elevations[i] === 'number' && typeof elevations[i - 1] === 'number') {
                const diff = elevations[i] - elevations[i - 1];
                if (diff > 0) {
                    elevation_gain += diff;
                }
                else {
                    elevation_loss += Math.abs(diff);
                }
            }
        }
        return {
            elevation_gain: carthorse_global_config_1.configHelpers.roundElevation(elevation_gain),
            elevation_loss: carthorse_global_config_1.configHelpers.roundElevation(elevation_loss),
            max_elevation: carthorse_global_config_1.configHelpers.roundElevation(max_elevation),
            min_elevation: carthorse_global_config_1.configHelpers.roundElevation(min_elevation),
            avg_elevation: carthorse_global_config_1.configHelpers.roundElevation(avg_elevation),
            elevations,
            coordinates3D
        };
    }
    calculateBBox(coordinates) {
        const lngs = coordinates.map(coord => coord[0]).filter((lng) => typeof lng === 'number');
        const lats = coordinates.map(coord => coord[1]).filter((lat) => typeof lat === 'number');
        return {
            bbox_min_lng: lngs.length > 0 ? carthorse_global_config_1.configHelpers.roundCoordinate(Math.min(...lngs)) : 0,
            bbox_max_lng: lngs.length > 0 ? carthorse_global_config_1.configHelpers.roundCoordinate(Math.max(...lngs)) : 0,
            bbox_min_lat: lats.length > 0 ? carthorse_global_config_1.configHelpers.roundCoordinate(Math.min(...lats)) : 0,
            bbox_max_lat: lats.length > 0 ? carthorse_global_config_1.configHelpers.roundCoordinate(Math.max(...lats)) : 0
        };
    }
    calculateLength(coordinates) {
        let length = 0;
        for (let i = 1; i < coordinates.length; i++) {
            const prev = coordinates[i - 1];
            const curr = coordinates[i];
            if (prev && curr && typeof prev[0] === 'number' && typeof prev[1] === 'number' && typeof curr[0] === 'number' && typeof curr[1] === 'number') {
                const [lng1, lat1] = prev;
                const [lng2, lat2] = curr;
                length += this.haversineDistance(lat1, lng1, lat2, lng2);
            }
        }
        return carthorse_global_config_1.configHelpers.roundDistance(length);
    }
    haversineDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return carthorse_global_config_1.configHelpers.roundDistance(R * c);
    }
    validateTrailData(trailData) {
        const errors = [];
        // Required field validation
        if (!trailData.name || trailData.name.trim() === '') {
            errors.push('Trail name is required');
        }
        if (!trailData.osm_id || trailData.osm_id.trim() === '') {
            errors.push('OSM ID is required');
        }
        if (!trailData.geometry || trailData.geometry.trim() === '') {
            errors.push('Geometry is required');
        }
        // Geometry validation
        if (trailData.coordinate_count < 2) {
            errors.push('Trail must have at least 2 coordinate points');
        }
        if (!trailData.has_3d_geometry) {
            errors.push('Trail must have 3D geometry with elevation data');
        }
        // Elevation data validation
        if (!trailData.elevation_data_complete) {
            errors.push('Complete elevation data is required (gain, loss, min, max, avg)');
        }
        if (trailData.elevation_gain < 0) {
            errors.push('Elevation gain cannot be negative');
        }
        if (trailData.elevation_loss < 0) {
            errors.push('Elevation loss cannot be negative');
        }
        if (trailData.max_elevation < trailData.min_elevation) {
            errors.push('Max elevation cannot be less than min elevation');
        }
        if (trailData.avg_elevation < trailData.min_elevation || trailData.avg_elevation > trailData.max_elevation) {
            errors.push('Average elevation must be between min and max elevation');
        }
        // Length validation
        if (trailData.length_km <= 0) {
            errors.push('Trail length must be greater than 0');
        }
        // BBox validation
        if (trailData.bbox_min_lng > trailData.bbox_max_lng) {
            errors.push('Invalid bounding box: min_lng > max_lng');
        }
        if (trailData.bbox_min_lat > trailData.bbox_max_lat) {
            errors.push('Invalid bounding box: min_lat > max_lat');
        }
        return errors;
    }
    async insertTrailAtomically(trailData) {
        try {
            // Start transaction
            await this.client.query('BEGIN');
            console.log(`🔍 Processing trail: ${trailData.name} (OSM: ${trailData.osm_id})`);
            // Step 1: Process elevation data
            console.log('   📈 Processing elevation data...');
            const elevationData = await this.processTrailElevation(trailData.coordinates);
            // Step 2: Calculate derived data
            console.log('   📐 Calculating derived data...');
            const bbox = this.calculateBBox(trailData.coordinates);
            const length_km = trailData.length_km !== undefined ? trailData.length_km : this.calculateLength(trailData.coordinates);
            // Step 3: Create 3D geometry
            console.log('   🗺️ Creating 3D geometry...');
            const coordinates3D = elevationData.coordinates3D;
            // Check if we have valid 3D coordinates
            if (!coordinates3D || coordinates3D.length === 0) {
                console.log('   ⚠️  No valid 3D coordinates available - trail outside TIFF coverage');
                await this.client.query('ROLLBACK');
                return {
                    success: false,
                    error: 'No valid 3D coordinates available - trail outside TIFF coverage'
                };
            }
            // Ensure we have at least 2 unique points
            const uniqueCoords = coordinates3D.filter((coord, index, arr) => {
                if (index === 0)
                    return true;
                const prev = arr[index - 1];
                return coord[0] !== prev[0] || coord[1] !== prev[1] || coord[2] !== prev[2];
            });
            if (uniqueCoords.length < 2) {
                console.log('   ❌ Insufficient unique 3D coordinates');
                await this.client.query('ROLLBACK');
                return {
                    success: false,
                    error: 'Insufficient unique 3D coordinates'
                };
            }
            const geometryWkt = `LINESTRING Z (${uniqueCoords.map(coord => `${coord[0]} ${coord[1]} ${coord[2]}`).join(', ')})`;
            // Step 4: Validate geometry using PostGIS
            console.log('   ✅ Validating geometry...');
            const geometryValidation = await this.client.query(`
        SELECT 
          ST_IsValid(ST_SetSRID(ST_GeomFromText($1), 4326)) as is_valid,
          ST_NDims(ST_SetSRID(ST_GeomFromText($1), 4326)) as dimensions,
          ST_NPoints(ST_SetSRID(ST_GeomFromText($1), 4326)) as point_count,
          ST_GeometryType(ST_SetSRID(ST_GeomFromText($1), 4326)) as geometry_type
      `, [geometryWkt]);
            const geomValid = geometryValidation.rows[0];
            // Step 5: Build complete trail record
            const completeTrail = {
                app_uuid: (0, uuid_1.v4)(),
                osm_id: trailData.osm_id,
                name: trailData.name,
                trail_type: trailData.trail_type,
                surface: trailData.surface || 'unknown',
                difficulty: trailData.difficulty || 'unknown',
                geometry: geometryWkt,
                elevation_gain: elevationData.elevation_gain,
                elevation_loss: elevationData.elevation_loss,
                max_elevation: elevationData.max_elevation,
                min_elevation: elevationData.min_elevation,
                avg_elevation: elevationData.avg_elevation,
                length_km,
                bbox_min_lng: bbox.bbox_min_lng,
                bbox_max_lng: bbox.bbox_max_lng,
                bbox_min_lat: bbox.bbox_min_lat,
                bbox_max_lat: bbox.bbox_max_lat,
                source_tags: JSON.stringify(trailData.source_tags),
                region: trailData.region,
                coordinate_count: coordinates3D.length,
                has_3d_geometry: geomValid.dimensions === 3,
                elevation_data_complete: elevationData.elevation_gain > 0 && elevationData.max_elevation > 0,
                validation_passed: false
            };
            // Step 6: Validate complete record
            console.log('   🔍 Validating complete record...');
            const validationErrors = this.validateTrailData(completeTrail);
            if (validationErrors.length > 0) {
                console.log(`   ❌ Validation failed: ${validationErrors.join(', ')}`);
                await this.client.query('ROLLBACK');
                return {
                    success: false,
                    error: 'Validation failed',
                    validation_errors: validationErrors
                };
            }
            // Step 7: Upsert (insert or update by osm_id)
            console.log('   💾 Upserting complete record...');
            const upsertQuery = `
        INSERT INTO trails (
          app_uuid, osm_id, source, name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          length_km, source_tags, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          geometry, region
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, ST_SetSRID(ST_GeomFromText($19), 4326), $20)
        ON CONFLICT (osm_id) DO UPDATE SET
          app_uuid = EXCLUDED.app_uuid,
          source = EXCLUDED.source,
          name = EXCLUDED.name,
          trail_type = EXCLUDED.trail_type,
          surface = EXCLUDED.surface,
          difficulty = EXCLUDED.difficulty,
          elevation_gain = EXCLUDED.elevation_gain,
          elevation_loss = EXCLUDED.elevation_loss,
          max_elevation = EXCLUDED.max_elevation,
          min_elevation = EXCLUDED.min_elevation,
          avg_elevation = EXCLUDED.avg_elevation,
          length_km = EXCLUDED.length_km,
          source_tags = EXCLUDED.source_tags,
          bbox_min_lng = EXCLUDED.bbox_min_lng,
          bbox_max_lng = EXCLUDED.bbox_max_lng,
          bbox_min_lat = EXCLUDED.bbox_min_lat,
          bbox_max_lat = EXCLUDED.bbox_max_lat,
          geometry = EXCLUDED.geometry,
          region = EXCLUDED.region
        RETURNING app_uuid
      `;
            const upsertResult = await this.client.query(upsertQuery, [
                completeTrail.app_uuid,
                completeTrail.osm_id,
                trailData.source || 'osm',
                completeTrail.name,
                completeTrail.trail_type,
                completeTrail.surface,
                completeTrail.difficulty,
                completeTrail.elevation_gain,
                completeTrail.elevation_loss,
                completeTrail.max_elevation,
                completeTrail.min_elevation,
                completeTrail.avg_elevation,
                completeTrail.length_km,
                completeTrail.source_tags,
                completeTrail.bbox_min_lng,
                completeTrail.bbox_max_lng,
                completeTrail.bbox_min_lat,
                completeTrail.bbox_max_lat,
                completeTrail.geometry,
                completeTrail.region
            ]);
            // Step 8: Commit transaction
            await this.client.query('COMMIT');
            console.log(`   ✅ Successfully upserted trail: ${completeTrail.name} (${upsertResult.rows[0].app_uuid})`);
            return {
                success: true,
                trail_id: upsertResult.rows[0].app_uuid,
                data_quality: {
                    has_3d_geometry: completeTrail.has_3d_geometry,
                    elevation_data_complete: completeTrail.elevation_data_complete,
                    coordinate_count: completeTrail.coordinate_count,
                    length_km: completeTrail.length_km,
                    elevation_gain: completeTrail.elevation_gain
                }
            };
        }
        catch (error) {
            if (error instanceof Error) {
                // Rollback transaction on any error
                await this.client.query('ROLLBACK');
                console.error(`   ❌ Transaction failed: ${error.message}`);
                console.error(`   Stack trace: ${error.stack}`);
            }
            else {
                // Rollback transaction on any error
                await this.client.query('ROLLBACK');
                console.error(`   ❌ Transaction failed:`, error);
            }
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async insertTrailsBatch(trails) {
        console.log(`🚀 Starting batch insertion of ${trails.length} trails...`);
        const results = [];
        let successful = 0;
        let failed = 0;
        for (const trail of trails) {
            if (!trail)
                continue;
            console.log(`\n📍 Processing trail ${successful + failed + 1}/${trails.length}: ${trail.name}`);
            const result = await this.insertTrailAtomically(trail);
            results.push(result);
            if (result.success) {
                successful++;
                console.log(`✅ Trail ${successful + failed} inserted successfully`);
            }
            else {
                failed++;
                console.log(`❌ Trail ${successful + failed} failed: ${result.error}`);
                if (result.validation_errors) {
                    console.log(`   Validation errors: ${result.validation_errors.join(', ')}`);
                }
            }
        }
        console.log(`\n📊 Batch insertion complete:`);
        console.log(`   - Total: ${trails.length}`);
        console.log(`   - Successful: ${successful}`);
        console.log(`   - Failed: ${failed}`);
        return {
            total: trails.length,
            successful,
            failed,
            results
        };
    }
    /**
     * Process specific trails by OSM IDs
     */
    async processTrailsByOsmIds(osmIds) {
        console.log(`🎯 Processing ${osmIds.length} specific trails by OSM IDs...`);
        const results = [];
        let successful = 0;
        let failed = 0;
        for (const osmId of osmIds) {
            if (!osmId)
                continue;
            console.log(`\n📍 Processing trail ${successful + failed + 1}/${osmIds.length}: OSM ID ${osmId}`);
            try {
                // Fetch trail data from database by OSM ID
                const trailQuery = `
          SELECT 
            osm_id, name, trail_type, surface, difficulty,
            ST_AsText(geometry) as geometry_text,
            source_tags, region
          FROM trails 
          WHERE osm_id = $1
        `;
                const trailResult = await this.client.query(trailQuery, [osmId]);
                if (trailResult.rows.length === 0) {
                    console.log(`❌ Trail with OSM ID ${osmId} not found in database`);
                    failed++;
                    results.push({
                        success: false,
                        error: `Trail with OSM ID ${osmId} not found`
                    });
                    continue;
                }
                const trailRow = trailResult.rows[0];
                // Parse geometry to get coordinates
                const geometryMatch = trailRow.geometry_text.match(/LINESTRING(?: Z)?\s*\(([^)]+)\)/);
                if (!geometryMatch) {
                    console.log(`❌ Invalid geometry for trail ${osmId}`);
                    console.log(`   Raw geometry: ${trailRow.geometry_text}`);
                    failed++;
                    results.push({
                        success: false,
                        error: `Invalid geometry for trail ${osmId}`
                    });
                    continue;
                }
                const coordPairs = geometryMatch[1].split(',').map((pair) => pair.trim());
                const coordinates = coordPairs.map((pair) => {
                    const coords = pair.split(' ').map(Number);
                    return [coords[0], coords[1]]; // [lng, lat]
                });
                console.log(`   ✅ Parsed ${coordinates.length} coordinates from geometry`);
                // Create trail data for processing
                const trailData = {
                    osm_id: trailRow.osm_id,
                    name: trailRow.name,
                    trail_type: trailRow.trail_type,
                    surface: trailRow.surface,
                    difficulty: trailRow.difficulty,
                    coordinates,
                    source_tags: typeof trailRow.source_tags === 'string'
                        ? JSON.parse(trailRow.source_tags)
                        : trailRow.source_tags,
                    region: trailRow.region
                };
                // Process trail with elevation data
                const result = await this.insertTrailAtomically(trailData);
                results.push(result);
                if (result.success) {
                    successful++;
                    console.log(`✅ Trail ${osmId} processed successfully`);
                }
                else {
                    failed++;
                    console.log(`❌ Trail ${osmId} failed: ${result.error}`);
                }
            }
            catch (error) {
                if (error instanceof Error) {
                    console.error(`❌ Error processing trail ${osmId}:`, error.message);
                    console.error(`   Stack trace: ${error.stack}`);
                }
                else {
                    console.error(`❌ Error processing trail ${osmId}:`, error);
                }
                failed++;
                results.push({
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        console.log(`\n📊 Processing complete:`);
        console.log(`   - Total: ${osmIds.length}`);
        console.log(`   - Successful: ${successful}`);
        console.log(`   - Failed: ${failed}`);
        return {
            total: osmIds.length,
            successful,
            failed,
            results
        };
    }
    async getTrailsWithoutElevation(region) {
        console.log(`🔍 Finding trails without elevation data in region: ${region}`);
        const query = `
      SELECT id, app_uuid, name, osm_id, ST_AsText(geometry) as geometry_text
      FROM public.trails
      WHERE region = $1 
        AND (elevation_gain IS NULL OR elevation_loss IS NULL 
             OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL)
      ORDER BY id
    `;
        const result = await this.client.query(query, [region]);
        console.log(`📊 Found ${result.rows.length} trails without elevation data`);
        return result.rows;
    }
    async updateTrailElevation(trailId) {
        try {
            console.log(`🔄 Updating elevation for trail ID: ${trailId}`);
            // Get trail data
            const trailQuery = `
        SELECT id, name, osm_id, ST_AsText(geometry) as geometry_text
        FROM public.trails
        WHERE id = $1
      `;
            const trailResult = await this.client.query(trailQuery, [trailId]);
            if (trailResult.rows.length === 0) {
                console.error(`❌ Trail not found: ${trailId}`);
                return false;
            }
            const trail = trailResult.rows[0];
            // Parse geometry to coordinates
            const coordinates = this.parseGeometryText(trail.geometry_text);
            if (coordinates.length === 0) {
                console.error(`❌ Failed to parse geometry for trail: ${trail.name} (${trail.osm_id})`);
                return false;
            }
            // Calculate elevation using existing method
            const elevationData = await this.processTrailElevation(coordinates);
            // Build 3D LINESTRING Z WKT
            const coordinates3D = coordinates.map((coord, i) => {
                const elevation = elevationData.elevations[i] !== undefined ? elevationData.elevations[i] : null;
                return elevation !== null ? `${coord[0]} ${coord[1]} ${elevation}` : `${coord[0]} ${coord[1]}`;
            });
            const linestring3D = `LINESTRING Z (${coordinates3D.join(', ')})`;
            // Update trail with elevation data and 3D geometry
            const updateQuery = `
        UPDATE public.trails 
        SET 
          elevation_gain = $1,
          elevation_loss = $2,
          max_elevation = $3,
          min_elevation = $4,
          avg_elevation = $5,
          geometry = ST_GeomFromText($6, 4326),
          updated_at = NOW()
        WHERE id = $7
      `;
            await this.client.query(updateQuery, [
                elevationData.elevation_gain,
                elevationData.elevation_loss,
                elevationData.max_elevation,
                elevationData.min_elevation,
                elevationData.avg_elevation,
                linestring3D,
                trailId
            ]);
            console.log(`✅ Successfully updated elevation for trail: ${trail.name}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Error updating elevation for trail ${trailId}:`, error instanceof Error ? error.message : String(error));
            return false;
        }
    }
    parseGeometryText(geometryText) {
        try {
            // Handle LINESTRING Z format: "LINESTRING Z (lng1 lat1 elev1, lng2 lat2 elev2, ...)"
            const match = geometryText.match(/LINESTRING Z? \(([^)]+)\)/i);
            if (!match) {
                console.error(`❌ Invalid geometry format: ${geometryText}`);
                return [];
            }
            const coordinates = match[1].split(',').map(coord => {
                const parts = coord.trim().split(/\s+/);
                const lng = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);
                if (isNaN(lng) || isNaN(lat)) {
                    console.error(`❌ Invalid coordinate: ${coord}`);
                    return null;
                }
                return [lng, lat];
            }).filter(coord => coord !== null);
            return coordinates;
        }
        catch (error) {
            console.error(`❌ Error parsing geometry: ${geometryText}`, error);
            return [];
        }
    }
}
exports.AtomicTrailInserter = AtomicTrailInserter;
// Example usage
async function main() {
    const args = process.argv.slice(2);
    const dbName = args.find(arg => !arg.startsWith('--')) || 'trail_master_db';
    const useFallbackElevation = args.includes('--use-fallback-elevation-sources');
    // Parse OSM IDs from command line (comma-separated)
    const osmIdsArg = args.find(arg => arg.startsWith('--osm-ids='));
    let osmIds = null;
    if (osmIdsArg && osmIdsArg.includes('=')) {
        const split = osmIdsArg.split('=');
        if (split.length > 1 && split[1]) {
            osmIds = split[1].split(',').map((id) => id.trim());
        }
    }
    console.log('🚀 Atomic Trail Insertion System');
    console.log('================================');
    console.log(`📊 Database: ${dbName}`);
    console.log(`🗻 Fallback elevation sources: ${useFallbackElevation ? 'ENABLED' : 'DISABLED'}`);
    if (osmIds) {
        console.log(`🎯 Processing specific OSM IDs: ${osmIds.join(', ')}`);
    }
    else {
        console.log(`🎯 Processing all trails in database`);
    }
    const inserter = new AtomicTrailInserter(dbName, useFallbackElevation);
    try {
        await inserter.connect();
        await inserter.loadTiffFiles();
        if (osmIds) {
            // Process specific trails by OSM IDs
            const result = await inserter.processTrailsByOsmIds(osmIds);
            console.log('\n📊 Processing Summary:');
            console.log(`   - Total trails: ${result.total}`);
            console.log(`   - Successful: ${result.successful}`);
            console.log(`   - Failed: ${result.failed}`);
            // Show cache statistics if fallback is enabled
            if (useFallbackElevation) {
                // Removed cache statistics as ElevationFallbackService is removed
                console.log(`   - Elevation cache hits: N/A`);
            }
        }
        else {
            // Example trail data for testing
            const sampleTrail = {
                osm_id: '123456789',
                name: 'Sample Trail',
                trail_type: 'hiking',
                surface: 'dirt',
                difficulty: 'moderate',
                coordinates: [
                    [-105.2705, 40.0150],
                    [-105.2706, 40.0151],
                    [-105.2707, 40.0152]
                ],
                source_tags: {
                    'highway': 'path',
                    'surface': 'dirt'
                },
                region: 'boulder'
            };
            const result = await inserter.insertTrailAtomically(sampleTrail);
            if (result.success) {
                console.log('✅ Trail inserted successfully!');
                console.log('Data quality:', result.data_quality);
            }
            else {
                console.log('❌ Trail insertion failed:', result.error);
                if (result.validation_errors) {
                    console.log('Validation errors:', result.validation_errors);
                }
            }
        }
    }
    catch (error) {
        if (error instanceof Error) {
            console.error('❌ Error:', error.message);
            console.error(`   Stack trace: ${error.stack}`);
        }
        else {
            console.error('❌ Error:', error);
        }
    }
    finally {
        await inserter.disconnect();
    }
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=carthorse-postgres-atomic-insert.js.map