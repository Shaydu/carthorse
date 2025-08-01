#!/usr/bin/env ts-node
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

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { backupDatabase } from '../utils/sql/backup';
import { getDbConfig } from '../utils/env';

dotenv.config();

const program = new Command();

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
      const dbConfig = getDbConfig();
      
      if (options.verbose) {
        console.log('📊 Database configuration:');
        console.log(`   Host: ${dbConfig.host}`);
        console.log(`   Port: ${dbConfig.port}`);
        console.log(`   Database: ${dbConfig.database}`);
        console.log(`   User: ${dbConfig.user}`);
      }
      
      // Perform backup
      await backupDatabase(dbConfig);
      
      console.log('✅ Production database backup completed successfully!');
      
    } catch (error) {
      console.error('❌ Backup failed:', error);
      process.exit(1);
    }
  });

program.parse(); 