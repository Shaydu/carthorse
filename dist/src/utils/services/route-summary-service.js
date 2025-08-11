"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteSummaryService = void 0;
class RouteSummaryService {
    constructor(pgClient) {
        this.pgClient = pgClient;
    }
    /**
     * Generate summary for a single staging schema
     */
    async generateRouteSummary(stagingSchema) {
        console.log(`📊 Generating route summary for ${stagingSchema}...`);
        // Check if route_recommendations table exists
        const tableExists = await this.pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = 'route_recommendations'
      )
    `, [stagingSchema]);
        if (!tableExists.rows[0].exists) {
            return {
                totalRoutes: 0,
                routesByPattern: {},
                averageDistance: 0,
                averageElevation: 0,
                topRoutes: [],
                region: 'unknown'
            };
        }
        // Get route recommendations
        const routesResult = await this.pgClient.query(`
      SELECT 
        route_name,
        route_shape,
        recommended_length_km,
        recommended_elevation_gain,
        route_score,
        region
      FROM ${stagingSchema}.route_recommendations
      ORDER BY route_score DESC
    `);
        const routes = routesResult.rows;
        // Calculate summary statistics
        const routesByPattern = {};
        let totalDistance = 0;
        let totalElevation = 0;
        for (const route of routes) {
            const pattern = route.route_name.split(' - ')[0];
            routesByPattern[pattern] = (routesByPattern[pattern] || 0) + 1;
            totalDistance += route.recommended_length_km || 0;
            totalElevation += route.recommended_elevation_gain || 0;
        }
        const summary = {
            totalRoutes: routes.length,
            routesByPattern,
            averageDistance: routes.length > 0 ? totalDistance / routes.length : 0,
            averageElevation: routes.length > 0 ? totalElevation / routes.length : 0,
            topRoutes: routes.slice(0, 5), // Top 5 routes by score
            region: routes.length > 0 ? routes[0].region : 'unknown'
        };
        return summary;
    }
    /**
     * Generate comprehensive summary across multiple subdivisions
     */
    async generateComprehensiveSummary(results) {
        console.log('\n📊 Processing Summary:');
        console.log('=====================');
        const successfulSubdivisions = results.filter(r => r.success && r.routingSuccess);
        const failedSubdivisions = results.filter(r => !r.success || !r.routingSuccess);
        console.log(`✅ Successful subdivisions: ${successfulSubdivisions.length}/${results.length}`);
        console.log(`❌ Failed subdivisions: ${failedSubdivisions.length}/${results.length}`);
        if (successfulSubdivisions.length > 0) {
            const totalTrails = successfulSubdivisions.reduce((sum, r) => sum + r.finalCount, 0);
            const totalRoutes = successfulSubdivisions.reduce((sum, r) => sum + (r.routeRecommendationsCount || 0), 0);
            console.log(`📊 Total trails processed: ${totalTrails}`);
            console.log(`🛤️ Total route recommendations generated: ${totalRoutes}`);
            console.log('\n📋 Successful subdivisions:');
            successfulSubdivisions.forEach(r => {
                console.log(`  ✅ ${r.subdivision}: ${r.finalCount} trails, ${r.routeRecommendationsCount || 0} routes`);
            });
        }
        if (failedSubdivisions.length > 0) {
            console.log('\n❌ Failed subdivisions:');
            failedSubdivisions.forEach(r => {
                const errorMsg = r.errors ? r.errors.join(', ') : r.routingError || 'Unknown error';
                console.log(`  ❌ ${r.subdivision}: ${errorMsg}`);
            });
        }
    }
    /**
     * Generate per-subdivision route summary
     */
    async generateSubdivisionRouteSummary(subdivision, routeRecommendations) {
        console.log(`📊 Route recommendations summary for ${subdivision}:`);
        // Group routes by pattern
        const routeSummary = routeRecommendations.reduce((acc, rec) => {
            const pattern = rec.route_name.split(' - ')[0];
            if (!acc[pattern])
                acc[pattern] = 0;
            acc[pattern]++;
            return acc;
        }, {});
        Object.entries(routeSummary).forEach(([pattern, count]) => {
            console.log(`   - ${pattern}: ${count} routes`);
        });
    }
    /**
     * Check route recommendations in all staging schemas
     */
    async checkAllStagingSchemas() {
        console.log('🔍 Checking route recommendations in all staging schemas...');
        // Find all staging schemas
        const schemasResult = await this.pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'staging_%'
      ORDER BY schema_name DESC
    `);
        console.log(`Found ${schemasResult.rows.length} staging schemas:`);
        for (const row of schemasResult.rows) {
            const schemaName = row.schema_name;
            console.log(`\n📋 Checking schema: ${schemaName}`);
            const summary = await this.generateRouteSummary(schemaName);
            if (summary.totalRoutes > 0) {
                console.log(`  ✅ ${summary.totalRoutes} route recommendations found`);
                console.log(`  📊 Average distance: ${summary.averageDistance.toFixed(1)}km`);
                console.log(`  📊 Average elevation: ${summary.averageElevation.toFixed(0)}m`);
                console.log('  📋 Routes by pattern:');
                Object.entries(summary.routesByPattern).forEach(([pattern, count]) => {
                    console.log(`    - ${pattern}: ${count} routes`);
                });
            }
            else {
                console.log(`  ❌ No route recommendations found`);
            }
        }
    }
    /**
     * Export summary to JSON file
     */
    async exportSummaryToJson(results, outputPath) {
        const summary = {
            timestamp: new Date().toISOString(),
            totalSubdivisions: results.length,
            successfulSubdivisions: results.filter(r => r.success && r.routingSuccess).length,
            failedSubdivisions: results.filter(r => !r.success || !r.routingSuccess).length,
            totalTrails: results.reduce((sum, r) => sum + r.finalCount, 0),
            totalRoutes: results.reduce((sum, r) => sum + (r.routeRecommendationsCount || 0), 0),
            subdivisions: results.map(r => ({
                name: r.subdivision,
                success: r.success,
                routingSuccess: r.routingSuccess,
                trailCount: r.finalCount,
                routeCount: r.routeRecommendationsCount || 0,
                error: r.routingError || r.errors?.join(', ')
            }))
        };
        const fs = require('fs');
        fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
        console.log(`✅ Summary exported to ${outputPath}`);
    }
}
exports.RouteSummaryService = RouteSummaryService;
//# sourceMappingURL=route-summary-service.js.map