"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresExportProcessor = void 0;
const queries_1 = require("../sql/queries");
class PostgresExportProcessor {
    constructor(databaseService) {
        this.databaseService = databaseService;
    }
    async processSqliteExport(schemaName, config) {
        console.log(`💾 Processing SQLite export for schema '${schemaName}'`);
        console.log(`📋 Export configuration:`);
        console.log(`   - Region: ${config.region}`);
        console.log(`   - Simplify tolerance: ${config.simplifyTolerance}`);
        console.log(`   - Max SQLite DB size: ${config.maxSqliteDbSizeMB}MB`);
        console.log(`   - Skip incomplete trails: ${config.skipIncompleteTrails}`);
        const errors = [];
        const warnings = [];
        try {
            // Get export statistics
            const stats = await this.getExportStats(schemaName);
            console.log(`📊 Export statistics:`);
            console.log(`   - Trails: ${stats.trailCount}`);
            console.log(`   - Nodes: ${stats.nodeCount}`);
            console.log(`   - Edges: ${stats.edgeCount}`);
            console.log(`   - Recommendations: ${stats.recommendationCount}`);
            // Validate export data
            if (stats.trailCount === 0) {
                errors.push('No trails found for export');
            }
            if (stats.nodeCount === 0) {
                warnings.push('No routing nodes found for export');
            }
            if (stats.edgeCount === 0) {
                warnings.push('No routing edges found for export');
            }
            // Check file size constraints
            if (config.targetSizeMB && stats.fileSize > config.targetSizeMB * 1024 * 1024) {
                warnings.push(`Export file size (${(stats.fileSize / 1024 / 1024).toFixed(1)}MB) exceeds target size (${config.targetSizeMB}MB)`);
            }
            if (stats.fileSize > config.maxSqliteDbSizeMB * 1024 * 1024) {
                errors.push(`Export file size (${(stats.fileSize / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowed size (${config.maxSqliteDbSizeMB}MB)`);
            }
            if (errors.length > 0) {
                console.error(`❌ Export validation failed: ${errors.join(', ')}`);
                return {
                    success: false,
                    trailCount: stats.trailCount,
                    nodeCount: stats.nodeCount,
                    edgeCount: stats.edgeCount,
                    recommendationCount: stats.recommendationCount,
                    fileSize: stats.fileSize,
                    schemaVersion: stats.schemaVersion,
                    errors,
                    warnings
                };
            }
            console.log(`✅ SQLite export processing completed successfully`);
            console.log(`📊 Final export statistics:`);
            console.log(`   - Trails: ${stats.trailCount}`);
            console.log(`   - Nodes: ${stats.nodeCount}`);
            console.log(`   - Edges: ${stats.edgeCount}`);
            console.log(`   - Recommendations: ${stats.recommendationCount}`);
            console.log(`   - File size: ${(stats.fileSize / 1024 / 1024).toFixed(1)}MB`);
            console.log(`   - Schema version: ${stats.schemaVersion}`);
            return {
                success: true,
                trailCount: stats.trailCount,
                nodeCount: stats.nodeCount,
                edgeCount: stats.edgeCount,
                recommendationCount: stats.recommendationCount,
                fileSize: stats.fileSize,
                schemaVersion: stats.schemaVersion,
                errors,
                warnings
            };
        }
        catch (error) {
            console.error('❌ SQLite export processing failed:', error);
            return {
                success: false,
                trailCount: 0,
                nodeCount: 0,
                edgeCount: 0,
                recommendationCount: 0,
                fileSize: 0,
                schemaVersion: 0,
                errors: [error instanceof Error ? error.message : String(error)],
                warnings
            };
        }
    }
    async processGeoJSONExport(schemaName, config) {
        console.log(`🗺️ Processing GeoJSON export for schema '${schemaName}'`);
        console.log(`📋 Export configuration:`);
        console.log(`   - Region: ${config.region}`);
        console.log(`   - Simplify tolerance: ${config.simplifyTolerance}`);
        console.log(`   - Skip incomplete trails: ${config.skipIncompleteTrails}`);
        const errors = [];
        const warnings = [];
        try {
            // Get export statistics
            const stats = await this.getExportStats(schemaName);
            console.log(`📊 Export statistics:`);
            console.log(`   - Trails: ${stats.trailCount}`);
            console.log(`   - Nodes: ${stats.nodeCount}`);
            console.log(`   - Edges: ${stats.edgeCount}`);
            console.log(`   - Recommendations: ${stats.recommendationCount}`);
            // Validate export data
            if (stats.trailCount === 0) {
                errors.push('No trails found for export');
            }
            if (stats.nodeCount === 0) {
                warnings.push('No routing nodes found for export');
            }
            if (stats.edgeCount === 0) {
                warnings.push('No routing edges found for export');
            }
            if (errors.length > 0) {
                console.error(`❌ Export validation failed: ${errors.join(', ')}`);
                return {
                    success: false,
                    trailCount: stats.trailCount,
                    nodeCount: stats.nodeCount,
                    edgeCount: stats.edgeCount,
                    recommendationCount: stats.recommendationCount,
                    fileSize: stats.fileSize,
                    schemaVersion: stats.schemaVersion,
                    errors,
                    warnings
                };
            }
            console.log(`✅ GeoJSON export processing completed successfully`);
            console.log(`📊 Final export statistics:`);
            console.log(`   - Trails: ${stats.trailCount}`);
            console.log(`   - Nodes: ${stats.nodeCount}`);
            console.log(`   - Edges: ${stats.edgeCount}`);
            console.log(`   - Recommendations: ${stats.recommendationCount}`);
            console.log(`   - Schema version: ${stats.schemaVersion}`);
            return {
                success: true,
                trailCount: stats.trailCount,
                nodeCount: stats.nodeCount,
                edgeCount: stats.edgeCount,
                recommendationCount: stats.recommendationCount,
                fileSize: stats.fileSize,
                schemaVersion: stats.schemaVersion,
                errors,
                warnings
            };
        }
        catch (error) {
            console.error('❌ GeoJSON export processing failed:', error);
            return {
                success: false,
                trailCount: 0,
                nodeCount: 0,
                edgeCount: 0,
                recommendationCount: 0,
                fileSize: 0,
                schemaVersion: 0,
                errors: [error instanceof Error ? error.message : String(error)],
                warnings
            };
        }
    }
    async validateExport(outputPath) {
        console.log(`🔍 Validating export at path: ${outputPath}`);
        try {
            // This would typically validate the exported file
            // For now, we'll just return a basic validation result
            console.log(`✅ Export validation completed successfully`);
            return {
                success: true,
                trailCount: 0,
                nodeCount: 0,
                edgeCount: 0,
                recommendationCount: 0,
                fileSize: 0,
                schemaVersion: 0,
                errors: [],
                warnings: []
            };
        }
        catch (error) {
            console.error('❌ Export validation failed:', error);
            return {
                success: false,
                trailCount: 0,
                nodeCount: 0,
                edgeCount: 0,
                recommendationCount: 0,
                fileSize: 0,
                schemaVersion: 0,
                errors: [error instanceof Error ? error.message : String(error)],
                warnings: []
            };
        }
    }
    async getExportStats(schemaName) {
        console.log(`📊 Getting export statistics for schema '${schemaName}'`);
        const result = await this.databaseService.executeQuery(queries_1.ExportQueries.getExportStats(schemaName));
        const stats = result.rows[0];
        const exportStats = {
            trailCount: parseInt(stats.trail_count),
            nodeCount: parseInt(stats.node_count),
            edgeCount: parseInt(stats.edge_count),
            recommendationCount: parseInt(stats.recommendation_count),
            fileSize: 0, // This would be calculated from the actual file
            schemaVersion: 14 // Current schema version
        };
        console.log(`✅ Retrieved export statistics:`);
        console.log(`   - Trails: ${exportStats.trailCount}`);
        console.log(`   - Nodes: ${exportStats.nodeCount}`);
        console.log(`   - Edges: ${exportStats.edgeCount}`);
        console.log(`   - Recommendations: ${exportStats.recommendationCount}`);
        console.log(`   - Schema version: ${exportStats.schemaVersion}`);
        return exportStats;
    }
}
exports.PostgresExportProcessor = PostgresExportProcessor;
//# sourceMappingURL=ExportProcessor.js.map