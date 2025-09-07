#!/usr/bin/env npx ts-node

import { Pool } from 'pg';
import { Command } from 'commander';
import { loadConfig } from '../utils/config-loader';

const program = new Command();

program
  .name('test-hawick-loops')
  .description('Standalone test for Hawick loop generation against staging trails')
  .version('1.0.0');

program
  .option('-s, --staging-schema <schema>', 'Staging schema name', 'carthorse_latest')
  .option('-r, --region <region>', 'Region name', 'boulder')
  .option('-t, --target-routes <number>', 'Target routes per pattern', '20')
  .option('-m, --max-rows <number>', 'Max rows for Hawick circuits', '10000')
  .option('-o, --output <path>', 'Output file path for results')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      console.log('🔄 [HAWICK-LOOPS] Starting standalone Hawick loop test...');
      console.log(`📊 [HAWICK-LOOPS] Options:`, options);

      // Load configuration
      const config = loadConfig();

      // Create database connection
      const pgClient = new Pool({
        host: config.database.connection.host,
        port: config.database.connection.port,
        database: config.database.connection.database,
        user: config.database.connection.user,
        password: config.database.connection.password,
        max: 1
      });

      // Test connection
      await pgClient.query('SELECT 1');
      console.log('✅ [HAWICK-LOOPS] Database connection established');

      // Check if staging schema and ways_noded table exist
      const schemaExists = await pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.schemata 
          WHERE schema_name = $1
        )
      `, [options.stagingSchema]);

      if (!schemaExists.rows[0].exists) {
        throw new Error(`Staging schema '${options.stagingSchema}' does not exist`);
      }

      const waysNodedExists = await pgClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'ways_noded'
        )
      `, [options.stagingSchema]);

      if (!waysNodedExists.rows[0].exists) {
        throw new Error(`Table '${options.stagingSchema}.ways_noded' does not exist. Run Layer 2 first.`);
      }

      const waysNodedCount = await pgClient.query(`
        SELECT COUNT(*) as count FROM ${options.stagingSchema}.ways_noded
      `);

      console.log(`📊 [HAWICK-LOOPS] Found ${waysNodedCount.rows[0].count} edges in ways_noded table`);

      // Load loop patterns from database
      const loopPatterns = await pgClient.query(`
        SELECT 
          pattern_name,
          target_distance_km,
          target_elevation_gain,
          route_shape
        FROM public.route_patterns 
        WHERE route_shape = 'loop'
        ORDER BY target_distance_km
      `);

      console.log(`📋 [HAWICK-LOOPS] Found ${loopPatterns.rows.length} loop patterns: ${loopPatterns.rows.map(p => p.pattern_name).join(', ')}`);

      if (loopPatterns.rows.length === 0) {
        console.warn('⚠️ [HAWICK-LOOPS] No loop patterns found in database');
        await pgClient.end();
        return;
      }

      const allRoutes: any[] = [];

      // Process each loop pattern
      for (const pattern of loopPatterns.rows) {
        console.log(`\n🎯 [HAWICK-LOOPS] Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
        
        const patternRoutes = await generateHawickLoopsForPattern(
          pgClient, 
          options.stagingSchema, 
          pattern, 
          parseInt(options.targetRoutes),
          parseInt(options.maxRows)
        );
        
        allRoutes.push(...patternRoutes);
        console.log(`✅ [HAWICK-LOOPS] Generated ${patternRoutes.length} routes for ${pattern.pattern_name}`);
      }

      console.log(`\n🎉 [HAWICK-LOOPS] Test completed successfully!`);
      console.log(`📊 [HAWICK-LOOPS] Generated ${allRoutes.length} total Hawick loop routes`);
      
      if (allRoutes.length > 0) {
        console.log(`\n📋 [HAWICK-LOOPS] Route summary:`);
        const patternGroups = allRoutes.reduce((acc, route) => {
          if (!acc[route.pattern_name]) acc[route.pattern_name] = [];
          acc[route.pattern_name].push(route);
          return acc;
        }, {} as Record<string, any[]>);

        Object.entries(patternGroups).forEach(([pattern, patternRoutes]) => {
          const routes = patternRoutes as any[];
          console.log(`  ${pattern}: ${routes.length} routes`);
          routes.slice(0, 3).forEach((route: any) => {
            console.log(`    - ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m, score: ${route.route_score.toFixed(2)})`);
          });
          if (routes.length > 3) {
            console.log(`    ... and ${routes.length - 3} more`);
          }
        });
      }

      // Export results if output path specified
      if (options.output) {
        const fs = require('fs');
        const exportData = {
          metadata: {
            generated_at: new Date().toISOString(),
            total_routes: allRoutes.length,
            region: options.region,
            staging_schema: options.stagingSchema,
            method: 'hawick-circuits'
          },
          routes: allRoutes
        };

        fs.writeFileSync(options.output, JSON.stringify(exportData, null, 2));
        console.log(`📁 [HAWICK-LOOPS] Exported ${allRoutes.length} routes to ${options.output}`);
      }

      await pgClient.end();
      console.log('✅ [HAWICK-LOOPS] Database connection closed');

    } catch (error) {
      console.error('❌ [HAWICK-LOOPS] Error:', error);
      process.exit(1);
    }
  });

/**
 * Generate Hawick loops for a specific pattern
 * Based on holy grail branch implementation
 */
async function generateHawickLoopsForPattern(
  pgClient: Pool,
  stagingSchema: string,
  pattern: any,
  targetRoutes: number,
  maxRows: number
): Promise<any[]> {
  const routes: any[] = [];
  const seenTrailCombinations = new Set<string>();

  try {
    console.log(`🔄 [HAWICK-LOOPS] Finding loops with Hawick Circuits for ${pattern.pattern_name}...`);
    
    // Use Hawick circuits to find all cycles in the network
    const loops = await pgClient.query(`
      SELECT 
        path_id,
        seq,
        path_seq,
        node,
        edge,
        cost,
        agg_cost
      FROM pgr_hawickcircuits(
        'SELECT 
          id, 
          source, 
          target, 
          cost,
          reverse_cost
         FROM ${stagingSchema}.ways_noded
         WHERE source IS NOT NULL 
           AND target IS NOT NULL 
           AND cost >= 0.1  -- Minimum 100m segments
         ORDER BY id'
      )
      ORDER BY path_id, path_seq
      LIMIT ${maxRows}
    `);

    console.log(`🔍 [HAWICK-LOOPS] Found ${loops.rows.length} potential loop edges with Hawick Circuits`);

    // Group loops by path_id (cycle ID)
    const loopGroups = new Map<number, any[]>();
    loops.rows.forEach(row => {
      if (!loopGroups.has(row.path_id)) {
        loopGroups.set(row.path_id, []);
      }
      loopGroups.get(row.path_id)!.push(row);
    });

    // Filter cycles by total distance
    const validCycles = new Map<number, any[]>();
    const tolerance = 20; // 20% tolerance for distance
    
    for (const [pathId, cycleEdges] of loopGroups) {
      const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
      const minDistance = pattern.target_distance_km * (1 - tolerance / 100);
      const maxDistance = pattern.target_distance_km * (1 + tolerance / 100);
      
      if (totalDistance >= minDistance && totalDistance <= maxDistance) {
        validCycles.set(pathId, cycleEdges);
      }
    }

    console.log(`🔍 [HAWICK-LOOPS] Found ${validCycles.size} valid cycles within distance tolerance`);

    // Process valid cycles
    for (const [pathId, loopEdges] of validCycles) {
      if (routes.length >= targetRoutes) break;

      const route = await createLoopRouteFromEdges(
        pgClient,
        stagingSchema,
        pattern,
        loopEdges,
        pathId,
        seenTrailCombinations
      );

      if (route) {
        routes.push(route);
        console.log(`✅ [HAWICK-LOOPS] Added Hawick Circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
      }
    }

  } catch (error) {
    console.error('❌ [HAWICK-LOOPS] Error with Hawick Circuits:', error);
  }

  return routes;
}

