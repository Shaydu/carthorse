#!/usr/bin/env ts-node
/**
 * Nuclear Reset Script for Master Database
 * 
 * This script provides a safe way to completely reset the master PostgreSQL database.
 * It requires multiple typed confirmations to prevent accidental data loss.
 * 
 * Usage:
 *   npx ts-node carthorse-nuclear-reset.ts
 * 
 * WARNING: This will permanently delete ALL data in the master database!
 */

import { Client } from 'pg';
import * as readline from 'readline';

const MASTER_DB_NAME = 'trail_master_db';
const CONFIRMATION_PHRASE = 'DELETE MASTER DATABASE';

interface ConfirmationStep {
  question: string;
  expectedAnswer: string;
  description: string;
}

class NuclearReset {
  private client: Client;
  private rl: readline.Interface;

  constructor() {
    this.client = new Client({
      host: 'localhost',
      port: 5432,
      database: 'postgres', // Connect to default postgres database first
      user: process.env.USER || 'postgres',
      password: ''
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  private async askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  private async confirmStep(step: ConfirmationStep): Promise<boolean> {
    console.log(`\n⚠️  ${step.description}`);
    console.log(`❓ ${step.question}`);
    const answer = await this.askQuestion('Your answer: ');
    
    if (answer !== step.expectedAnswer) {
      console.log(`❌ Incorrect answer. Expected: "${step.expectedAnswer}"`);
      return false;
    }
    
    console.log('✅ Confirmation accepted');
    return true;
  }

  private async getDatabaseStats(): Promise<{ trailCount: number; regions: string[] }> {
    try {
      // Connect to master database to get stats
      const masterClient = new Client({
        host: 'localhost',
        port: 5432,
        database: MASTER_DB_NAME,
        user: process.env.USER || 'postgres',
        password: ''
      });

      await masterClient.connect();
      
      const trailCountResult = await masterClient.query('SELECT COUNT(*) as count FROM trails');
      const regionsResult = await masterClient.query('SELECT DISTINCT region FROM trails WHERE region IS NOT NULL');
      
      await masterClient.end();

      return {
        trailCount: parseInt(trailCountResult.rows[0].count),
        regions: regionsResult.rows.map(row => row.region)
      };
    } catch (error) {
      console.log('⚠️  Could not connect to master database - it may not exist or be empty');
      return { trailCount: 0, regions: [] };
    }
  }

  async runNuclearReset(): Promise<void> {
    console.log('🚨 NUCLEAR RESET SCRIPT FOR MASTER DATABASE');
    console.log('=' .repeat(60));
    console.log('⚠️  WARNING: This will permanently delete ALL data!');
    console.log('⚠️  This action cannot be undone!');
    console.log('⚠️  Database schema will be preserved');
    console.log('=' .repeat(60));

    // Step 1: Show current database stats
    const stats = await this.getDatabaseStats();
    if (stats.trailCount > 0) {
      console.log(`\n📊 Current database contains:`);
      console.log(`   - ${stats.trailCount} trails`);
      console.log(`   - Regions: ${stats.regions.join(', ') || 'none'}`);
    } else {
      console.log('\n📊 Database appears to be empty or does not exist');
    }

    // Step 2: Multiple confirmation steps
    const confirmationSteps: ConfirmationStep[] = [
      {
        question: `Type the database name to confirm: "${MASTER_DB_NAME}"`,
        expectedAnswer: MASTER_DB_NAME,
        description: 'Step 1: Confirm the database name'
      },
      {
        question: `Type the confirmation phrase: "${CONFIRMATION_PHRASE}"`,
        expectedAnswer: CONFIRMATION_PHRASE,
        description: 'Step 2: Type the confirmation phrase'
      },
      {
        question: 'Type "YES" to proceed with deletion',
        expectedAnswer: 'YES',
        description: 'Step 3: Final confirmation'
      }
    ];

    for (const step of confirmationSteps) {
      const confirmed = await this.confirmStep(step);
      if (!confirmed) {
        console.log('\n❌ Nuclear reset cancelled by user');
        this.rl.close();
        return;
      }
    }

    // Step 3: Execute the nuclear reset (truncate tables)
    console.log('\n🚨 EXECUTING NUCLEAR RESET (TRUNCATING TABLES)...');
    
    try {
      // Connect directly to the master database
      const masterClient = new Client({
        host: 'localhost',
        port: 5432,
        database: MASTER_DB_NAME,
        user: process.env.USER || 'postgres',
        password: ''
      });

      await masterClient.connect();
      console.log('✅ Connected to master database');

      // Get list of tables to truncate
      const tablesResult = await masterClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const tables = tablesResult.rows.map(row => row.table_name);
      console.log(`📋 Found ${tables.length} tables to truncate: ${tables.join(', ')}`);

      // Truncate all tables (this preserves schema but removes all data)
      console.log('🗑️  Truncating all tables...');
      await masterClient.query('TRUNCATE TABLE ' + tables.join(', ') + ' RESTART IDENTITY CASCADE');
      
      await masterClient.end();
      console.log('✅ Nuclear reset completed successfully - all data cleared');
      console.log('✅ Database schema preserved');

    } catch (error) {
      console.error('❌ Nuclear reset failed:', error);
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }
}

async function main() {
  const reset = new NuclearReset();
  await reset.runNuclearReset();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Nuclear reset script failed:', error);
    process.exit(1);
  });
}

export { NuclearReset }; 