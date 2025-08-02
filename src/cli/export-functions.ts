#!/usr/bin/env ts-node
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

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { CarthorseOrchestrator } from '../orchestrator/CarthorseOrchestrator';

dotenv.config();

const program = new Command();



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
      await CarthorseOrchestrator.exportProductionFunctions(options.output);
      
      console.log('✅ Function export completed successfully!');
      
    } catch (error) {
      console.error('❌ Function export failed:', error);
      process.exit(1);
    }
  });

program.parse(); 