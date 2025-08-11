#!/usr/bin/env node
"use strict";
/**
 * Network Connectivity Analysis CLI
 *
 * Analyzes trail network connectivity and identifies missing connections
 * that could improve route diversity
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const pg_1 = require("pg");
const network_connectivity_analyzer_1 = require("../utils/network-connectivity-analyzer");
const config_loader_1 = require("../utils/config-loader");
const fs = __importStar(require("fs"));
// Get database configuration
const dbConfig = (0, config_loader_1.getDatabaseConfig)();
const program = new commander_1.Command();
program
    .name('analyze-connectivity')
    .description('Analyze trail network connectivity and identify missing connections')
    .option('-r, --region <region>', 'Region to analyze (e.g., boulder)', 'boulder')
    .option('-s, --staging-schema <schema>', 'Staging schema to analyze')
    .option('--intersection-tolerance <meters>', 'Intersection detection tolerance in meters', '1.0')
    .option('--endpoint-tolerance <meters>', 'Endpoint connection tolerance in meters', '5.0')
    .option('--max-connection-distance <meters>', 'Maximum distance to consider for connections', '50.0')
    .option('--min-trail-length <meters>', 'Minimum trail length to consider', '100.0')
    .option('-o, --output <file>', 'Output file for analysis results (JSON)')
    .option('--generate-sql', 'Generate SQL to add missing connections')
    .option('--sql-output <file>', 'Output file for generated SQL')
    .option('--analyze-missing-trails', 'Analyze missing trail segments from production database', false)
    .option('--production-schema <schema>', 'Production schema name (default: public)', 'public')
    .option('--generate-trail-restoration-sql', 'Generate SQL to restore missing trail segments')
    .option('--trail-restoration-sql-output <file>', 'Output file for trail restoration SQL')
    .option('--dry-run', 'Perform dry-run analysis to visualize potential connector nodes', false)
    .option('--max-connectors <number>', 'Maximum number of connectors to analyze in dry-run', '50')
    .option('--min-impact-score <number>', 'Minimum impact score to consider in dry-run', '20')
    .option('--export-visualization <file>', 'Export visualization data as GeoJSON for mapping')
    .option('--add-connectors-to-staging', 'Add recommended connectors to staging schema (not production)', false)
    .parse(process.argv);
const options = program.opts();
async function runConnectivityAnalysis() {
    console.log(chalk_1.default.blue('🔍 Network Connectivity Analysis'));
    console.log('=====================================\n');
    // Connect to database
    const pool = new pg_1.Pool({
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        max: dbConfig.pool.max,
        idleTimeoutMillis: dbConfig.pool.idleTimeoutMillis,
        connectionTimeoutMillis: dbConfig.pool.connectionTimeoutMillis
    });
    try {
        // Auto-detect staging schema if not provided
        let stagingSchema = options.stagingSchema;
        if (!stagingSchema) {
            console.log(chalk_1.default.yellow('🔍 Auto-detecting most recent staging schema...'));
            const schemaResult = await pool.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'carthorse_%' 
        ORDER BY schema_name DESC 
        LIMIT 1
      `);
            if (schemaResult.rows.length === 0) {
                console.error(chalk_1.default.red('❌ No staging schema found!'));
                console.error(chalk_1.default.yellow('💡 Please run the orchestrator first to create a staging environment:'));
                console.error(chalk_1.default.yellow('   npx ts-node src/cli/export.ts --region boulder --routes-only'));
                process.exit(1);
            }
            stagingSchema = schemaResult.rows[0].schema_name;
            console.log(chalk_1.default.green(`✅ Using staging schema: ${stagingSchema}`));
        }
        // Create analyzer configuration
        const analyzerConfig = {
            stagingSchema,
            intersectionTolerance: parseFloat(options.intersectionTolerance),
            endpointTolerance: parseFloat(options.endpointTolerance),
            maxConnectionDistance: parseFloat(options.maxConnectionDistance),
            minTrailLength: parseFloat(options.minTrailLength),
            analyzeMissingTrails: options.analyzeMissingTrails,
            productionSchema: options.productionSchema,
            dryRunMode: options.dryRun,
            maxConnectorsToAnalyze: parseInt(options.maxConnectors),
            minImpactScore: parseInt(options.minImpactScore)
        };
        console.log(chalk_1.default.blue('📊 Analysis Configuration:'));
        console.log(`   Region: ${options.region}`);
        console.log(`   Staging Schema: ${stagingSchema}`);
        console.log(`   Intersection Tolerance: ${analyzerConfig.intersectionTolerance}m`);
        console.log(`   Endpoint Tolerance: ${analyzerConfig.endpointTolerance}m`);
        console.log(`   Max Connection Distance: ${analyzerConfig.maxConnectionDistance}m`);
        console.log(`   Min Trail Length: ${analyzerConfig.minTrailLength}m`);
        console.log(`   Analyze Missing Trails: ${analyzerConfig.analyzeMissingTrails ? 'Yes' : 'No'}`);
        console.log(`   Production Schema: ${analyzerConfig.productionSchema}`);
        console.log(`   Dry Run Mode: ${analyzerConfig.dryRunMode ? 'Yes' : 'No'}`);
        console.log(`   Max Connectors: ${analyzerConfig.maxConnectorsToAnalyze}`);
        console.log(`   Min Impact Score: ${analyzerConfig.minImpactScore}`);
        console.log('');
        // Create analyzer and run analysis
        const analyzer = new network_connectivity_analyzer_1.NetworkConnectivityAnalyzer(pool, analyzerConfig);
        if (options.dryRun) {
            // Run dry-run analysis
            console.log(chalk_1.default.blue('🔍 Running dry-run analysis...'));
            const dryRunAnalysis = await analyzer.performDryRunAnalysis();
            // Display dry-run results
            console.log(chalk_1.default.green('\n📊 Dry-Run Analysis Results:'));
            console.log('==============================');
            console.log(`🔗 Potential Connectors: ${dryRunAnalysis.potential_connectors.length}`);
            console.log(`⭐ Recommended Connectors: ${dryRunAnalysis.recommended_connectors.length}`);
            console.log('\n📈 Estimated Network Improvements:');
            console.log(`   Connectivity Score Increase: ${dryRunAnalysis.estimated_network_improvements.connectivity_score_increase.toFixed(2)}%`);
            console.log(`   Component Reduction: ${dryRunAnalysis.estimated_network_improvements.component_reduction.toFixed(1)}`);
            console.log(`   Average Path Length Decrease: ${dryRunAnalysis.estimated_network_improvements.average_path_length_decrease.toFixed(2)}km`);
            console.log(`   Network Density Increase: ${dryRunAnalysis.estimated_network_improvements.network_density_increase.toFixed(2)}%`);
            console.log(`   Route Diversity Improvement: ${dryRunAnalysis.estimated_network_improvements.route_diversity_improvement.toFixed(2)}%`);
            console.log('\n🏆 Top Recommended Connectors:');
            dryRunAnalysis.recommended_connectors.slice(0, 10).forEach((connector, i) => {
                console.log(`   ${i + 1}. ${connector.connected_trails.join(' ↔ ')} (Score: ${connector.impact_score}, Distance: ${connector.distance_meters.toFixed(1)}m)`);
                connector.benefits.forEach(benefit => {
                    console.log(`      - ${benefit}`);
                });
            });
            // Export visualization data if requested
            if (options.exportVisualization) {
                console.log(chalk_1.default.blue(`\n🗺️ Exporting visualization data to ${options.exportVisualization}...`));
                const visualizationGeoJSON = {
                    type: 'FeatureCollection',
                    features: [
                        ...dryRunAnalysis.visualization_data.connector_nodes,
                        ...dryRunAnalysis.visualization_data.connection_lines
                    ]
                };
                fs.writeFileSync(options.exportVisualization, JSON.stringify(visualizationGeoJSON, null, 2));
                console.log(chalk_1.default.green('✅ Visualization data exported successfully'));
                console.log(chalk_1.default.yellow('💡 Open this file in a mapping tool to see potential connectors'));
            }
            // Add connectors to staging if requested
            if (options.addConnectorsToStaging) {
                console.log(chalk_1.default.blue('\n🔧 Adding recommended connectors to staging schema...'));
                await addConnectorsToStaging(pool, stagingSchema, dryRunAnalysis.recommended_connectors);
                console.log(chalk_1.default.green('✅ Connectors added to staging schema'));
                console.log(chalk_1.default.yellow('💡 You can now re-run route generation to see the improvements'));
            }
            // Save dry-run results
            if (options.output) {
                console.log(chalk_1.default.blue(`\n💾 Saving dry-run results to ${options.output}...`));
                fs.writeFileSync(options.output, JSON.stringify(dryRunAnalysis, null, 2));
                console.log(chalk_1.default.green('✅ Dry-run results saved successfully'));
            }
        }
        else {
            // Run regular connectivity analysis
            const analysis = await analyzer.analyzeConnectivity();
            // Display results
            console.log(chalk_1.default.green('\n📊 Analysis Results:'));
            console.log('==================');
            console.log(`🔗 Missing Connections: ${analysis.missingConnections.length}`);
            if (analysis.missingConnections.length > 0) {
                console.log('   Examples:');
                analysis.missingConnections.slice(0, 5).forEach((conn, i) => {
                    console.log(`   ${i + 1}. ${conn.trail1_name} ↔ ${conn.trail2_name} (${conn.distance_meters.toFixed(1)}m)`);
                });
            }
            console.log(`🧩 Disconnected Components: ${analysis.disconnectedComponents.length}`);
            if (analysis.disconnectedComponents.length > 0) {
                console.log('   Components:');
                analysis.disconnectedComponents.slice(0, 3).forEach((comp, i) => {
                    console.log(`   ${i + 1}. ${comp.trail_count} trails, ${comp.total_length_km.toFixed(1)}km total`);
                });
            }
            console.log(`📊 Connectivity Score: ${analysis.connectivityScore.toFixed(2)}%`);
            // Display network metrics
            console.log('\n📈 Network Metrics:');
            console.log(`   Total Nodes: ${analysis.networkMetrics.total_nodes}`);
            console.log(`   Total Edges: ${analysis.networkMetrics.total_edges}`);
            console.log(`   Isolated Nodes: ${analysis.networkMetrics.isolated_nodes}`);
            console.log(`   Articulation Points: ${analysis.networkMetrics.articulation_points}`);
            console.log(`   Bridges: ${analysis.networkMetrics.bridges}`);
            console.log(`   Network Density: ${analysis.networkMetrics.network_density.toFixed(2)}%`);
            console.log(`   Largest Component: ${analysis.networkMetrics.largest_component_size} nodes`);
            console.log(`   Component Count: ${analysis.networkMetrics.component_count}`);
            console.log(`   Average Path Length: ${analysis.networkMetrics.average_path_length.toFixed(2)}km`);
            console.log(`   Network Diameter: ${analysis.networkMetrics.network_diameter.toFixed(2)}km`);
            // Display missing trail segments if analyzed
            if (analysis.missingTrailSegments && analysis.missingTrailSegments.length > 0) {
                console.log('\n🚫 Missing Trail Segments:');
                console.log(`   Total Lost: ${analysis.missingTrailSegments.length} trails`);
                // Group by reason
                const byReason = analysis.missingTrailSegments.reduce((acc, segment) => {
                    if (!acc[segment.reason_lost]) {
                        acc[segment.reason_lost] = [];
                    }
                    acc[segment.reason_lost].push(segment);
                    return acc;
                }, {});
                Object.entries(byReason).forEach(([reason, segments]) => {
                    console.log(`   ${reason}: ${segments.length} trails`);
                    segments.slice(0, 3).forEach(segment => {
                        console.log(`     - ${segment.name} (${segment.length_km.toFixed(2)}km, ${segment.elevation_gain}m gain)`);
                    });
                });
            }
            // Display recommendations
            console.log('\n💡 Recommendations:');
            console.log('==================');
            analysis.recommendations.forEach((rec, i) => {
                console.log(`${i + 1}. ${rec}`);
            });
            // Save results to file if requested
            if (options.output) {
                console.log(chalk_1.default.blue(`\n💾 Saving results to ${options.output}...`));
                fs.writeFileSync(options.output, JSON.stringify(analysis, null, 2));
                console.log(chalk_1.default.green('✅ Results saved successfully'));
            }
            // Generate SQL for missing connections if requested
            if (options.generateSql && analysis.missingConnections.length > 0) {
                const sqlOutput = options.sqlOutput || 'missing-connections.sql';
                console.log(chalk_1.default.blue(`\n🔧 Generating SQL for missing connections...`));
                const connectionSQL = await analyzer.generateConnectionSQL(analysis.missingConnections);
                fs.writeFileSync(sqlOutput, connectionSQL);
                console.log(chalk_1.default.green(`✅ SQL saved to ${sqlOutput}`));
            }
            // Generate SQL for trail restoration if requested
            if (options.generateTrailRestorationSql && analysis.missingTrailSegments && analysis.missingTrailSegments.length > 0) {
                const restorationOutput = options.trailRestorationSqlOutput || 'trail-restoration.sql';
                console.log(chalk_1.default.blue(`\n🔧 Generating SQL for trail restoration...`));
                const restorationSQL = await analyzer.generateTrailRestorationSQL(analysis.missingTrailSegments);
                fs.writeFileSync(restorationOutput, restorationSQL);
                console.log(chalk_1.default.green(`✅ Trail restoration SQL saved to ${restorationOutput}`));
            }
        }
        console.log(chalk_1.default.green('\n✅ Analysis complete!'));
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Analysis failed:'), error);
        process.exit(1);
    }
    finally {
        await pool.end();
    }
}
/**
 * Add recommended connectors to staging schema
 */
