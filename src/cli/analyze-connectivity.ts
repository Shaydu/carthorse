#!/usr/bin/env node
/**
 * Network Connectivity Analysis CLI
 * 
 * Analyzes trail network connectivity and identifies missing connections
 * that could improve route diversity
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Pool } from 'pg';
import { NetworkConnectivityAnalyzer, NetworkConnectivityAnalyzerConfig } from '../utils/network-connectivity-analyzer';
import { getDatabaseConfig } from '../utils/config-loader';
import * as fs from 'fs';
import * as path from 'path';

// Check database configuration
const dbConfig = getDatabaseConfig();
if (!dbConfig.database) {
  console.error(chalk.red('❌ Database configuration is missing'));
  console.error(chalk.red('   Please check your configs/carthorse.config.yaml file'));
  process.exit(1);
}

const program = new Command();

program
  .name('analyze-connectivity')
  .description('Analyze trail network connectivity and identify missing connections')
  .option('-r, --region <region>', 'Region to analyze (e.g., boulder)', 'boulder')
  .option('-s, --staging-schema <schema>', 'Staging schema to analyze')
  .option('--intersection-tolerance <meters>', 'Intersection detection tolerance in meters', '1.0')
  .option('--endpoint-tolerance <meters>', 'Endpoint connection tolerance in meters', '5.0')
  .option('--max-connection-distance <meters>', 'Maximum distance to consider for connections', '50.0')
  .option('--min-trail-length <meters>', 'Minimum trail length to consider', '100.0')
  .option('-o, --output <file>', 'Output file for analysis results (JSON)')
  .option('--generate-sql', 'Generate SQL to add missing connections')
  .option('--sql-output <file>', 'Output file for generated SQL')
  .parse(process.argv);

const options = program.opts();

async function runConnectivityAnalysis() {
  console.log(chalk.blue('🔍 Network Connectivity Analysis'));
  console.log(chalk.gray(`Region: ${options.region}`));
  
  // Connect to database
  const pgClient = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password
  });

  try {
    // Determine staging schema
    let stagingSchema = options.stagingSchema;
    if (!stagingSchema) {
      // Find the most recent staging schema for this region
      const schemaResult = await pgClient.query(`
        SELECT schemaname 
        FROM pg_tables 
        WHERE schemaname LIKE 'carthorse_%' 
          AND tablename = 'trails'
        ORDER BY schemaname DESC 
        LIMIT 1
      `);
      
      if (schemaResult.rows.length === 0) {
        throw new Error('No staging schema found. Run the orchestrator first to create a staging schema.');
      }
      
      stagingSchema = schemaResult.rows[0].schemaname;
      console.log(chalk.gray(`Using staging schema: ${stagingSchema}`));
    }

    // Create analyzer
    const analyzer = new NetworkConnectivityAnalyzer(pgClient, {
      stagingSchema,
      intersectionTolerance: parseFloat(options.intersectionTolerance),
      endpointTolerance: parseFloat(options.endpointTolerance),
      maxConnectionDistance: parseFloat(options.maxConnectionDistance),
      minTrailLength: parseFloat(options.minTrailLength)
    });

    // Run analysis
    const analysis = await analyzer.analyzeConnectivity();

    // Display results
    console.log(chalk.green('\n📊 Connectivity Analysis Results:'));
    console.log(chalk.cyan(`   🔗 Missing connections: ${analysis.missingConnections.length}`));
    console.log(chalk.cyan(`   🧩 Disconnected components: ${analysis.disconnectedComponents.length}`));
    console.log(chalk.cyan(`   📊 Connectivity score: ${analysis.connectivityScore.toFixed(2)}%`));

    if (analysis.missingConnections.length > 0) {
      console.log(chalk.yellow('\n🔗 Top Missing Connections:'));
      analysis.missingConnections.slice(0, 10).forEach((conn, i) => {
        console.log(chalk.yellow(`   ${i + 1}. ${conn.trail1_name} ↔ ${conn.trail2_name} (${conn.distance_meters.toFixed(1)}m)`));
      });
    }

    if (analysis.disconnectedComponents.length > 1) {
      console.log(chalk.yellow('\n🧩 Disconnected Components:'));
      analysis.disconnectedComponents.forEach((comp, i) => {
        console.log(chalk.yellow(`   Component ${i + 1}: ${comp.trail_count} trails, ${comp.total_length_km.toFixed(1)}km total`));
      });
    }

    console.log(chalk.green('\n💡 Recommendations:'));
    analysis.recommendations.forEach((rec, i) => {
      console.log(chalk.green(`   ${i + 1}. ${rec}`));
    });

    // Save results to file if requested
    if (options.output) {
      const outputPath = path.resolve(options.output);
      fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
      console.log(chalk.green(`\n📄 Analysis results saved to: ${outputPath}`));
    }

    // Generate SQL if requested
    if (options.generateSql && analysis.missingConnections.length > 0) {
      const sql = await analyzer.generateConnectionSQL(analysis.missingConnections);
      
      if (options.sqlOutput) {
        const sqlPath = path.resolve(options.sqlOutput);
        fs.writeFileSync(sqlPath, sql);
        console.log(chalk.green(`\n🔧 SQL generated and saved to: ${sqlPath}`));
      } else {
        console.log(chalk.green('\n🔧 Generated SQL:'));
        console.log(chalk.gray(sql));
      }
    }

    console.log(chalk.green('\n✅ Connectivity analysis complete!'));

  } catch (error) {
    console.error(chalk.red('❌ Connectivity analysis failed:'), error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

// Run the analysis
runConnectivityAnalysis(); 