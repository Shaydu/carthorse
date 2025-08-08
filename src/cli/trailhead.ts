#!/usr/bin/env node

import { Command } from 'commander';
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';
import packageJson from '../../package.json';

interface TrailheadConfig {
  region: string;
  stagingSchema?: string;
  nodeId?: number;
  trailheadName?: string;
  clearAll?: boolean;
  list?: boolean;
  validate?: boolean;
  verbose?: boolean;
}

class TrailheadManager {
  private pgClient: Pool;
  private config: TrailheadConfig;

  constructor(config: TrailheadConfig) {
    this.config = config;
    
    const dbConfig = getDatabasePoolConfig();
    this.pgClient = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      max: dbConfig.max,
      idleTimeoutMillis: dbConfig.idleTimeoutMillis,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis
    });
  }

  /**
   * Mark a specific node as a trailhead
   */
  async markTrailhead(): Promise<void> {
    if (!this.config.nodeId) {
      throw new Error('Node ID is required for marking trailhead');
    }

    console.log(`🎯 Marking node ${this.config.nodeId} as trailhead...`);
    
    try {
      const result = await this.pgClient.query(`
        SELECT public.mark_node_as_trailhead($1, $2, $3)
      `, [this.config.stagingSchema, this.config.nodeId, this.config.trailheadName]);
      
      console.log(`✅ Successfully marked node ${this.config.nodeId} as trailhead`);
    } catch (error) {
      console.error(`❌ Failed to mark node as trailhead: ${error}`);
      throw error;
    }
  }

  /**
   * List all trailheads in the staging schema
   */
  async listTrailheads(): Promise<void> {
    console.log(`📋 Listing trailheads in schema ${this.config.stagingSchema}...`);
    
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM public.list_trailheads($1)
      `, [this.config.stagingSchema]);
      
      if (result.rows.length === 0) {
        console.log('📭 No trailheads found in this schema');
        return;
      }
      
      console.log(`\n🎯 Found ${result.rows.length} trailheads:`);
      console.log('─'.repeat(80));
      
      result.rows.forEach((trailhead, index) => {
        console.log(`${index + 1}. Node ${trailhead.node_id}`);
        console.log(`   Location: (${trailhead.lat.toFixed(6)}, ${trailhead.lng.toFixed(6)})`);
        console.log(`   Elevation: ${trailhead.elevation?.toFixed(0) || 'N/A'}m`);
        console.log(`   Connected trails: ${trailhead.connected_trails || 'N/A'}`);
        console.log('');
      });
    } catch (error) {
      console.error(`❌ Failed to list trailheads: ${error}`);
      throw error;
    }
  }

  /**
   * Clear all trailhead designations
   */
  async clearAllTrailheads(): Promise<void> {
    console.log(`🗑️ Clearing all trailhead designations in schema ${this.config.stagingSchema}...`);
    
    try {
      const result = await this.pgClient.query(`
        SELECT public.clear_all_trailheads($1)
      `, [this.config.stagingSchema]);
      
      const clearedCount = result.rows[0].clear_all_trailheads;
      console.log(`✅ Cleared ${clearedCount} trailhead designations`);
    } catch (error) {
      console.error(`❌ Failed to clear trailheads: ${error}`);
      throw error;
    }
  }

  /**
   * Validate trailhead setup
   */
  async validateTrailheadSetup(): Promise<void> {
    console.log(`🔍 Validating trailhead setup in schema ${this.config.stagingSchema}...`);
    
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM public.validate_trailhead_setup($1)
      `, [this.config.stagingSchema]);
      
      const validation = result.rows[0];
      
      console.log(`📊 Trailhead validation results:`);
      console.log(`   - Valid setup: ${validation.is_valid ? '✅ Yes' : '❌ No'}`);
      console.log(`   - Message: ${validation.message}`);
      console.log(`   - Trailhead count: ${validation.trailhead_count}`);
      console.log(`   - Total nodes: ${validation.total_nodes}`);
      
      if (validation.is_valid) {
        console.log(`✅ Trailhead setup is valid and ready for route generation`);
      } else {
        console.log(`⚠️ No trailheads found - route generation will use default entry points`);
      }
    } catch (error) {
      console.error(`❌ Failed to validate trailhead setup: ${error}`);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

// CLI Command Setup
const program = new Command();

program
  .name('trailhead')
  .description('Manage trailhead nodes for route generation')
  .version(packageJson.version)
  .addHelpText('after', `

Examples:
  $ carthorse trailhead mark --region boulder --schema staging_boulder_123 --node-id 42
  $ carthorse trailhead mark --region boulder --schema staging_boulder_123 --node-id 42 --name "Chautauqua Trailhead"
  $ carthorse trailhead list --region boulder --schema staging_boulder_123
  $ carthorse trailhead clear --region boulder --schema staging_boulder_123
  $ carthorse trailhead validate --region boulder --schema staging_boulder_123

Notes:
  - Trailheads are nodes designated as starting points for route generation
  - When trailheads are set, route generation will use only trailhead nodes
  - If no trailheads are set, route generation uses default entry points
  - Use --verbose for detailed output`);

// Mark trailhead command
program
  .command('mark')
  .description('Mark a specific node as a trailhead')
  .requiredOption('-r, --region <region>', 'Region name (e.g., boulder)')
  .requiredOption('-s, --schema <schema>', 'Staging schema name')
  .requiredOption('-n, --node-id <id>', 'Node ID to mark as trailhead')
  .option('--name <name>', 'Optional trailhead name')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    const manager = new TrailheadManager({
      region: options.region,
      stagingSchema: options.schema,
      nodeId: parseInt(options.nodeId),
      trailheadName: options.name,
      verbose: options.verbose
    });
    
    try {
      await manager.markTrailhead();
    } finally {
      await manager.close();
    }
  });

// List trailheads command
program
  .command('list')
  .description('List all trailheads in a staging schema')
  .requiredOption('-r, --region <region>', 'Region name (e.g., boulder)')
  .requiredOption('-s, --schema <schema>', 'Staging schema name')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    const manager = new TrailheadManager({
      region: options.region,
      stagingSchema: options.schema,
      list: true,
      verbose: options.verbose
    });
    
    try {
      await manager.listTrailheads();
    } finally {
      await manager.close();
    }
  });

// Clear trailheads command
program
  .command('clear')
  .description('Clear all trailhead designations')
  .requiredOption('-r, --region <region>', 'Region name (e.g., boulder)')
  .requiredOption('-s, --schema <schema>', 'Staging schema name')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    const manager = new TrailheadManager({
      region: options.region,
      stagingSchema: options.schema,
      clearAll: true,
      verbose: options.verbose
    });
    
    try {
      await manager.clearAllTrailheads();
    } finally {
      await manager.close();
    }
  });

// Validate trailhead setup command
program
  .command('validate')
  .description('Validate trailhead setup')
  .requiredOption('-r, --region <region>', 'Region name (e.g., boulder)')
  .requiredOption('-s, --schema <schema>', 'Staging schema name')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    const manager = new TrailheadManager({
      region: options.region,
      stagingSchema: options.schema,
      validate: true,
      verbose: options.verbose
    });
    
    try {
      await manager.validateTrailheadSetup();
    } finally {
      await manager.close();
    }
  });

// Parse command line arguments
program.parse(); 