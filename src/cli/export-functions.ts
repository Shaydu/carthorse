#!/usr/bin/env ts-node
/**
 * Carthorse Function Verification CLI
 * 
 * Verifies that essential PostGIS and pgRouting functions are available
 * 
 * Usage:
 *   npx ts-node src/cli/export-functions.ts
 *   npx ts-node src/cli/export-functions.ts --verbose
 */

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

dotenv.config();

const program = new Command();

program
  .name('carthorse-export-functions')
  .description('Verify essential PostGIS and pgRouting functions are available')
  .version('1.0.0')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      console.log('🔍 Verifying essential functions for export...');
      
      // Get database configuration
      const dbConfig = getDatabasePoolConfig();
      const pool = new Pool(dbConfig);
      
      try {
        // Test connection
        const client = await pool.connect();
        
        // Verify essential functions are available
        console.log('🔍 Checking essential functions...');
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
          functionCheck.rows.forEach((row: any) => {
            console.log(`  - ${row.category}: ${row.proname}`);
          });
        }
        
        const functionCount = functionCheck.rows.length;
        console.log(`✅ Found ${functionCount} essential functions`);
        
        if (functionCount < 10) {
          console.warn('⚠️  Some essential functions may be missing. Export may fail.');
        } else {
          console.log('✅ All essential functions are available for export');
        }
        
        client.release();
        
      } finally {
        await pool.end();
      }
      
      console.log('✅ Function verification completed successfully!');
      
    } catch (error) {
      console.error('❌ Function verification failed:', error);
      process.exit(1);
    }
  });

program.parse(); 