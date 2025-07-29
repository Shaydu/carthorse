import { Client } from 'pg';
import { ElevationService } from '../utils/elevation-service';
import { ValidationService } from '../utils/validation-service';

export interface OrchestratorHook {
  name: string;
  execute: (context: OrchestratorContext) => Promise<void>;
}

export interface OrchestratorContext {
  pgClient: Client;
  schemaName: string;
  region: string;
  config: any;
  elevationService: ElevationService;
  validationService: ValidationService;
}

export class OrchestratorHooks {
  private hooks: Map<string, OrchestratorHook> = new Map();

  constructor() {
    this.registerDefaultHooks();
  }

  /**
   * Register a hook
   */
  registerHook(hook: OrchestratorHook): void {
    this.hooks.set(hook.name, hook);
  }

  /**
   * Execute a hook by name
   */
  async executeHook(name: string, context: OrchestratorContext): Promise<void> {
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
  async executeHooks(names: string[], context: OrchestratorContext): Promise<void> {
    for (const name of names) {
      await this.executeHook(name, context);
    }
  }

  /**
   * Register default hooks
   */
  private registerDefaultHooks(): void {
    // Pre-processing hooks
    this.registerHook({
      name: 'initialize-elevation-data',
      execute: async (context) => {
        await context.elevationService.initializeElevationData(context.schemaName);
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

    // Processing hooks
    this.registerHook({
      name: 'process-elevation-data',
      execute: async (context) => {
        await context.elevationService.processMissingElevationData(context.schemaName);
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
        console.log(`\n📈 Elevation coverage:`);
        console.log(`   Total trails: ${stats.total_trails}`);
        console.log(`   With elevation: ${stats.trails_with_elevation} (${(stats.trails_with_elevation/stats.total_trails*100).toFixed(1)}%)`);
        console.log(`   Missing elevation: ${stats.trails_missing_elevation} (${(stats.trails_missing_elevation/stats.total_trails*100).toFixed(1)}%)`);
      }
    });
  }

  /**
   * Get available hook names
   */
  getAvailableHooks(): string[] {
    return Array.from(this.hooks.keys());
  }

  /**
   * Get hook by name
   */
  getHook(name: string): OrchestratorHook | undefined {
    return this.hooks.get(name);
  }
}