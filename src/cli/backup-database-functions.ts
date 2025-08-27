#!/usr/bin/env ts-node

import { Command } from 'commander';
import { Pool } from 'pg';
import { DatabaseFunctionBackup } from '../utils/validation/database-function-backup';
import { DatabaseFunctionValidator } from '../utils/validation/database-function-validator';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('backup-database-functions')
  .description('Backup and restore database functions for route generation')
  .version('1.0.0');

// Create backup
program
  .command('create')
  .description('Create a backup of all database functions')
  .option('-o, --output <dir>', 'Output directory for backup', './backups/database-functions')
  .action(async (options) => {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      const backup = new DatabaseFunctionBackup(pool, options.output);
      const backupFile = await backup.createBackup();
      
      console.log(`\n✅ Backup completed successfully!`);
      console.log(`📁 Backup file: ${backupFile}`);
      
      await pool.end();
    } catch (error) {
      console.error('❌ Backup failed:', error);
      process.exit(1);
    }
  });

// List backups
program
  .command('list')
  .description('List all available backups')
  .option('-d, --dir <dir>', 'Backup directory', './backups/database-functions')
  .action(async (options) => {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      const backup = new DatabaseFunctionBackup(pool, options.dir);
      const backups = backup.listBackups();
      
      if (backups.length === 0) {
        console.log('📭 No backups found');
        return;
      }

      console.log('📋 Available backups:');
      console.log('');
      
      backups.forEach((backup, index) => {
        console.log(`${index + 1}. ${backup.file}`);
        console.log(`   📅 Created: ${backup.timestamp}`);
        console.log(`   📊 Functions: ${backup.functions} (${backup.critical} critical)`);
        console.log('');
      });
      
      await pool.end();
    } catch (error) {
      console.error('❌ Failed to list backups:', error);
      process.exit(1);
    }
  });

// Restore from backup
program
  .command('restore')
  .description('Restore functions from backup')
  .option('-f, --file <file>', 'Specific backup file to restore from')
  .option('-d, --dir <dir>', 'Backup directory', './backups/database-functions')
  .option('--dry-run', 'Show what would be restored without actually restoring')
  .action(async (options) => {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      const backup = new DatabaseFunctionBackup(pool, options.dir);
      
      if (options.dryRun) {
        const fileToUse = options.file || backup.getLatestBackup();
        if (!fileToUse) {
          console.log('❌ No backup file found');
          return;
        }
        
        const metadata = backup.loadBackup(fileToUse);
        console.log(`📋 Would restore from: ${fileToUse}`);
        console.log(`📊 Functions to restore: ${metadata.totalFunctions}`);
        console.log(`🚨 Critical functions: ${metadata.criticalFunctions}`);
        console.log('');
        
        metadata.functions.forEach(func => {
          console.log(`   ${func.critical ? '🚨' : '📝'} ${func.name} (${func.critical ? 'CRITICAL' : 'optional'})`);
        });
        
        return;
      }

      const result = await backup.restoreFromBackup(options.file);
      
      if (result.failed.length > 0) {
        console.log(`\n⚠️  Some functions failed to restore:`);
        result.failed.forEach(func => console.log(`   - ${func}`));
      }
      
      if (result.errors.length > 0) {
        console.log(`\n❌ Errors during restoration:`);
        result.errors.forEach(error => console.log(`   - ${error}`));
      }
      
      await pool.end();
    } catch (error) {
      console.error('❌ Restoration failed:', error);
      process.exit(1);
    }
  });

// Validate functions
program
  .command('validate')
  .description('Validate that all required functions are present')
  .action(async () => {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      const validator = new DatabaseFunctionValidator(pool);
      const result = await validator.validateDatabase();
      
      if (result.isValid) {
        console.log('✅ All required functions are present and valid');
      } else {
        console.log('❌ Validation failed');
        console.log('');
        
        if (result.functionValidation.criticalMissingFunctions.length > 0) {
          console.log('🚨 Missing critical functions:');
          result.functionValidation.criticalMissingFunctions.forEach(func => {
            console.log(`   - ${func}`);
          });
          console.log('');
        }
        
        if (result.tableValidation.missingTables.length > 0) {
          console.log('📋 Missing required tables:');
          result.tableValidation.missingTables.forEach(table => {
            console.log(`   - ${table}`);
          });
          console.log('');
        }
      }
      
      await pool.end();
    } catch (error) {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    }
  });