async function addConnectorsToStaging(pool, stagingSchema, connectors) {
    console.log(`🔧 Adding ${connectors.length} connectors to staging schema...`);
    for (const connector of connectors) {
        // Create a new trail entry for the connector
        const connectorTrailId = `connector-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Extract trail IDs from connector ID
        const trailIds = connector.id.replace('connector-', '').split('-');
        const trail1Id = trailIds[0];
        const trail2Id = trailIds[1];
        // Create geometry for the connector (simple line between endpoints)
        const [lon1, lat1] = connector.position;
        const [lon2, lat2] = connector.position; // For now, use same point - in real implementation you'd get actual endpoints
        const geometry = `LINESTRING(${lon1} ${lat1}, ${lon2} ${lat2})`;
        // Insert into trails table
        await pool.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        ST_GeomFromText($7, 4326), $8, $9, $10,
        $11, $12, $13, $14
      )
    `, [
            connectorTrailId,
            `Connector: ${connector.connected_trails.join(' ↔ ')}`,
            'boulder', // TODO: get from config
            'hiking',
            'dirt',
            'moderate',
            geometry,
            connector.distance_meters / 1000, // Convert to km
            0, // elevation_gain
            0, // elevation_loss
            Math.min(lon1, lon2),
            Math.max(lon1, lon2),
            Math.min(lat1, lat2),
            Math.max(lat1, lat2)
        ]);
        console.log(`   ✅ Added connector: ${connector.connected_trails.join(' ↔ ')}`);
    }
}
// Run the analysis
runConnectivityAnalysis();
//# sourceMappingURL=analyze-connectivity.js.map