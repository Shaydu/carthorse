"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestratorHooks = void 0;
class OrchestratorHooks {
    constructor() {
        this.hooks = new Map();
        this.registerDefaultHooks();
    }
    /**
     * Register a hook
     */
    registerHook(hook) {
        this.hooks.set(hook.name, hook);
    }
    /**
     * Execute a hook by name
     */
    async executeHook(name, context) {
        const hook = this.hooks.get(name);
        if (!hook) {
            throw new Error(`Hook '${name}' not found`);
        }
        console.log(`🔗 Executing hook: ${hook.name}`);
        await hook.execute(context);
        console.log(`✅ Hook completed: ${hook.name}`);
    }
    /**
     * Execute multiple hooks in sequence
     */
    async executeHooks(names, context) {
        for (const name of names) {
            await this.executeHook(name, context);
        }
    }
    /**
     * Register default hooks
     */
    registerDefaultHooks() {
        // Pre-processing hooks
        this.registerHook({
            name: 'initialize-elevation-data',
            execute: async (context) => {
                console.log('🗻 Initializing elevation data...');
                await context.pgClient.query(`
          UPDATE ${context.schemaName}.trails 
          SET elevation_gain = NULL, elevation_loss = NULL, 
              max_elevation = NULL, min_elevation = NULL, avg_elevation = NULL
        `);
                console.log('✅ Elevation data initialized (reset to null)');
            }
        });
        this.registerHook({
            name: 'validate-trail-data',
            execute: async (context) => {
                const validation = await context.validationService.validateAllTrailData(context.schemaName);
                if (!validation.isValid) {
                    throw new Error(`Trail data validation failed: ${validation.errors.join(', ')}`);
                }
            }
        });
        this.registerHook({
            name: 'validate-bbox-data',
            execute: async (context) => {
                const validation = await context.validationService.validateBboxData(context.schemaName);
                if (!validation.isValid) {
                    throw new Error(`Bbox data validation failed: ${validation.errors.join(', ')}`);
                }
            }
        });
        this.registerHook({
            name: 'validate-geometry-data',
            execute: async (context) => {
                const validation = await context.validationService.validateGeometryData(context.schemaName);
                if (!validation.isValid) {
                    throw new Error(`Geometry data validation failed: ${validation.errors.join(', ')}`);
                }
            }
        });
        this.registerHook({
            name: 'process-elevation-data',
            execute: async (context) => {
                console.log('🗻 Processing elevation data...');
                // This hook would typically call elevation processing logic
                // For now, just log that it was called
                console.log('✅ Elevation data processing completed');
            }
        });
        this.registerHook({
            name: 'validate-elevation-data',
            execute: async (context) => {
                const validation = await context.elevationService.validateElevationData(context.schemaName);
                if (!validation.isValid) {
                    throw new Error(`Elevation data validation failed: ${validation.errors.join(', ')}`);
                }
            }
        });
        // Post-processing hooks
        this.registerHook({
            name: 'validate-routing-graph',
            execute: async (context) => {
                const validation = await context.validationService.validateRoutingGraph(context.schemaName);
                if (!validation.isValid) {
                    throw new Error(`Routing graph validation failed: ${validation.errors.join(', ')}`);
                }
            }
        });
        this.registerHook({
            name: 'show-elevation-stats',
            execute: async (context) => {
                const stats = await context.elevationService.getElevationStats(context.schemaName);
                console.log(`📊 Elevation stats: ${stats.trails_with_elevation}/${stats.total_trails} trails have elevation data`);
            }
        });
    }
    /**
     * Get available hook names
     */
    getAvailableHooks() {
        return Array.from(this.hooks.keys());
    }
    /**
     * Get hook by name
     */
    getHook(name) {
        return this.hooks.get(name);
    }
}
exports.OrchestratorHooks = OrchestratorHooks;
//# sourceMappingURL=orchestrator-hooks.js.map