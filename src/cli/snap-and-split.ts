#!/usr/bin/env node

import { Command } from 'commander';
import { Pool } from 'pg';
import { getDatabaseConfig } from '../utils/config-loader';
import { SnapAndSplitStrategy } from '../utils/services/network-creation/strategies/snap-and-split-strategy';
import { NetworkConfig } from '../utils/services/network-creation/types/network-types';

const program = new Command();

program
  .name('snap-and-split')
  .description('Snap nodes to trails and split trails at exactly one location per node')
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'staging_boulder_1754318437837')
  .option('-t, --tolerance <meters>', 'Intersection detection tolerance in meters', '1.0')
  .option('-r, --region <region>', 'Region to process', 'boulder')
  .option('--dry-run', 'Show what would be done without making changes')
  .parse();

interface SnapAndSplitOptions {
  stagingSchema: string;
  tolerance: string;
  region: string;
  dryRun: boolean;
}

async function runSnapAndSplit(options: SnapAndSplitOptions): Promise<void> {
  console.log('🎯 Snap-and-Split Trail Network Creation');
  console.log('========================================');
  console.log(`📍 Staging Schema: ${options.stagingSchema}`);
  console.log(`🎯 Tolerance: ${options.tolerance} meters`);
  console.log(`🌍 Region: ${options.region}`);
  console.log(`🔍 Dry Run: ${options.dryRun ? 'Yes' : 'No'}`);
  console.log('');

  let pgClient: Pool | null = null;

  try {
    // Get database configuration
    const dbConfig = getDatabaseConfig();

    // Create database connection
    pgClient = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    // Test connection
    await pgClient.query('SELECT NOW()');
    console.log('✅ Database connection established');

    // Check if staging schema exists
    const schemaCheck = await pgClient.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata 
        WHERE schema_name = $1
      )
    `, [options.stagingSchema]);

    if (!schemaCheck.rows[0].exists) {
      throw new Error(`Staging schema '${options.stagingSchema}' does not exist`);
    }

    // Check if trails table exists and has data
    const trailsCheck = await pgClient.query(`
      SELECT COUNT(*) as count 
      FROM ${options.stagingSchema}.trails 
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);

    const trailCount = parseInt(trailsCheck.rows[0].count);
    console.log(`📊 Found ${trailCount} valid trails in staging schema`);

    if (trailCount === 0) {
      throw new Error('No valid trails found in staging schema');
    }

    if (options.dryRun) {
      console.log('🔍 DRY RUN: Would execute snap-and-split function');
      console.log(`   Function: split_trails_at_snapped_nodes('${options.stagingSchema}', ${options.tolerance})`);
      return;
    }

    // Create network configuration
    const networkConfig: NetworkConfig = {
      stagingSchema: options.stagingSchema,
      tolerances: {
        intersectionDetectionTolerance: parseFloat(options.tolerance),
        edgeToVertexTolerance: 0.001,
        graphAnalysisTolerance: 0.00001,
        trueLoopTolerance: 0.00001,
        minTrailLengthMeters: 50,
        maxTrailLengthMeters: 100000
      }
    };

    // Execute snap-and-split strategy
    console.log('🔄 Executing snap-and-split network creation...');
    const strategy = new SnapAndSplitStrategy();
    const result = await strategy.createNetwork(pgClient, networkConfig);

    if (result.success) {
      console.log('');
      console.log('✅ Snap-and-split completed successfully!');
      console.log('📊 Final Results:');
      console.log(`   📍 Nodes created: ${result.stats.nodesCreated}`);
      console.log(`   🛤️ Edges created: ${result.stats.edgesCreated}`);
      console.log(`   🔗 Isolated nodes: ${result.stats.isolatedNodes}`);
      console.log(`   🚫 Orphaned edges: ${result.stats.orphanedEdges}`);
      
      // Show some sample data
      console.log('');
      console.log('📋 Sample Data:');
      
      const sampleNodes = await pgClient.query(`
        SELECT id, node_uuid, lat, lng, node_type, connected_trails
        FROM ${options.stagingSchema}.routing_nodes
        ORDER BY id
        LIMIT 5
      `);
      
      console.log('📍 Sample Nodes:');
      sampleNodes.rows.forEach(node => {
        console.log(`   Node ${node.id}: ${node.node_uuid} at (${node.lat.toFixed(6)}, ${node.lng.toFixed(6)}) - ${node.node_type} (${node.connected_trails} trails)`);
      });

      const sampleEdges = await pgClient.query(`
        SELECT id, from_node_id, to_node_id, trail_name, distance_km
        FROM ${options.stagingSchema}.routing_edges
        ORDER BY id
        LIMIT 5
      `);
      
      console.log('🛤️ Sample Edges:');
      sampleEdges.rows.forEach(edge => {
        console.log(`   Edge ${edge.id}: ${edge.from_node_id} → ${edge.to_node_id} (${edge.trail_name}) - ${edge.distance_km.toFixed(3)} km`);
      });

    } else {
      console.error('❌ Snap-and-split failed:', result.error);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Snap-and-split command failed:', error);
    process.exit(1);
  } finally {
    if (pgClient) {
      await pgClient.end();
    }
  }
}

// Run the command
const options = program.opts<SnapAndSplitOptions>();
runSnapAndSplit(options);
