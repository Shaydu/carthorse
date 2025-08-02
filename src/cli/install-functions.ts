#!/usr/bin/env ts-node
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

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { CarthorseOrchestrator } from '../orchestrator/CarthorseOrchestrator';

dotenv.config();

const program = new Command();

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
      await CarthorseOrchestrator.installFunctions(options.input);
      
      console.log('✅ Function installation completed successfully!');
      
    } catch (error) {
      console.error('❌ Function installation failed:', error);
      process.exit(1);
    }
  });

program.parse(); 