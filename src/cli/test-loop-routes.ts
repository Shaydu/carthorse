#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { Command } from 'commander';
import { StandaloneLoopRouteTestService, StandaloneLoopRouteTestConfig } from '../services/standalone/StandaloneLoopRouteTestService';
import { ConfigLoader } from '../utils/config-loader';

const program = new Command();

program
  .name('test-loop-routes')
  .description('Standalone test service for generating loop routes against staging trails')
  .version('1.0.0');

program
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'carthorse_latest')
  .option('-r, --region <region>', 'Region name', 'boulder')
  .option('-t, --target-routes <number>', 'Target routes per pattern', '20')
  .option('-m, --hawick-max-rows <number>', 'Max rows for Hawick circuits', '10000')
  .option('--use-hawick', 'Enable Hawick circuits', true)
  .option('--no-hawick', 'Disable Hawick circuits')
  .option('-o, --output <path>', 'Output file path for results')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      console.log('🔄 [TEST-LOOP] Starting standalone loop route test...');
      console.log(`📊 [TEST-LOOP] Options:`, options);

      // Load configuration
      const configLoader = new ConfigLoader();
      const config = await configLoader.loadConfig();

      // Create database connection
      const pgClient = new Pool({
        host: config.database.host,
        port: config.database.port,
        database: config.database.database,
        user: config.database.user,
        password: config.database.password,
        max: 1
      });

      // Test connection
      await pgClient.query('SELECT 1');
      console.log('✅ [TEST-LOOP] Database connection established');

      // Create service configuration
      const serviceConfig: StandaloneLoopRouteTestConfig = {
        stagingSchema: options.stagingSchema,
        region: options.region,
        targetRoutesPerPattern: parseInt(options.targetRoutes),
        hawickMaxRows: parseInt(options.hawickMaxRows),
        useHawickCircuits: options.useHawick,
        outputPath: options.output
      };

      // Create and run service
      const service = new StandaloneLoopRouteTestService(pgClient, serviceConfig);
      const routes = await service.generateLoopRoutes();

      console.log(`\n🎉 [TEST-LOOP] Test completed successfully!`);
      console.log(`📊 [TEST-LOOP] Generated ${routes.length} total loop routes`);
      
      if (routes.length > 0) {
        console.log(`\n📋 [TEST-LOOP] Route summary:`);
        const patternGroups = routes.reduce((acc, route) => {
          if (!acc[route.pattern_name]) acc[route.pattern_name] = [];
          acc[route.pattern_name].push(route);
          return acc;
        }, {} as Record<string, typeof routes>);

        Object.entries(patternGroups).forEach(([pattern, patternRoutes]) => {
          console.log(`  ${pattern}: ${patternRoutes.length} routes`);
          patternRoutes.slice(0, 3).forEach(route => {
            console.log(`    - ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m, score: ${route.route_score.toFixed(2)})`);
          });
          if (patternRoutes.length > 3) {
            console.log(`    ... and ${patternRoutes.length - 3} more`);
          }
        });
      }

      await pgClient.end();
      console.log('✅ [TEST-LOOP] Database connection closed');

    } catch (error) {
      console.error('❌ [TEST-LOOP] Error:', error);
      process.exit(1);
    }
  });

program.parse();
