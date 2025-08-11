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
export declare class OrchestratorHooks {
    private hooks;
    constructor();
    /**
     * Register a hook
     */
    registerHook(hook: OrchestratorHook): void;
    /**
     * Execute a hook by name
     */
    executeHook(name: string, context: OrchestratorContext): Promise<void>;
    /**
     * Execute multiple hooks in sequence
     */
    executeHooks(names: string[], context: OrchestratorContext): Promise<void>;
    /**
     * Register default hooks
     */
    private registerDefaultHooks;
    /**
     * Get available hook names
     */
    getAvailableHooks(): string[];
    /**
     * Get hook by name
     */
    getHook(name: string): OrchestratorHook | undefined;
}
//# sourceMappingURL=orchestrator-hooks.d.ts.map