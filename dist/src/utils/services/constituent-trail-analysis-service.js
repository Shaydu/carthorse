"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConstituentTrailAnalysisService = void 0;
class ConstituentTrailAnalysisService {
    constructor(pgClient) {
        this.pgClient = pgClient;
    }
    /**
     * Analyze constituent trails for a route
     */
    async analyzeRouteConstituentTrails(stagingSchema, routeEdges) {
        // Extract unique trails from route edges
        const uniqueTrails = this.extractUniqueTrails(routeEdges);
        // Calculate totals
        const totalTrailDistance = uniqueTrails.reduce((sum, trail) => sum + (trail.length_km || 0), 0);
        const totalTrailElevationGain = uniqueTrails.reduce((sum, trail) => sum + (trail.elevation_gain || 0), 0);
        const totalTrailElevationLoss = uniqueTrails.reduce((sum, trail) => sum + (trail.elevation_loss || 0), 0);
        // For out-and-back routes, double the metrics
        const outAndBackDistance = totalTrailDistance * 2;
        const outAndBackElevationGain = totalTrailElevationGain * 2;
        const outAndBackElevationLoss = totalTrailElevationLoss * 2;
        return {
            route_uuid: routeEdges[0]?.route_uuid || 'unknown',
            route_name: routeEdges[0]?.route_name || 'unknown',
            edge_count: routeEdges.length,
            unique_trail_count: uniqueTrails.length,
            constituent_trails: uniqueTrails,
            total_trail_distance_km: totalTrailDistance,
            total_trail_elevation_gain_m: totalTrailElevationGain,
            total_trail_elevation_loss_m: totalTrailElevationLoss,
            out_and_back_distance_km: outAndBackDistance,
            out_and_back_elevation_gain_m: outAndBackElevationGain,
            out_and_back_elevation_loss_m: outAndBackElevationLoss
        };
    }
    /**
     * Extract unique trails from route edges
     */
    extractUniqueTrails(routeEdges) {
        const trailMap = new Map();
        for (const edge of routeEdges) {
            if (edge.app_uuid && edge.trail_name) {
                if (!trailMap.has(edge.app_uuid)) {
                    trailMap.set(edge.app_uuid, {
                        app_uuid: edge.app_uuid,
                        name: edge.trail_name,
                        trail_type: edge.trail_type || 'N/A',
                        surface: edge.surface || 'N/A',
                        difficulty: edge.difficulty || 'N/A',
                        length_km: edge.trail_length_km || 0,
                        elevation_gain: edge.trail_elevation_gain || 0,
                        elevation_loss: edge.elevation_loss || 0,
                        max_elevation: edge.max_elevation || 0,
                        min_elevation: edge.min_elevation || 0,
                        avg_elevation: edge.avg_elevation || 0
                    });
                }
            }
        }
        return Array.from(trailMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }
    /**
     * Generate comprehensive route report
     */
    async generateRouteReport(stagingSchema, routeAnalysis) {
        console.log(`\n🏃 ROUTE ANALYSIS: ${routeAnalysis.route_name}`);
        console.log(`   Edge Count: ${routeAnalysis.edge_count}`);
        console.log(`   Unique Trails: ${routeAnalysis.unique_trail_count}`);
        console.log(`   Total Trail Distance: ${routeAnalysis.total_trail_distance_km.toFixed(2)}km`);
        console.log(`   Total Trail Elevation Gain: ${routeAnalysis.total_trail_elevation_gain_m.toFixed(0)}m`);
        console.log(`   Out-and-Back Distance: ${routeAnalysis.out_and_back_distance_km.toFixed(2)}km`);
        console.log(`   Out-and-Back Elevation Gain: ${routeAnalysis.out_and_back_elevation_gain_m.toFixed(0)}m`);
        if (routeAnalysis.constituent_trails.length > 0) {
            console.log(`   Constituent Trails:`);
            routeAnalysis.constituent_trails.forEach((trail, index) => {
                console.log(`     ${index + 1}. ${trail.name}`);
                console.log(`        Distance: ${trail.length_km.toFixed(2)}km`);
                console.log(`        Elevation Gain: ${trail.elevation_gain.toFixed(0)}m`);
                console.log(`        Type: ${trail.trail_type}`);
                console.log(`        Surface: ${trail.surface}`);
                console.log(`        Difficulty: ${trail.difficulty}`);
            });
        }
    }
    /**
     * Analyze all routes in a staging schema
     */
    async analyzeAllRoutes(stagingSchema) {
        console.log(`🔍 Analyzing constituent trails for all routes in ${stagingSchema}...`);
        // Get all route recommendations
        const routesResult = await this.pgClient.query(`
      SELECT 
        route_uuid, route_name, route_edges
      FROM ${stagingSchema}.route_recommendations
      WHERE route_edges IS NOT NULL
      ORDER BY route_name, created_at DESC
    `);
        const allAnalyses = [];
        for (const route of routesResult.rows) {
            const routeEdges = typeof route.route_edges === 'string'
                ? JSON.parse(route.route_edges)
                : route.route_edges;
            // Add route metadata to edges
            const edgesWithMetadata = routeEdges.map((edge) => ({
                ...edge,
                route_uuid: route.route_uuid,
                route_name: route.route_name
            }));
            const analysis = await this.analyzeRouteConstituentTrails(stagingSchema, edgesWithMetadata);
            allAnalyses.push(analysis);
            // Generate report for this route
            await this.generateRouteReport(stagingSchema, analysis);
        }
        return allAnalyses;
    }
    /**
     * Export constituent trail analysis to JSON
     */
    async exportConstituentAnalysis(analyses, outputPath) {
        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(outputPath, JSON.stringify(analyses, null, 2));
        console.log(`📄 Constituent trail analysis exported to: ${outputPath}`);
    }
    /**
     * Populate route_trails table in staging schema with constituent trail data
     */
    async populateRouteTrailsTable(stagingSchema, routeAnalysis) {
        console.log(`📝 Populating route_trails table for route: ${routeAnalysis.route_uuid}`);
        try {
            // Clear existing route trails for this route
            await this.pgClient.query(`
        DELETE FROM ${stagingSchema}.route_trails 
        WHERE route_uuid = $1
      `, [routeAnalysis.route_uuid]);
            // Insert constituent trails with segment order
            for (let i = 0; i < routeAnalysis.constituent_trails.length; i++) {
                const trail = routeAnalysis.constituent_trails[i];
                await this.pgClient.query(`
          INSERT INTO ${stagingSchema}.route_trails (
            route_uuid, trail_id, trail_name, segment_order,
            segment_distance_km, segment_elevation_gain, segment_elevation_loss,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [
                    routeAnalysis.route_uuid,
                    trail.app_uuid,
                    trail.name,
                    i + 1, // segment_order (1-based)
                    trail.length_km,
                    trail.elevation_gain,
                    trail.elevation_loss
                ]);
            }
            console.log(`✅ Populated ${routeAnalysis.constituent_trails.length} route trail segments for route: ${routeAnalysis.route_uuid}`);
        }
        catch (error) {
            console.error(`❌ Failed to populate route_trails table for route ${routeAnalysis.route_uuid}:`, error);
            throw error;
        }
    }
    /**
     * Populate route_trails table for all routes
     */
    async populateAllRouteTrailsTables(stagingSchema, routeAnalyses) {
        console.log(`📝 Populating route_trails table for ${routeAnalyses.length} routes...`);
        for (const analysis of routeAnalyses) {
            await this.populateRouteTrailsTable(stagingSchema, analysis);
        }
        console.log(`✅ Populated route_trails table for all ${routeAnalyses.length} routes`);
    }
}
exports.ConstituentTrailAnalysisService = ConstituentTrailAnalysisService;
//# sourceMappingURL=constituent-trail-analysis-service.js.map