// Auto-restore
program
  .command('auto-restore')
  .description('Automatically restore missing critical functions')
  .option('-d, --dir <dir>', 'Backup directory', './backups/database-functions')
  .action(async (options) => {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      const backup = new DatabaseFunctionBackup(pool, options.dir);
      const result = await backup.autoRestoreIfNeeded();
      
      if (result.restored) {
        console.log(`\n✅ Auto-restore completed successfully!`);
        console.log(`🔧 Restored functions: ${result.restoredFunctions.join(', ')}`);
      } else {
        console.log('✅ No restoration needed - all critical functions are present');
      }
      
      if (result.errors.length > 0) {
        console.log(`\n⚠️  Errors during auto-restore:`);
        result.errors.forEach(error => console.log(`   - ${error}`));
      }
      
      await pool.end();
    } catch (error) {
      console.error('❌ Auto-restore failed:', error);
      process.exit(1);
    }
  });

// Create restoration script
program
  .command('create-script')
  .description('Create a SQL script for manual restoration')
  .option('-f, --file <file>', 'Specific backup file to use')
  .option('-d, --dir <dir>', 'Backup directory', './backups/database-functions')
  .action(async (options) => {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      const backup = new DatabaseFunctionBackup(pool, options.dir);
      const scriptFile = await backup.createRestorationScript(options.file);
      
      console.log(`\n✅ Restoration script created: ${scriptFile}`);
      console.log('📝 You can run this script manually with:');
      console.log(`   psql -d trail_master_db -f ${scriptFile}`);
      
      await pool.end();
    } catch (error) {
      console.error('❌ Failed to create restoration script:', error);
      process.exit(1);
    }
  });

// Check status
program
  .command('status')
  .description('Check the status of database functions')
  .action(async () => {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      const backup = new DatabaseFunctionBackup(pool);
      const validator = new DatabaseFunctionValidator(pool);
      
      console.log('🔍 Checking database function status...\n');
      
      // Check critical functions
      const criticalValidation = await backup.validateCriticalFunctions();
      console.log('🚨 Critical Functions:');
      console.log(`   ✅ Present: ${criticalValidation.present.length}`);
      console.log(`   ❌ Missing: ${criticalValidation.missing.length}`);
      
      if (criticalValidation.missing.length > 0) {
        console.log('   Missing functions:');
        criticalValidation.missing.forEach(func => console.log(`     - ${func}`));
      }
      console.log('');
      
      // Check all functions
      const fullValidation = await validator.validateDatabaseFunctions();
      console.log('📊 All Functions:');
      console.log(`   ✅ Valid: ${fullValidation.validationResults.filter(r => r.exists).length}`);
      console.log(`   ❌ Missing: ${fullValidation.missingFunctions.length}`);
      console.log(`   🚨 Critical missing: ${fullValidation.criticalMissingFunctions.length}`);
      console.log('');
      
      // Check backups
      const backups = backup.listBackups();
      console.log('💾 Backups:');
      console.log(`   📁 Available: ${backups.length}`);
      if (backups.length > 0) {
        const latest = backups[0];
        console.log(`   📅 Latest: ${latest.timestamp} (${latest.functions} functions, ${latest.critical} critical)`);
      }
      console.log('');
      
      // Overall status
      const overallValid = criticalValidation.isValid && fullValidation.isValid;
      console.log(`📈 Overall Status: ${overallValid ? '✅ HEALTHY' : '❌ NEEDS ATTENTION'}`);
      
      if (!overallValid) {
        console.log('\n💡 Recommendations:');
        if (criticalValidation.missing.length > 0) {
          console.log('   - Run: npm run backup-db-functions auto-restore');
        }
        if (backups.length === 0) {
          console.log('   - Run: npm run backup-db-functions create');
        }
      }
      
      await pool.end();
    } catch (error) {
      console.error('❌ Status check failed:', error);
      process.exit(1);
    }
  });

program.parse();
