#!/usr/bin/env ts-node
"use strict";
/**
 * Carthorse Database Backup CLI
 *
 * Backs up the production PostgreSQL database using pg_dump
 *
 * Usage:
 *   npx ts-node src/cli/backup.ts
 *   npx ts-node src/cli/backup.ts --verbose
 *   npx ts-node src/cli/backup.ts --output ./custom-backup.dump
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
const backup_1 = require("../utils/sql/backup");
const env_1 = require("../utils/env");
dotenv.config();
const program = new commander_1.Command();
program
    .name('carthorse-backup')
    .description('Backup the production PostgreSQL database')
    .version('1.0.0')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-o, --output <path>', 'Custom output path for backup file')
    .action(async (options) => {
    try {
        console.log('💾 Starting production database backup...');
        // Get database configuration
        const dbConfig = (0, env_1.getDbConfig)();
        if (options.verbose) {
            console.log('📊 Database configuration:');
            console.log(`   Host: ${dbConfig.host}`);
            console.log(`   Port: ${dbConfig.port}`);
            console.log(`   Database: ${dbConfig.database}`);
            console.log(`   User: ${dbConfig.user}`);
        }
        // Perform backup
        await (0, backup_1.backupDatabase)(dbConfig);
        console.log('✅ Production database backup completed successfully!');
    }
    catch (error) {
        console.error('❌ Backup failed:', error);
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=backup.js.map