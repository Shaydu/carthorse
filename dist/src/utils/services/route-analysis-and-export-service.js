"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteAnalysisAndExportService = void 0;
const route_summary_service_1 = require("./route-summary-service");
const constituent_trail_analysis_service_1 = require("./constituent-trail-analysis-service");
const sqlite_export_strategy_1 = require("../export/sqlite-export-strategy");
const geojson_export_strategy_1 = require("../export/geojson-export-strategy");
class RouteAnalysisAndExportService {
    constructor(pgClient, config) {
        this.pgClient = pgClient;
        this.config = config;
        this.summaryService = new route_summary_service_1.RouteSummaryService(this.pgClient);
        this.constituentService = new constituent_trail_analysis_service_1.ConstituentTrailAnalysisService(this.pgClient);
    }
    /**
     * Generate comprehensive route analysis
     */
    async generateRouteAnalysis() {
        console.log('📊 Generating comprehensive route analysis...');
        // Generate route summary
        const summary = await this.summaryService.generateRouteSummary(this.config.stagingSchema);
        console.log(`📊 Summary: ${summary.totalRoutes} routes generated`);
        console.log(`📊 Average distance: ${summary.averageDistance.toFixed(1)}km`);
        console.log(`📊 Average elevation: ${summary.averageElevation.toFixed(0)}m`);
        if (summary.totalRoutes > 0) {
            console.log('📋 Routes by pattern:');
            Object.entries(summary.routesByPattern).forEach(([pattern, count]) => {
                console.log(`  - ${pattern}: ${count} routes`);
            });
        }
        // Generate constituent trail analysis
        console.log('\n🔍 Generating constituent trail analysis...');
        const analyses = await this.constituentService.analyzeAllRoutes(this.config.stagingSchema);
        let constituentAnalysis = {
            totalRoutesAnalyzed: 0,
            averageTrailsPerRoute: 0,
            topRoutesByDiversity: []
        };
        if (analyses.length > 0) {
            console.log(`\n📊 CONSTITUENT TRAIL ANALYSIS SUMMARY:`);
            console.log(`Total routes analyzed: ${analyses.length}`);
            const avgTrailsPerRoute = analyses.reduce((sum, route) => sum + route.unique_trail_count, 0) / analyses.length;
            console.log(`Average trails per route: ${avgTrailsPerRoute.toFixed(1)}`);
            // Show top routes by unique trail count
            const topRoutes = analyses
                .sort((a, b) => b.unique_trail_count - a.unique_trail_count)
                .slice(0, 5);
            console.log(`\n🏆 Top 5 routes by trail diversity:`);
            topRoutes.forEach((route, index) => {
                console.log(`  ${index + 1}. ${route.route_name}`);
                console.log(`     Trails: ${route.unique_trail_count} unique trails`);
                console.log(`     Distance: ${route.out_and_back_distance_km.toFixed(2)}km`);
                console.log(`     Elevation: ${route.out_and_back_elevation_gain_m.toFixed(0)}m`);
            });
            // Export constituent analysis to JSON
            const outputPath = this.config.outputPath.replace(/\.[^.]+$/, '-constituent-analysis.json');
            await this.constituentService.exportConstituentAnalysis(analyses, outputPath);
            constituentAnalysis = {
                totalRoutesAnalyzed: analyses.length,
                averageTrailsPerRoute: avgTrailsPerRoute,
                topRoutesByDiversity: topRoutes.map(route => ({
                    route_name: route.route_name,
                    unique_trail_count: route.unique_trail_count,
                    distance: route.out_and_back_distance_km,
                    elevation: route.out_and_back_elevation_gain_m
                })),
                exportedAnalysisPath: outputPath
            };
        }
        return {
            summary,
            constituentAnalysis
        };
    }
    /**
     * Export results to specified format
     */
    async exportResults() {
        console.log('📤 Exporting results...');
        // Determine format based on output file extension
        const outputPath = this.config.outputPath;
        const isGeoJSON = outputPath.toLowerCase().endsWith('.geojson');
        const format = isGeoJSON ? 'geojson' : 'sqlite';
        console.log(`📤 Exporting to ${format.toUpperCase()} format: ${outputPath}`);
        try {
            if (format === 'sqlite') {
                // Use SQLite export strategy
                const sqliteConfig = {
                    region: 'boulder', // TODO: Get region from config
                    outputPath,
                    includeTrails: this.config.exportConfig?.includeTrails !== false,
                    includeNodes: this.config.exportConfig?.includeNodes !== false, // Default to true
                    includeEdges: this.config.exportConfig?.includeEdges !== false, // Default to true
                    includeRecommendations: this.config.exportConfig?.includeRoutes !== false, // Default to true
                    verbose: true
                };
                const sqliteExporter = new sqlite_export_strategy_1.SQLiteExportStrategy(this.pgClient, sqliteConfig, this.config.stagingSchema);
                const result = await sqliteExporter.exportFromStaging();
                if (result.isValid) {
                    // Validate export
                    const validationPassed = await this.validateExport(outputPath);
                    return {
                        success: true,
                        format,
                        outputPath,
                        validationPassed,
                        exportStats: {
                            trails: result.trailsExported,
                            nodes: result.nodesExported,
                            edges: result.edgesExported,
                            routes: result.recommendationsExported || 0,
                            routeAnalysis: result.routeAnalysisExported || 0,
                            routeTrails: result.routeTrailsExported || 0,
                            sizeMB: result.dbSizeMB
                        }
                    };
                }
                else {
                    return {
                        success: false,
                        format,
                        outputPath,
                        message: result.errors.join(', ')
                    };
                }
            }
            else {
                // Use GeoJSON export strategy
                const geojsonConfig = {
                    region: 'boulder', // TODO: Get region from config
                    outputPath,
                    includeTrails: this.config.exportConfig?.includeTrails !== false,
                    includeNodes: this.config.exportConfig?.includeNodes || false,
                    includeEdges: this.config.exportConfig?.includeEdges || false,
                    includeRecommendations: this.config.exportConfig?.includeRoutes || false,
                    verbose: true
                };
                const geojsonExporter = new geojson_export_strategy_1.GeoJSONExportStrategy(this.pgClient, geojsonConfig, this.config.stagingSchema);
                await geojsonExporter.exportFromStaging();
                console.log(`✅ GeoJSON export completed: ${outputPath}`);
                return {
                    success: true,
                    format,
                    outputPath,
                    validationPassed: true // GeoJSON doesn't need validation
                };
            }
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`❌ ${format.toUpperCase()} export failed: ${errorMsg}`);
            return {
                success: false,
                format,
                outputPath,
                message: errorMsg
            };
        }
    }
    /**
     * Validate export: comprehensive schema and data validation
     */
    async validateExport(outputPath) {
        console.log('🔍 Validating export: comprehensive schema and data validation...');
        // Only validate SQLite databases, not GeoJSON files
        const isSqliteOutput = outputPath.endsWith('.db') || outputPath.endsWith('.sqlite');
        if (!isSqliteOutput) {
            console.log('⏭️ Skipping validation for non-SQLite output format');
            console.log('✅ Export validation completed successfully!');
            return true;
        }
        try {
            // Run the standalone validation tool
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            const command = `npx ts-node src/tools/carthorse-validate-database.ts --db ${outputPath}`;
            console.log(`🔍 Running validation command: ${command}`);
            const { stdout, stderr } = await execAsync(command);
            if (stderr && stderr.length > 0) {
                console.error('❌ Validation errors:', stderr);
                return false;
            }
            console.log('✅ Export validation completed successfully!');
            console.log('📋 Validation output:');
            console.log(stdout);
            return true;
        }
        catch (error) {
            console.error('❌ Export validation failed:', error);
            return false;
        }
    }
    /**
     * Generate complete analysis and export workflow
     */
    async generateAnalysisAndExport() {
        console.log('🎯 Starting comprehensive analysis and export workflow...');
        // Generate analysis
        const analysis = await this.generateRouteAnalysis();
        // Export results
        const exportResult = await this.exportResults();
        return {
            analysis,
            export: exportResult
        };
    }
}
exports.RouteAnalysisAndExportService = RouteAnalysisAndExportService;
//# sourceMappingURL=route-analysis-and-export-service.js.map