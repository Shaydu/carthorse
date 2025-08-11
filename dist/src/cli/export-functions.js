#!/usr/bin/env ts-node
"use strict";
/**
 * Carthorse Function Export CLI
 *
 * Exports all functions from the production PostgreSQL database to a SQL file
 *
 * Usage:
 *   npx ts-node src/cli/export-functions.ts
 *   npx ts-node src/cli/export-functions.ts --output ./sql/functions/production-functions.sql
 *   npx ts-node src/cli/export-functions.ts --verbose
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
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const dotenv = __importStar(require("dotenv"));
const CarthorseOrchestrator_1 = require("../orchestrator/CarthorseOrchestrator");
dotenv.config();
const program = new commander_1.Command();
program
    .name('carthorse-export-functions')
    .description('Export all functions from the production PostgreSQL database')
    .version('1.0.0')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-o, --output <path>', 'Output path for functions SQL file', './sql/organized/functions/production-functions.sql')
    .action(async (options) => {
    try {
        console.log('💾 Starting function export from production database...');
        if (options.verbose) {
            console.log(`📊 Output path: ${options.output}`);
        }
        // Use the orchestrator method to export functions
        await CarthorseOrchestrator_1.CarthorseOrchestrator.exportProductionFunctions(options.output);
        console.log('✅ Function export completed successfully!');
    }
    catch (error) {
        console.error('❌ Function export failed:', error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=export-functions.js.map