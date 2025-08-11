"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteGenerationOrchestratorService = void 0;
const ksp_route_generator_service_1 = require("./ksp-route-generator-service");
const loop_route_generator_service_1 = require("./loop-route-generator-service");
const route_discovery_config_loader_1 = require("../../config/route-discovery-config-loader");
class RouteGenerationOrchestratorService {
    constructor(pgClient, config) {
        this.pgClient = pgClient;
        this.config = config;
        this.kspService = null;
        this.loopService = null;
        this.configLoader = route_discovery_config_loader_1.RouteDiscoveryConfigLoader.getInstance();
        // Load trailhead configuration from YAML
        const routeDiscoveryConfig = this.configLoader.loadConfig();
        const trailheadConfig = routeDiscoveryConfig.trailheads;
        console.log(`🔍 DEBUG: RouteGenerationOrchestratorService config:`, {
            useTrailheadsOnly: this.config.useTrailheadsOnly,
            trailheadLocations: this.config.trailheadLocations?.length || 0,
            configEnabled: trailheadConfig.enabled,
            configStrategy: trailheadConfig.selectionStrategy,
            configLocations: trailheadConfig.locations?.length || 0
        });
        if (this.config.generateKspRoutes) {
            this.kspService = new ksp_route_generator_service_1.KspRouteGeneratorService(this.pgClient, {
                stagingSchema: this.config.stagingSchema,
                region: this.config.region,
                targetRoutesPerPattern: this.config.targetRoutesPerPattern,
                minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
                kspKValue: this.config.kspKValue,
                useTrailheadsOnly: this.config.useTrailheadsOnly !== undefined ? this.config.useTrailheadsOnly : trailheadConfig.enabled, // CLI override takes precedence over YAML config
                trailheadLocations: this.config.trailheadLocations || trailheadConfig.locations
            });
        }
        if (this.config.generateLoopRoutes) {
            this.loopService = new loop_route_generator_service_1.LoopRouteGeneratorService(this.pgClient, {
                stagingSchema: this.config.stagingSchema,
                region: this.config.region,
                targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern || 3,
                minDistanceBetweenRoutes: this.config.minDistanceBetweenRoutes,
            });
        }
    }
    /**
     * Generate all route types (KSP and Loop)
     */
    async generateAllRoutes() {
        console.log('🎯 Generating all route types...');
        const kspRoutes = [];
        const loopRoutes = [];
        // Generate KSP routes
        if (this.config.generateKspRoutes && this.kspService) {
            console.log('🛤️ Generating KSP routes...');
            const kspRecommendations = await this.kspService.generateKspRoutes();
            await this.kspService.storeRouteRecommendations(kspRecommendations);
            kspRoutes.push(...kspRecommendations);
            console.log(`✅ Generated ${kspRecommendations.length} KSP routes`);
        }
        // Generate Loop routes
        if (this.config.generateLoopRoutes && this.loopService) {
            console.log('🔄 Generating loop routes...');
            console.log(`🔍 DEBUG: Loop service config:`, {
                generateLoopRoutes: this.config.generateLoopRoutes,
                useHawickCircuits: this.config.loopConfig?.useHawickCircuits,
                targetRoutesPerPattern: this.config.loopConfig?.targetRoutesPerPattern
            });
            const loopRecommendations = await this.loopService.generateLoopRoutes();
            await this.loopService.storeLoopRouteRecommendations(loopRecommendations);
            loopRoutes.push(...loopRecommendations);
            console.log(`✅ Generated ${loopRecommendations.length} loop routes`);
        }
        else {
            console.log(`🔍 DEBUG: Loop generation skipped - generateLoopRoutes: ${this.config.generateLoopRoutes}, loopService: ${!!this.loopService}`);
        }
        const totalRoutes = kspRoutes.length + loopRoutes.length;
        console.log(`🎯 Total routes generated: ${totalRoutes} (${kspRoutes.length} KSP, ${loopRoutes.length} loops)`);
        return {
            kspRoutes,
            loopRoutes,
            totalRoutes
        };
    }
    /**
     * Generate only KSP routes
     */
    async generateKspRoutes() {
        if (!this.kspService) {
            throw new Error('KSP route generation is not enabled');
        }
        console.log('🛤️ Generating KSP routes...');
        const recommendations = await this.kspService.generateKspRoutes();
        await this.kspService.storeRouteRecommendations(recommendations);
        console.log(`✅ Generated ${recommendations.length} KSP routes`);
        return recommendations;
    }
    /**
     * Generate only loop routes
     */
    async generateLoopRoutes() {
        if (!this.loopService) {
            throw new Error('Loop route generation is not enabled');
        }
        console.log('🔄 Generating loop routes...');
        const recommendations = await this.loopService.generateLoopRoutes();
        await this.loopService.storeLoopRouteRecommendations(recommendations);
        console.log(`✅ Generated ${recommendations.length} loop routes`);
        return recommendations;
    }
    /**
     * Get route generation statistics
     */
    async getRouteGenerationStats() {
        const stats = {
            kspEnabled: this.config.generateKspRoutes,
            loopEnabled: this.config.generateLoopRoutes,
            totalRoutesGenerated: 0,
            routeTypes: []
        };
        if (this.config.generateKspRoutes) {
            stats.routeTypes.push('KSP');
        }
        if (this.config.generateLoopRoutes) {
            stats.routeTypes.push('Loop');
        }
        return stats;
    }
}
exports.RouteGenerationOrchestratorService = RouteGenerationOrchestratorService;
//# sourceMappingURL=route-generation-orchestrator-service.js.map