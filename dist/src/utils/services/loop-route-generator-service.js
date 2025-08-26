"use strict";
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
exports.LoopRouteGeneratorService = void 0;
const route_pattern_sql_helpers_1 = require("../sql/route-pattern-sql-helpers");
const route_generation_business_logic_1 = require("../business/route-generation-business-logic");
const constituent_trail_analysis_service_1 = require("./constituent-trail-analysis-service");
class LoopRouteGeneratorService {
    constructor(pgClient, config) {
        this.pgClient = pgClient;
        this.config = config;
        this.sqlHelpers = new route_pattern_sql_helpers_1.RoutePatternSqlHelpers(pgClient);
        // Load detailed logging setting from config
        const { RouteDiscoveryConfigLoader } = require('../../config/route-discovery-config-loader');
        const configLoader = RouteDiscoveryConfigLoader.getInstance();
        const routeConfig = configLoader.loadConfig();
        const enableDetailedLogging = routeConfig.routing?.enableDetailedRouteAnalysisLogging || false;
        this.constituentAnalysisService = new constituent_trail_analysis_service_1.ConstituentTrailAnalysisService(pgClient, enableDetailedLogging);
    }
    /**
     * Generate loop routes for all patterns
     */
    async generateLoopRoutes() {
        console.log('🎯 Generating loop routes...');
        // Create routing network from trails first
        await this.createRoutingNetworkFromTrails();
        const patterns = await this.sqlHelpers.loadLoopPatterns();
        const allRecommendations = [];
        for (const pattern of patterns) {
            console.log(`\n🎯 Processing loop pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
            const patternRoutes = await this.generateRoutesForPattern(pattern);
            // Sort by score and take top routes
            const bestRoutes = patternRoutes
                .sort((a, b) => b.route_score - a.route_score)
                .slice(0, this.config.targetRoutesPerPattern);
            console.log(`🔍 [LOOP-SERVICE] Pattern ${pattern.pattern_name}: Generated ${patternRoutes.length} total routes, taking top ${this.config.targetRoutesPerPattern}, selected ${bestRoutes.length} routes`);
            allRecommendations.push(...bestRoutes);
            console.log(`✅ Generated ${bestRoutes.length} loop routes for ${pattern.pattern_name}`);
        }
        console.log(`🎯 [LOOP-SERVICE] SUMMARY: Total loop routes generated: ${allRecommendations.length}`);
        console.log(`🔍 [LOOP-SERVICE] Final route UUIDs: ${allRecommendations.map(r => r.route_uuid).join(', ')}`);
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
     * Validate that a route is a true loop (starts/ends at same node, no edge repetition, no direction changes)
     */
    validateTrueLoop(edges) {
        console.log(`🔍 [LOOP-VALIDATION] Validating loop with ${edges.length} edges`);
        if (edges.length < 2) {
            return { isValid: false, reason: 'Loop must have at least 2 edges' };
        }
        // Check that we start and end at the same node
        const firstEdge = edges[0];
        const lastEdge = edges[edges.length - 1];
        console.log(`🔍 [LOOP-VALIDATION] Check closure: first edge source=${firstEdge.source}, last edge target=${lastEdge.target}`);
        if (firstEdge.source !== lastEdge.target) {
            return { isValid: false, reason: `Loop does not close: starts at ${firstEdge.source}, ends at ${lastEdge.target}` };
        }
        // Check for edge repetition (same edge used twice)
        const edgeIds = edges.map(edge => edge.edge || edge.id).filter(id => id !== -1);
        const uniqueEdgeIds = new Set(edgeIds);
        console.log(`🔍 [LOOP-VALIDATION] Check edge repetition: ${edgeIds.length} total edges, ${uniqueEdgeIds.size} unique edges`);
        if (uniqueEdgeIds.size !== edgeIds.length) {
            return { isValid: false, reason: 'Loop traverses the same edge multiple times' };
        }
        // Check for direction consistency (no backtracking on same edge)
        for (let i = 0; i < edges.length - 1; i++) {
            const currentEdge = edges[i];
            const nextEdge = edges[i + 1];
            // Ensure consecutive edges are properly connected
            if (currentEdge.target !== nextEdge.source) {
                console.log(`🔍 [LOOP-VALIDATION] Connection failure at edge ${i}: ${currentEdge.target} -> ${nextEdge.source}`);
                return { isValid: false, reason: `Edges not properly connected: edge ${i} ends at ${currentEdge.target}, edge ${i + 1} starts at ${nextEdge.source}` };
            }
        }
        // Check for minimum loop size (at least 3 nodes to form a meaningful loop)
        const uniqueNodes = new Set();
        edges.forEach(edge => {
            uniqueNodes.add(edge.source);
            uniqueNodes.add(edge.target);
        });
        console.log(`🔍 [LOOP-VALIDATION] Check node count: ${uniqueNodes.size} unique nodes`);
        if (uniqueNodes.size < 3) {
            return { isValid: false, reason: 'Loop must have at least 3 unique nodes' };
        }
        console.log(`✅ [LOOP-VALIDATION] Loop validation passed`);
        return { isValid: true };
    }
    /**
     * Create routing network from trails data
     */
    async createRoutingNetworkFromTrails() {
        console.log('[ROUTING] 🛤️ Creating routing network from trails...');
        try {
            // Load configuration
            const { RouteDiscoveryConfigLoader } = await Promise.resolve().then(() => __importStar(require('../../config/route-discovery-config-loader')));
            const configLoader = RouteDiscoveryConfigLoader.getInstance();
            const routeDiscoveryConfig = configLoader.loadConfig();
            const spatialTolerance = routeDiscoveryConfig.routing.spatialTolerance;
            console.log(`[ROUTING] 📋 Using spatial tolerance: ${spatialTolerance}m`);
            // Clear only the Layer 3 routing tables (keep Layer 2 pgRouting tables intact)
            await this.pgClient.query(`DELETE FROM ${this.config.stagingSchema}.routing_edges`);
            await this.pgClient.query(`DELETE FROM ${this.config.stagingSchema}.routing_nodes`);
            // Create routing nodes from trail endpoints and intersections
            console.log('[ROUTING] 📍 Creating routing nodes...');
            // Insert start points
            await this.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.routing_nodes (lng, lat, node_type, geom)
        SELECT 
          ST_X(ST_StartPoint(t.geometry)) as lng,
          ST_Y(ST_StartPoint(t.geometry)) as lat,
          'endpoint' as node_type,
          ST_Force2D(ST_StartPoint(t.geometry)) as geom
        FROM ${this.config.stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
      `);
            // Insert end points
            await this.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.routing_nodes (lng, lat, node_type, geom)
        SELECT 
          ST_X(ST_EndPoint(t.geometry)) as lng,
          ST_Y(ST_EndPoint(t.geometry)) as lat,
          'endpoint' as node_type,
          ST_Force2D(ST_EndPoint(t.geometry)) as geom
        FROM ${this.config.stagingSchema}.trails t
        WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
      `);
            // Insert intersection points
            await this.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.routing_nodes (lng, lat, node_type, geom)
        SELECT 
          ST_X(ip.intersection_point) as lng,
          ST_Y(ip.intersection_point) as lat,
          'intersection' as node_type,
          ST_Force2D(ip.intersection_point) as geom
        FROM ${this.config.stagingSchema}.intersection_points ip
        WHERE ip.intersection_point IS NOT NULL AND ST_IsValid(ip.intersection_point)
      `);
            const nodeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.routing_nodes`);
            console.log(`[ROUTING] ✅ Created ${nodeCount.rows[0].count} routing nodes`);
            // Create routing edges from trails with calculated length and elevation data
            console.log('[ROUTING] 🛤️ Creating routing edges with calculated length and elevation...');
            await this.pgClient.query(`
        INSERT INTO ${this.config.stagingSchema}.routing_edges (app_uuid, name, trail_type, length_km, elevation_gain, elevation_loss, geom, source, target)
        WITH elevation_calculated AS (
          -- Calculate missing elevation and length data from geometry
          SELECT 
            t.*,
            CASE 
              WHEN t.length_km IS NOT NULL AND t.length_km > 0 THEN t.length_km
              ELSE ST_Length(t.geometry::geography) / 1000
            END as calculated_length_km,
            CASE 
              WHEN t.elevation_gain IS NOT NULL THEN t.elevation_gain
              ELSE (SELECT elevation_gain FROM recalculate_elevation_data(ST_Force3D(t.geometry)))
            END as calculated_elevation_gain,
            CASE 
              WHEN t.elevation_loss IS NOT NULL THEN t.elevation_loss
              ELSE (SELECT elevation_loss FROM recalculate_elevation_data(ST_Force3D(t.geometry)))
            END as calculated_elevation_loss
          FROM ${this.config.stagingSchema}.trails t
          WHERE t.geometry IS NOT NULL AND ST_IsValid(t.geometry)
        )
        SELECT 
          ec.app_uuid,
          ec.name,
          ec.trail_type,
          ec.calculated_length_km as length_km,
          ec.calculated_elevation_gain as elevation_gain,
          ec.calculated_elevation_loss as elevation_loss,
          ST_Force2D(ec.geometry) as geom,
          source_node.id as source,
          target_node.id as target
        FROM elevation_calculated ec
        CROSS JOIN LATERAL (
          SELECT id FROM ${this.config.stagingSchema}.routing_nodes 
          WHERE ST_DWithin(geom, ST_StartPoint(ec.geometry), ${spatialTolerance})
          ORDER BY ST_Distance(geom, ST_StartPoint(ec.geometry))
          LIMIT 1
        ) source_node
        CROSS JOIN LATERAL (
          SELECT id FROM ${this.config.stagingSchema}.routing_nodes 
          WHERE ST_DWithin(geom, ST_EndPoint(ec.geometry), ${spatialTolerance})
          ORDER BY ST_Distance(geom, ST_EndPoint(ec.geometry))
          LIMIT 1
        ) target_node
        WHERE source_node.id IS NOT NULL
          AND target_node.id IS NOT NULL
          AND source_node.id != target_node.id
          AND ec.calculated_length_km > 0
      `);
            const edgeCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.routing_edges`);
            console.log(`[ROUTING] ✅ Created ${edgeCount.rows[0].count} routing edges`);
            // Use existing Layer 2 pgRouting tables (ways_noded and ways_noded_vertices_pgr)
            console.log('[ROUTING] 🔧 Using existing Layer 2 pgRouting tables...');
            // Verify that Layer 2 tables exist and have data
            const waysCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded`);
            const verticesCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.ways_noded_vertices_pgr`);
            console.log(`[ROUTING] ✅ Using existing Layer 2 tables: ${waysCount.rows[0].count} ways and ${verticesCount.rows[0].count} vertices`);
            // Create additional helper tables for route generation
            console.log('[ROUTING] 📋 Creating helper tables...');
            // Create routing_edges_trails (alias for routing_edges)
            await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.routing_edges_trails AS
        SELECT * FROM ${this.config.stagingSchema}.routing_edges
      `);
            // Create routing_nodes_intersections (nodes with 3+ connections)
            await this.pgClient.query(`
        CREATE TABLE IF NOT EXISTS ${this.config.stagingSchema}.routing_nodes_intersections AS
        SELECT rn.*
        FROM ${this.config.stagingSchema}.routing_nodes rn
        WHERE (
          SELECT COUNT(*) 
          FROM ${this.config.stagingSchema}.routing_edges_trails 
          WHERE source = rn.id OR target = rn.id
        ) >= 3
      `);
            console.log('[ROUTING] ✅ Routing network creation completed');
        }
        catch (error) {
            console.log(`[ROUTING] ❌ Error creating routing network: ${error}`);
            throw error;
        }
    }
    /**
     * Process a loop route into a route recommendation
     */
    async processLoopRoute(pattern, tolerance, loop, usedAreas, seenTrailCombinations) {
        try {
            console.log(`🔍 [LOOP-FILTER] Processing loop cycle_id: ${loop.cycle_id}, edges: ${loop.edge_count}, distance: ${loop.total_distance.toFixed(2)}km`);
            // Get route edges with metadata using the edge_ids from the cycle
            const edgeIds = loop.edge_ids || [];
            if (edgeIds.length === 0) {
                console.log(`❌ [LOOP-FILTER] REJECTED: No edge IDs found in loop cycle_id: ${loop.cycle_id}`);
                return null;
            }
            const routeEdges = await this.sqlHelpers.getRouteEdges(this.config.stagingSchema, edgeIds);
            if (routeEdges.length === 0) {
                console.log(`❌ [LOOP-FILTER] REJECTED: No route edges found for loop cycle_id: ${loop.cycle_id}`);
                return null;
            }
            console.log(`🔍 [LOOP-FILTER] Found ${routeEdges.length} route edges for loop cycle_id: ${loop.cycle_id}`);
            // Check if this area is already used
            if (routeEdges.length > 0) {
                const firstEdge = routeEdges[0];
                const isUsed = route_generation_business_logic_1.RouteGenerationBusinessLogic.isAreaUsed(firstEdge.lon || 0, firstEdge.lat || 0, usedAreas, this.config.minDistanceBetweenRoutes);
                if (isUsed) {
                    console.log(`❌ [LOOP-FILTER] REJECTED (Area Used): cycle_id: ${loop.cycle_id}, area: [${firstEdge.lon}, ${firstEdge.lat}], minDistance: ${this.config.minDistanceBetweenRoutes}km`);
                    return null;
                }
                else {
                    console.log(`✅ [LOOP-FILTER] Area check passed for cycle_id: ${loop.cycle_id}, area: [${firstEdge.lon || 0}, ${firstEdge.lat || 0}]`);
                }
            }
            // Check for duplicate trail combinations
            const trailUuids = routeEdges.map(edge => edge.app_uuid).sort();
            const trailCombinationKey = trailUuids.join('|');
            console.log(`🔍 [LOOP-FILTER] Trail combination check for cycle_id: ${loop.cycle_id}, trails: [${trailUuids.join(', ')}]`);
            if (seenTrailCombinations.has(trailCombinationKey)) {
                console.log(`❌ [LOOP-FILTER] REJECTED (Duplicate Trails): cycle_id: ${loop.cycle_id}, trails: [${trailUuids.join(', ')}]`);
                return null;
            }
            // Add this combination to seen set
            seenTrailCombinations.add(trailCombinationKey);
            console.log(`✅ [LOOP-FILTER] Trail combination unique for cycle_id: ${loop.cycle_id}`);
            // Perform constituent trail analysis
            const constituentAnalysis = await this.constituentAnalysisService.analyzeRouteConstituentTrails(this.config.stagingSchema, routeEdges);
            // Calculate route metrics
            const { totalDistance, totalElevationGain } = route_generation_business_logic_1.RouteGenerationBusinessLogic.calculateRouteMetrics(routeEdges);
            // Check if route meets tolerance criteria
            const { distanceOk, elevationOk } = route_generation_business_logic_1.RouteGenerationBusinessLogic.meetsToleranceCriteria(totalDistance, totalElevationGain, pattern, tolerance);
            console.log(`🔍 [LOOP-FILTER] Route metrics for cycle_id: ${loop.cycle_id}: ${totalDistance.toFixed(2)}km, ${totalElevationGain.toFixed(0)}m (target: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
            console.log(`🔍 [LOOP-FILTER] Tolerance check for cycle_id: ${loop.cycle_id}: distance=${distanceOk} (${tolerance.distance}%), elevation=${elevationOk} (${tolerance.elevation}%)`);
            if (!distanceOk || !elevationOk) {
                console.log(`❌ [LOOP-FILTER] REJECTED (Tolerance): cycle_id: ${loop.cycle_id}, distance=${distanceOk} (${totalDistance.toFixed(2)}km vs ${pattern.target_distance_km}km ±${tolerance.distance}%), elevation=${elevationOk} (${totalElevationGain.toFixed(0)}m vs ${pattern.target_elevation_gain}m ±${tolerance.elevation}%)`);
                return null;
            }
            console.log(`✅ [LOOP-FILTER] Tolerance check passed for cycle_id: ${loop.cycle_id}`);
            // Calculate route score with improved metrics
            const routeScore = route_generation_business_logic_1.RouteGenerationBusinessLogic.calculateRouteScore(totalDistance, totalElevationGain, pattern, tolerance, routeEdges);
            console.log(`🔍 [LOOP-FILTER] Route score for cycle_id: ${loop.cycle_id}: ${routeScore} (converted to 0-1: ${routeScore / 100})`);
            // Validate that this is actually a true loop before creating the route
            const loopValidation = this.validateTrueLoop(routeEdges);
            console.log(`🔍 [LOOP-FILTER] Loop validation for cycle_id: ${loop.cycle_id}: ${loopValidation.isValid ? 'VALID' : 'INVALID'} ${loopValidation.reason ? `(${loopValidation.reason})` : ''}`);
            let actualRouteShape = 'loop';
            if (!loopValidation.isValid) {
                console.log(`⚠️ [LOOP-SERVICE] Pattern was 'loop' but route is not a true loop: ${loopValidation.reason}`);
                // Determine what type of route this actually is
                if (routeEdges.length === 1) {
                    actualRouteShape = 'point-to-point';
                    console.log(`🔄 [LOOP-SERVICE] Correcting route shape from 'loop' to 'point-to-point' (single edge)`);
                }
                else if (routeEdges.length === 2 && routeEdges[0].source === routeEdges[1].target && routeEdges[0].target === routeEdges[1].source) {
                    actualRouteShape = 'out-and-back';
                    console.log(`🔄 [LOOP-SERVICE] Correcting route shape from 'loop' to 'out-and-back' (backtracking)`);
                }
                else {
                    actualRouteShape = 'point-to-point';
                    console.log(`🔄 [LOOP-SERVICE] Correcting route shape from 'loop' to 'point-to-point' (invalid loop)`);
                }
            }
            else {
                console.log(`✅ [LOOP-SERVICE] Confirmed true loop: ${routeEdges.length} edges`);
            }
            // Create route recommendation
            const routeRecommendation = {
                route_uuid: `loop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                route_name: this.generateLoopRouteName(pattern, totalDistance, totalElevationGain),
                route_shape: actualRouteShape,
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
            console.log(`✅ [LOOP-FILTER] SUCCESS: Created loop route recommendation for cycle_id: ${loop.cycle_id}, route_uuid: ${routeRecommendation.route_uuid}, route_name: ${routeRecommendation.route_name}`);
            return routeRecommendation;
        }
        catch (error) {
            console.error(`❌ [LOOP-FILTER] ERROR processing loop cycle_id: ${loop.cycle_id}:`, error);
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
        // For loops, we need to connect the edges in sequence to form a continuous path
        const coordinates = [];
        for (let i = 0; i < routeEdges.length; i++) {
            const edge = routeEdges[i];
            // Add the start point of this edge
            if (edge.lon && edge.lat) {
                coordinates.push([edge.lon, edge.lat, edge.elevation || 0]);
            }
            // If this is the last edge, also add the end point to complete the loop
            if (i === routeEdges.length - 1 && routeEdges.length > 1) {
                // For the last edge, we might want to add its end point
                // This depends on how the geometry is stored in the edge
                if (edge.end_lon && edge.end_lat) {
                    coordinates.push([edge.end_lon, edge.end_lat, edge.end_elevation || 0]);
                }
            }
        }
        // If we don't have enough coordinates, create a simple path
        if (coordinates.length < 2) {
            coordinates.push([0, 0, 0]); // Fallback coordinate
        }
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