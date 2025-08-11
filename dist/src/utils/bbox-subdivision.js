"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BboxSubdivider = void 0;
exports.createBboxSubdivider = createBboxSubdivider;
class BboxSubdivider {
    constructor(pgClient) {
        this.pgClient = pgClient;
    }
    /**
     * Subdivide a region into smaller bbox chunks based on trail density
     */
    async subdivideRegion(config) {
        const { region, maxTrailsPerChunk = 1000, overlapPercentage = 0.1, minChunkSize = 100 } = config;
        console.log(`🗺️ Subdividing region '${region}' into chunks of max ${maxTrailsPerChunk} trails each...`);
        // Get the overall bbox for the region
        const regionBbox = await this.pgClient.query(`
      SELECT 
        ST_XMin(ST_Extent(geometry)) as min_lng,
        ST_YMin(ST_Extent(geometry)) as min_lat,
        ST_XMax(ST_Extent(geometry)) as max_lng,
        ST_YMax(ST_Extent(geometry)) as max_lat,
        COUNT(*) as total_trails
      FROM public.trails 
      WHERE region = $1
    `, [region]);
        if (regionBbox.rows.length === 0 || regionBbox.rows[0].total_trails === 0) {
            throw new Error(`No trails found for region '${region}'`);
        }
        const bbox = regionBbox.rows[0];
        const totalTrails = parseInt(bbox.total_trails);
        console.log(`📊 Region bbox: [${bbox.min_lng}, ${bbox.min_lat}, ${bbox.max_lng}, ${bbox.max_lat}]`);
        console.log(`📊 Total trails: ${totalTrails}`);
        if (totalTrails <= maxTrailsPerChunk) {
            // No subdivision needed
            return [{
                    id: `${region}-single`,
                    bbox: [bbox.min_lng, bbox.min_lat, bbox.max_lng, bbox.max_lat],
                    name: `${region}-single`
                }];
        }
        // Calculate grid dimensions
        const numChunks = Math.ceil(totalTrails / maxTrailsPerChunk);
        const gridSize = Math.ceil(Math.sqrt(numChunks));
        console.log(`🔲 Creating ${gridSize}x${gridSize} grid (${gridSize * gridSize} potential chunks)`);
        const subdivisions = [];
        const lngStep = (bbox.max_lng - bbox.min_lng) / gridSize;
        const latStep = (bbox.max_lat - bbox.min_lat) / gridSize;
        // Add overlap
        const lngOverlap = lngStep * overlapPercentage;
        const latOverlap = latStep * overlapPercentage;
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const minLng = bbox.min_lng + (i * lngStep) - lngOverlap;
                const maxLng = bbox.min_lng + ((i + 1) * lngStep) + lngOverlap;
                const minLat = bbox.min_lat + (j * latStep) - latOverlap;
                const maxLat = bbox.min_lat + ((j + 1) * latStep) + latOverlap;
                // Count trails in this bbox
                const trailCount = await this.pgClient.query(`
          SELECT COUNT(*) as count
          FROM public.trails 
          WHERE region = $1
            AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))
        `, [region, minLng, minLat, maxLng, maxLat]);
                const count = parseInt(trailCount.rows[0].count);
                if (count >= minChunkSize) {
                    subdivisions.push({
                        id: `${region}-chunk-${i}-${j}`,
                        bbox: [minLng, minLat, maxLng, maxLat],
                        name: `${region}-chunk-${i}-${j}`
                    });
                    console.log(`✅ Chunk ${i}-${j}: ${count} trails in bbox [${minLng.toFixed(4)}, ${minLat.toFixed(4)}, ${maxLng.toFixed(4)}, ${maxLat.toFixed(4)}]`);
                }
                else if (count > 0) {
                    console.log(`⚠️ Chunk ${i}-${j}: ${count} trails (below minimum ${minChunkSize}, skipping)`);
                }
            }
        }
        console.log(`✅ Created ${subdivisions.length} subdivisions for region '${region}'`);
        return subdivisions;
    }
    /**
     * Process a single bbox subdivision
     */
    async processSubdivision(subdivision, stagingSchema, region) {
        console.log(`🔧 Processing subdivision: ${subdivision.name}`);
        try {
            // Create staging schema for this subdivision
            await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
            // Copy trails within this bbox to staging
            const result = await this.pgClient.query(`
        CREATE TABLE ${stagingSchema}.trails AS
        SELECT * FROM public.trails 
        WHERE region = $1
          AND ST_Intersects(geometry, ST_MakeEnvelope($2, $3, $4, $5, 4326))
      `, [region, ...subdivision.bbox]);
            const trailCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${stagingSchema}.trails
      `);
            console.log(`✅ Subdivision ${subdivision.name}: ${trailCount.rows[0].count} trails copied to staging`);
            return {
                success: true,
                trailCount: parseInt(trailCount.rows[0].count),
                errors: []
            };
        }
        catch (error) {
            console.error(`❌ Error processing subdivision ${subdivision.name}:`, error);
            return {
                success: false,
                trailCount: 0,
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
    }
    /**
     * Subdivide existing staging data into smaller chunks
     */
    async subdivideStagingData(sourceStagingSchema, maxTrailsPerChunk = 500, minChunkSize = 50) {
        console.log(`🗺️ Subdividing staging data from '${sourceStagingSchema}' into chunks of max ${maxTrailsPerChunk} trails each...`);
        // Get the overall bbox for the staging data
        const stagingBbox = await this.pgClient.query(`
      SELECT 
        ST_XMin(ST_Extent(geometry)) as min_lng,
        ST_YMin(ST_Extent(geometry)) as min_lat,
        ST_XMax(ST_Extent(geometry)) as max_lng,
        ST_YMax(ST_Extent(geometry)) as max_lat,
        COUNT(*) as total_trails
      FROM ${sourceStagingSchema}.trails
    `);
        if (stagingBbox.rows.length === 0 || stagingBbox.rows[0].total_trails === 0) {
            throw new Error(`No trails found in staging schema '${sourceStagingSchema}'`);
        }
        const bbox = stagingBbox.rows[0];
        const totalTrails = parseInt(bbox.total_trails);
        console.log(`📊 Staging bbox: [${bbox.min_lng}, ${bbox.min_lat}, ${bbox.max_lng}, ${bbox.max_lat}]`);
        console.log(`📊 Total trails: ${totalTrails}`);
        if (totalTrails <= maxTrailsPerChunk) {
            // No subdivision needed
            return [{
                    id: `${sourceStagingSchema}-single`,
                    bbox: [bbox.min_lng, bbox.min_lat, bbox.max_lng, bbox.max_lat],
                    name: `${sourceStagingSchema}-single`
                }];
        }
        // Calculate grid dimensions
        const numChunks = Math.ceil(totalTrails / maxTrailsPerChunk);
        const gridSize = Math.ceil(Math.sqrt(numChunks));
        console.log(`🔲 Creating ${gridSize}x${gridSize} grid (${gridSize * gridSize} potential chunks)`);
        const subdivisions = [];
        const lngStep = (bbox.max_lng - bbox.min_lng) / gridSize;
        const latStep = (bbox.max_lat - bbox.min_lat) / gridSize;
        // Add overlap
        const overlapPercentage = 0.1;
        const lngOverlap = lngStep * overlapPercentage;
        const latOverlap = latStep * overlapPercentage;
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const minLng = bbox.min_lng + (i * lngStep) - lngOverlap;
                const maxLng = bbox.min_lng + ((i + 1) * lngStep) + lngOverlap;
                const minLat = bbox.min_lat + (j * latStep) - latOverlap;
                const maxLat = bbox.min_lat + ((j + 1) * latStep) + latOverlap;
                // Count trails in this bbox
                const trailCount = await this.pgClient.query(`
          SELECT COUNT(*) as count
          FROM ${sourceStagingSchema}.trails 
          WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
        `, [minLng, minLat, maxLng, maxLat]);
                const count = parseInt(trailCount.rows[0].count);
                if (count >= minChunkSize) {
                    subdivisions.push({
                        id: `${sourceStagingSchema}-chunk-${i}-${j}`,
                        bbox: [minLng, minLat, maxLng, maxLat],
                        name: `${sourceStagingSchema}-chunk-${i}-${j}`
                    });
                    console.log(`✅ Chunk ${i}-${j}: ${count} trails in bbox [${minLng.toFixed(4)}, ${minLat.toFixed(4)}, ${maxLng.toFixed(4)}, ${maxLat.toFixed(4)}]`);
                }
                else if (count > 0) {
                    console.log(`⚠️ Chunk ${i}-${j}: ${count} trails (below minimum ${minChunkSize}, skipping)`);
                }
            }
        }
        console.log(`✅ Created ${subdivisions.length} subdivisions from staging data`);
        return subdivisions;
    }
    /**
     * Process a staging subdivision (copy from source staging to new staging)
     */
    async processStagingSubdivision(subdivision, sourceStagingSchema, targetStagingSchema) {
        console.log(`🔧 Processing staging subdivision: ${subdivision.name}`);
        try {
            // Create target staging schema
            await this.pgClient.query(`CREATE SCHEMA IF NOT EXISTS ${targetStagingSchema}`);
            // Copy trails within this bbox from source staging to target staging
            const result = await this.pgClient.query(`
        CREATE TABLE ${targetStagingSchema}.trails AS
        SELECT * FROM ${sourceStagingSchema}.trails 
        WHERE ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      `, subdivision.bbox);
            const trailCount = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${targetStagingSchema}.trails
      `);
            console.log(`✅ Staging subdivision ${subdivision.name}: ${trailCount.rows[0].count} trails copied`);
            return {
                success: true,
                trailCount: parseInt(trailCount.rows[0].count),
                errors: []
            };
        }
        catch (error) {
            console.error(`❌ Error processing staging subdivision ${subdivision.name}:`, error);
            return {
                success: false,
                trailCount: 0,
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
    }
    /**
     * Clean up staging schemas
     */
    async cleanupSubdivisions(subdivisions) {
        console.log('🧹 Cleaning up subdivision staging schemas...');
        for (const subdivision of subdivisions) {
            const stagingSchema = `staging_${subdivision.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
            try {
                await this.pgClient.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
            }
            catch (error) {
                console.warn(`⚠️ Could not drop schema ${stagingSchema}:`, error);
            }
        }
        console.log('✅ Cleanup completed');
    }
}
exports.BboxSubdivider = BboxSubdivider;
/**
 * Create a BboxSubdivider instance
 */
function createBboxSubdivider(pgClient) {
    return new BboxSubdivider(pgClient);
}
//# sourceMappingURL=bbox-subdivision.js.map