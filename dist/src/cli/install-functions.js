#!/usr/bin/env ts-node
"use strict";
/**
 * Carthorse Function Install CLI
 *
 * Installs functions from a SQL file to the production PostgreSQL database
 *
 * Usage:
 *   npx ts-node src/cli/install-functions.ts
 *   npx ts-node src/cli/install-functions.ts --input ./sql/functions/production-functions.sql
 *   npx ts-node src/cli/install-functions.ts --verbose
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
    .name('carthorse-install-functions')
    .description('Install functions from a SQL file to the production PostgreSQL database')
    .version('1.0.0')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-i, --input <path>', 'Input path for functions SQL file', './sql/organized/functions/production-functions.sql')
    .action(async (options) => {
    try {
        console.log('🔧 Starting function installation to production database...');
        if (options.verbose) {
            console.log(`📊 Input path: ${options.input}`);
        }
        // Use the orchestrator method to install functions
        await CarthorseOrchestrator_1.CarthorseOrchestrator.installFunctions(options.input);
        console.log('✅ Function installation completed successfully!');
    }
    catch (error) {
        console.error('❌ Function installation failed:', error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=install-functions.js.map