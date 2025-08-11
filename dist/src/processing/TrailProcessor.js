"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresTrailProcessor = void 0;
const queries_1 = require("../sql/queries");
class PostgresTrailProcessor {
    constructor(databaseService) {
        this.databaseService = databaseService;
    }
    async processTrails(schemaName, region, bbox) {
        console.log(`🛤️ Processing trails for region '${region}'${bbox ? ' with bbox filter' : ''}`);
        try {
            // Validate trail data
            const validationResult = await this.validateTrailsForRouting(schemaName);
            if (!validationResult.isValid) {
                return {
                    success: false,
                    trailsProcessed: validationResult.stats.totalTrails,
                    validTrails: validationResult.stats.validTrails,
                    invalidTrails: validationResult.stats.invalidTrails,
                    errors: validationResult.errors,
                    warnings: validationResult.warnings
                };
            }
            // Calculate trail statistics
            const stats = await this.calculateTrailStats(schemaName);
            console.log(`✅ Trail processing completed successfully`);
            console.log(`📊 Processed ${stats.totalTrails} trails`);
            console.log(`   - Valid trails: ${stats.validTrails}`);
            console.log(`   - Invalid trails: ${stats.invalidTrails}`);
            console.log(`   - Average length: ${stats.avgLength.toFixed(2)}km`);
            console.log(`   - Average elevation gain: ${stats.avgElevationGain.toFixed(1)}m`);
            console.log(`   - Average elevation loss: ${stats.avgElevationLoss.toFixed(1)}m`);
            return {
                success: true,
                trailsProcessed: stats.totalTrails,
                validTrails: stats.validTrails,
                invalidTrails: stats.invalidTrails,
                errors: validationResult.errors,
                warnings: validationResult.warnings
            };
        }
        catch (error) {
            console.error('❌ Trail processing failed:', error);
            return {
                success: false,
                trailsProcessed: 0,
                validTrails: 0,
                invalidTrails: 0,
                errors: [error instanceof Error ? error.message : String(error)],
                warnings: []
            };
        }
    }
    async validateTrailsForRouting(schemaName) {
        console.log(`🔍 Validating trails for routing in schema '${schemaName}'`);
        const result = await this.databaseService.executeQuery(queries_1.StagingQueries.validateTrailsForRouting(schemaName));
        const stats = result.rows[0];
        const validationStats = {
            totalTrails: parseInt(stats.total_trails),
            validTrails: 0,
            invalidTrails: 0,
            nullGeometry: parseInt(stats.null_geometry),
            invalidGeometry: parseInt(stats.invalid_geometry),
            zeroOrNullLength: parseInt(stats.zero_or_null_length),
            selfLoops: parseInt(stats.self_loops),
            zeroLengthGeometry: parseInt(stats.zero_length_geometry),
            singlePointGeometry: parseInt(stats.single_point_geometry),
            avgLength: 0,
            avgElevationGain: 0,
            avgElevationLoss: 0
        };
        // Calculate valid/invalid trails
        const criticalIssues = validationStats.nullGeometry + validationStats.invalidGeometry +
            validationStats.zeroLengthGeometry + validationStats.singlePointGeometry;
        validationStats.validTrails = validationStats.totalTrails - criticalIssues;
        validationStats.invalidTrails = criticalIssues;
        const errors = [];
        const warnings = [];
        // Check for critical issues
        if (validationStats.nullGeometry > 0) {
            errors.push(`${validationStats.nullGeometry} trails have null geometry`);
        }
        if (validationStats.invalidGeometry > 0) {
            errors.push(`${validationStats.invalidGeometry} trails have invalid geometry`);
        }
        if (validationStats.zeroLengthGeometry > 0) {
            errors.push(`${validationStats.zeroLengthGeometry} trails have zero length geometry`);
        }
        if (validationStats.singlePointGeometry > 0) {
            errors.push(`${validationStats.singlePointGeometry} trails are single points`);
        }
        // Check for warnings
        if (validationStats.zeroOrNullLength > 0) {
            warnings.push(`${validationStats.zeroOrNullLength} trails have zero or null length`);
        }
        if (validationStats.selfLoops > 0) {
            warnings.push(`${validationStats.selfLoops} trails are self-loops (start = end)`);
        }
        let isValid = errors.length === 0;
        console.log(`📊 Trail validation results:`);
        console.log(`   Total trails: ${validationStats.totalTrails}`);
        console.log(`   Valid trails: ${validationStats.validTrails}`);
        console.log(`   Invalid trails: ${validationStats.invalidTrails}`);
        console.log(`   Null geometry: ${validationStats.nullGeometry}`);
        console.log(`   Invalid geometry: ${validationStats.invalidGeometry}`);
        console.log(`   Zero/null length: ${validationStats.zeroOrNullLength}`);
        console.log(`   Self-loops: ${validationStats.selfLoops}`);
        console.log(`   Zero length geometry: ${validationStats.zeroLengthGeometry}`);
        console.log(`   Single point geometry: ${validationStats.singlePointGeometry}`);
        if (errors.length > 0) {
            console.error(`❌ Validation errors: ${errors.join(', ')}`);
        }
        if (warnings.length > 0) {
            console.warn(`⚠️  Validation warnings: ${warnings.join(', ')}`);
        }
        // Fail if no valid trails remain
        if (validationStats.validTrails === 0) {
            errors.push(`No valid trails found for routing graph generation. All ${validationStats.totalTrails} trails have issues that prevent edge creation`);
            isValid = false;
        }
        return {
            isValid,
            errors,
            warnings,
            stats: validationStats
        };
    }
    async calculateTrailStats(schemaName) {
        console.log(`📊 Calculating trail statistics for schema '${schemaName}'`);
        const result = await this.databaseService.executeQuery(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN geometry IS NOT NULL AND ST_IsValid(geometry) AND length_km > 0 THEN 1 END) as valid_trails,
        COUNT(CASE WHEN geometry IS NULL OR NOT ST_IsValid(geometry) OR length_km <= 0 THEN 1 END) as invalid_trails,
        COUNT(CASE WHEN geometry IS NULL THEN 1 END) as null_geometry,
        COUNT(CASE WHEN NOT ST_IsValid(geometry) THEN 1 END) as invalid_geometry,
        COUNT(CASE WHEN length_km IS NULL OR length_km <= 0 THEN 1 END) as zero_or_null_length,
        COUNT(CASE WHEN ST_StartPoint(geometry) = ST_EndPoint(geometry) THEN 1 END) as self_loops,
        COUNT(CASE WHEN ST_Length(geometry) = 0 THEN 1 END) as zero_length_geometry,
        COUNT(CASE WHEN ST_NumPoints(geometry) < 2 THEN 1 END) as single_point_geometry,
        AVG(length_km) as avg_length,
        AVG(elevation_gain) as avg_elevation_gain,
        AVG(elevation_loss) as avg_elevation_loss
      FROM ${schemaName}.trails
    `);
        const stats = result.rows[0];
        return {
            totalTrails: parseInt(stats.total_trails),
            validTrails: parseInt(stats.valid_trails),
            invalidTrails: parseInt(stats.invalid_trails),
            nullGeometry: parseInt(stats.null_geometry),
            invalidGeometry: parseInt(stats.invalid_geometry),
            zeroOrNullLength: parseInt(stats.zero_or_null_length),
            selfLoops: parseInt(stats.self_loops),
            zeroLengthGeometry: parseInt(stats.zero_length_geometry),
            singlePointGeometry: parseInt(stats.single_point_geometry),
            avgLength: parseFloat(stats.avg_length) || 0,
            avgElevationGain: parseFloat(stats.avg_elevation_gain) || 0,
            avgElevationLoss: parseFloat(stats.avg_elevation_loss) || 0
        };
    }
    async getTrailDetails(schemaName, limit = 10) {
        console.log(`🔍 Getting trail details for schema '${schemaName}' (limit: ${limit})`);
        const result = await this.databaseService.executeQuery(queries_1.StagingQueries.getTrailDetails(schemaName, limit), [limit]);
        console.log(`✅ Retrieved ${result.rows.length} trail details`);
        return result.rows;
    }
}
exports.PostgresTrailProcessor = PostgresTrailProcessor;
//# sourceMappingURL=TrailProcessor.js.map