/**
 * Create a route recommendation from loop edges
 */
async function createLoopRouteFromEdges(
  pgClient: Pool,
  stagingSchema: string,
  pattern: any,
  loopEdges: any[],
  pathId: number,
  seenTrailCombinations: Set<string>
): Promise<any | null> {
  try {
    if (loopEdges.length === 0) return null;

    // Get trail information for the edges
    const edgeIds = loopEdges.map(edge => edge.edge).filter(id => id !== null);
    if (edgeIds.length === 0) return null;

    const trailInfo = await pgClient.query(`
      SELECT 
        w.id,
        w.original_trail_id,
        w.original_trail_name,
        w.length_km,
        w.elevation_gain,
        w.elevation_loss
      FROM ${stagingSchema}.ways_noded w
      WHERE w.id = ANY($1)
    `, [edgeIds]);

    if (trailInfo.rows.length === 0) return null;

    // Calculate totals
    const totalLength = trailInfo.rows.reduce((sum, trail) => sum + parseFloat(trail.length_km), 0);
    const totalElevationGain = trailInfo.rows.reduce((sum, trail) => sum + parseFloat(trail.elevation_gain || 0), 0);
    const totalElevationLoss = trailInfo.rows.reduce((sum, trail) => sum + parseFloat(trail.elevation_loss || 0), 0);

    // Create trail combination key for deduplication
    const trailNames = trailInfo.rows.map(t => t.original_trail_name).sort();
    const combinationKey = trailNames.join('|');
    
    if (seenTrailCombinations.has(combinationKey)) {
      return null; // Skip duplicate
    }
    seenTrailCombinations.add(combinationKey);

    // Calculate route score (simple distance and elevation scoring)
    const distanceScore = Math.max(0, 100 - Math.abs(totalLength - pattern.target_distance_km) / pattern.target_distance_km * 100);
    const elevationScore = Math.max(0, 100 - Math.abs(totalElevationGain - pattern.target_elevation_gain) / Math.max(pattern.target_elevation_gain, 1) * 100);
    const routeScore = (distanceScore + elevationScore) / 2;

    // Create route name
    const routeName = `${pattern.pattern_name} Hawick Loop - ${trailNames.slice(0, 3).join(', ')}${trailNames.length > 3 ? '...' : ''}`;

    return {
      route_name: routeName,
      recommended_length_km: totalLength,
      recommended_elevation_gain: totalElevationGain,
      recommended_elevation_loss: totalElevationLoss,
      route_score: routeScore,
      route_type: 'loop',
      pattern_name: pattern.pattern_name,
      method: 'hawick-circuits',
      trail_names: trailNames,
      trail_count: trailNames.length,
      path_id: pathId,
      created_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ [HAWICK-LOOPS] Error creating loop route:', error);
    return null;
  }
}

program.parse();
