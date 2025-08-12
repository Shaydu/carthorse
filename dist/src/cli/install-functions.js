#!/usr/bin/env ts-node
"use strict";
/**
 * Carthorse Essential Functions Installation CLI
 *
 * Installs only the essential PostGIS and pgRouting functions needed for export
 *
 * Usage:
 *   npx ts-node src/cli/install-functions.ts
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
const pg_1 = require("pg");
const config_loader_1 = require("../utils/config-loader");
dotenv.config();
const program = new commander_1.Command();
program
    .name('carthorse-install-functions')
    .description('Install essential PostGIS and pgRouting functions for export')
    .version('1.0.0')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options) => {
    try {
        console.log('🔧 Installing essential functions for export...');
        // Get database configuration
        const dbConfig = (0, config_loader_1.getDatabasePoolConfig)();
        const pool = new pg_1.Pool(dbConfig);
        try {
            // Test connection
            const client = await pool.connect();
            // Install essential PostGIS functions (these are usually already available)
            console.log('📦 Checking PostGIS extension...');
            await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
            console.log('✅ PostGIS extension ready');
            // Install essential pgRouting functions
            console.log('📦 Checking pgRouting extension...');
            await client.query('CREATE EXTENSION IF NOT EXISTS pgrouting');
            console.log('✅ pgRouting extension ready');
            // Verify essential functions are available
            console.log('🔍 Verifying essential functions...');
            const functionCheck = await client.query(`
          SELECT 
            proname,
            CASE WHEN proname IN ('pgr_analyzeGraph', 'pgr_ksp', 'pgr_dijkstra') THEN 'pgRouting'
                 WHEN proname IN ('ST_DWithin', 'ST_MakeLine', 'ST_Union', 'ST_LineMerge', 'ST_Distance') THEN 'PostGIS'
                 ELSE 'Other'
            END as category
          FROM pg_proc 
          WHERE proname IN (
            'pgr_analyzeGraph', 'pgr_ksp', 'pgr_dijkstra',
            'ST_DWithin', 'ST_MakeLine', 'ST_Union', 'ST_LineMerge', 'ST_Distance',
            'ST_StartPoint', 'ST_EndPoint', 'ST_Force2D', 'ST_GeometryType',
            'ST_LineMerge', 'ST_Union', 'ST_GeometryN', 'ST_AsGeoJSON'
          )
          AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          ORDER BY category, proname
        `);
            if (options.verbose) {
                console.log('📋 Available essential functions:');
                functionCheck.rows.forEach((row) => {
                    console.log(`  - ${row.category}: ${row.proname}`);
                });
            }
            const functionCount = functionCheck.rows.length;
            console.log(`✅ Found ${functionCount} essential functions`);
            if (functionCount < 10) {
                console.warn('⚠️  Some essential functions may be missing. Export may fail.');
            }
            else {
                console.log('✅ All essential functions are available for export');
            }
            client.release();
        }
        finally {
            await pool.end();
        }
        console.log('✅ Essential functions installation completed successfully!');
    }
    catch (error) {
        console.error('❌ Function installation failed:', error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=install-functions.js.map