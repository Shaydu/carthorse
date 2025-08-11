"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoopRouteGeneratorService = void 0;
const route_pattern_sql_helpers_1 = require("../sql/route-pattern-sql-helpers");
const route_generation_business_logic_1 = require("../business/route-generation-business-logic");
const constituent_trail_analysis_service_1 = require("./constituent-trail-analysis-service");
class LoopRouteGeneratorService {
    constructor(pgClient, config) {
        this.pgClient = pgClient;
        this.config = config;
        this.sqlHelpers = new route_pattern_sql_helpers_1.RoutePatternSqlHelpers(pgClient);
        this.constituentAnalysisService = new constituent_trail_analysis_service_1.ConstituentTrailAnalysisService(pgClient);
    }
    /**
     * Generate loop routes for all patterns
     */
    async generateLoopRoutes() {
        console.log('🎯 Generating loop routes...');
        const patterns = await this.sqlHelpers.loadLoopPatterns();
        const allRecommendations = [];
        for (const pattern of patterns) {
            console.log(`\n🎯 Processing loop pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
            const patternRoutes = await this.generateRoutesForPattern(pattern);
            // Sort by score and take top routes
            const bestRoutes = patternRoutes
                .sort((a, b) => b.route_score - a.route_score)
                .slice(0, this.config.targetRoutesPerPattern);
            allRecommendations.push(...bestRoutes);
            console.log(`✅ Generated ${bestRoutes.length} loop routes for ${pattern.pattern_name}`);
        }
        return allRecommendations;
    }
    /**
     * Generate routes for a specific loop pattern
     */
    async generateRoutesForPattern(pattern) {
        console.log(`📏 Targeting loop: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
        const patternRoutes = [];
        const usedAreas = [];
        const toleranceLevels = route_generation_business_logic_1.RouteGenerationBusinessLogic.getToleranceLevels(pattern);
        const seenTrailCombinations = new Set(); // Track unique trail combinations
        for (const tolerance of toleranceLevels) {
            if (patternRoutes.length >= this.config.targetRoutesPerPattern)
                break;
            console.log(`🔍 Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
            await this.generateLoopRoutesWithHawickCircuits(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
        }
        return patternRoutes;
    }
    /**
     * Generate loop routes using pgr_hawickcircuits
     */
    async generateLoopRoutesWithHawickCircuits(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations) {
        try {
            const loops = await this.sqlHelpers.generateLoopRoutes(this.config.stagingSchema, pattern.target_distance_km, pattern.target_elevation_gain, tolerance.distance);
            console.log(`🔍 DEBUG: Found ${loops.length} loops from SQL query`);
            if (loops.length > 0) {
                console.log(`🔍 DEBUG: First loop structure:`, JSON.stringify(loops[0], null, 2));
            }
            for (const loop of loops) {
                if (patternRoutes.length >= this.config.targetRoutesPerPattern)
                    break;
                console.log(`🔍 DEBUG: Processing loop:`, loop);
                // Process the loop into a route recommendation
                const routeRecommendation = await this.processLoopRoute(pattern, tolerance, loop, usedAreas, seenTrailCombinations);
                if (routeRecommendation) {
                    patternRoutes.push(routeRecommendation);
                    console.log(`✅ DEBUG: Added route recommendation`);
                }
                else {
                    console.log(`❌ DEBUG: Route recommendation was null`);
                }
            }
        }
        catch (error) {
            console.error('❌ Error generating loop routes with hawickcircuits:', error);
        }
    }
    /**
     * Process a loop route into a route recommendation
     */
    async processLoopRoute(pattern, tolerance, loop, usedAreas, seenTrailCombinations) {
        try {
            // Check if this area is already used
            if (loop.edges && loop.edges.length > 0) {
                const firstEdge = loop.edges[0];
                const isUsed = route_generation_business_logic_1.RouteGenerationBusinessLogic.isAreaUsed(firstEdge.lon || 0, firstEdge.lat || 0, usedAreas, this.config.minDistanceBetweenRoutes);
                if (isUsed) {
                    return null;
                }
            }
            // Get route edges with metadata
            const edgeIds = loop.edges ? loop.edges.map((e) => e.edge_id) : [];
            const routeEdges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
            if (routeEdges.length === 0) {
                return null;
            }
            // Check for duplicate trail combinations
            const trailUuids = routeEdges.map(edge => edge.app_uuid).sort();
            const trailCombinationKey = trailUuids.join('|');
            if (seenTrailCombinations.has(trailCombinationKey)) {
                console.log(`🔄 Skipping duplicate loop route with trails: ${trailUuids.join(', ')}`);
                return null;
            }
            // Add this combination to seen set
            seenTrailCombinations.add(trailCombinationKey);
            // Perform constituent trail analysis
            const constituentAnalysis = await this.constituentAnalysisService.analyzeRouteConstituentTrails(this.config.stagingSchema, routeEdges);
            // Calculate route metrics
            const { totalDistance, totalElevationGain } = route_generation_business_logic_1.RouteGenerationBusinessLogic.calculateRouteMetrics(routeEdges);
            // Check if route meets tolerance criteria
            const { distanceOk, elevationOk } = route_generation_business_logic_1.RouteGenerationBusinessLogic.meetsToleranceCriteria(totalDistance, totalElevationGain, pattern, tolerance);
            console.log(`🔍 Loop route metrics: ${totalDistance.toFixed(2)}km, ${totalElevationGain.toFixed(0)}m (target: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
            console.log(`🔍 Tolerance check: distance=${distanceOk}, elevation=${elevationOk}`);
            if (!distanceOk || !elevationOk) {
                console.log(`❌ Loop route filtered out by tolerance criteria`);
                return null;
            }
            // Calculate route score with improved metrics
            const routeScore = route_generation_business_logic_1.RouteGenerationBusinessLogic.calculateRouteScore(totalDistance, totalElevationGain, pattern, tolerance, routeEdges);
            // Create route recommendation
            const routeRecommendation = {
                route_uuid: `loop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                route_name: this.generateLoopRouteName(pattern, totalDistance, totalElevationGain),
                route_type: 'similar_distance', // Loop routes are similar distance matches
                route_shape: 'loop',
                input_length_km: pattern.target_distance_km,
                input_elevation_gain: pattern.target_elevation_gain,
                recommended_length_km: totalDistance,
                recommended_elevation_gain: totalElevationGain,
                route_path: this.generateRoutePath(routeEdges),
                route_edges: routeEdges,
                trail_count: constituentAnalysis.unique_trail_count,
                route_score: routeScore,
                similarity_score: routeScore / 100,
                region: this.config.region,
                // Constituent trail analysis data
                constituent_trails: constituentAnalysis.constituent_trails,
                unique_trail_count: constituentAnalysis.unique_trail_count,
                total_trail_distance_km: constituentAnalysis.total_trail_distance_km,
                total_trail_elevation_gain_m: constituentAnalysis.total_trail_elevation_gain_m,
                out_and_back_distance_km: totalDistance, // For loops, same as total distance
                out_and_back_elevation_gain_m: totalElevationGain // For loops, same as total elevation
            };
            // Add to used areas
            if (routeEdges.length > 0) {
                const firstEdge = routeEdges[0];
                usedAreas.push({
                    lon: firstEdge.lon || 0,
                    lat: firstEdge.lat || 0,
                    distance: totalDistance
                });
            }
            return routeRecommendation;
        }
        catch (error) {
            console.error('❌ Error processing loop route:', error);
            return null;
        }
    }
    /**
     * Generate a descriptive name for the loop route
     */
    generateLoopRouteName(pattern, distance, elevation) {
        const distanceClass = distance < 5 ? 'Short' : distance < 10 ? 'Medium' : 'Long';
        const elevationClass = elevation < 200 ? 'Easy' : elevation < 400 ? 'Moderate' : 'Challenging';
        return `${distanceClass} ${elevationClass} Loop - ${distance.toFixed(1)}km, ${elevation.toFixed(0)}m gain`;
    }
    /**
     * Generate route path from edges
     */
    generateRoutePath(routeEdges) {
        // Create a GeoJSON LineString from the route edges
        const coordinates = routeEdges.map(edge => {
            // This would need to be implemented based on your geometry structure
            return [edge.lon || 0, edge.lat || 0];
        });
        return JSON.stringify({
            type: 'LineString',
            coordinates: coordinates
        });
    }
    /**
     * Store loop route recommendations
     */
    async storeLoopRouteRecommendations(recommendations) {
        console.log(`💾 Storing ${recommendations.length} loop route recommendations...`);
        for (const recommendation of recommendations) {
            await this.sqlHelpers.storeRouteRecommendation(this.config.stagingSchema, recommendation);
        }
        console.log('✅ Loop route recommendations stored successfully');
    }
}
exports.LoopRouteGeneratorService = LoopRouteGeneratorService;
//# sourceMappingURL=loop-route-generator-service.js.map