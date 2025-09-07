import { Pool, PoolClient } from 'pg';
import { RoutePattern } from '../../types/route-pattern';
import { RouteRecommendation } from '../../types/route-recommendation';
import { ToleranceLevel } from '../../types/tolerance-level';
import { RouteGenerationBusinessLogic } from '../../utils/business/route-generation-business-logic';
import { RoutePatternSqlHelpers } from '../../utils/sql/route-pattern-sql-helpers';

export interface StandaloneLoopRouteTestConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  hawickMaxRows: number;
  useHawickCircuits: boolean;
  outputPath?: string;
}

export class StandaloneLoopRouteTestService {
  private sqlHelpers: RoutePatternSqlHelpers;

  constructor(
    private pgClient: Pool,
    private config: StandaloneLoopRouteTestConfig
  ) {
    this.sqlHelpers = new RoutePatternSqlHelpers(pgClient, config.stagingSchema);
  }

  /**
   * Main entry point for standalone loop route generation
   */
  async generateLoopRoutes(): Promise<RouteRecommendation[]> {
    console.log('🔄 [STANDALONE-LOOP] Starting standalone loop route generation...');
    console.log(`📊 [STANDALONE-LOOP] Config: ${this.config.targetRoutesPerPattern} routes/pattern, Hawick: ${this.config.useHawickCircuits}, MaxRows: ${this.config.hawickMaxRows}`);

    // Load loop patterns from database
    const loopPatterns = await this.sqlHelpers.getLoopPatterns();
    console.log(`📋 [STANDALONE-LOOP] Found ${loopPatterns.length} loop patterns: ${loopPatterns.map(p => p.pattern_name).join(', ')}`);

    if (loopPatterns.length === 0) {
      console.warn('⚠️ [STANDALONE-LOOP] No loop patterns found in database');
      return [];
    }

    const allRecommendations: RouteRecommendation[] = [];

    for (const pattern of loopPatterns) {
      console.log(`\n🎯 [STANDALONE-LOOP] Processing pattern: ${pattern.pattern_name}`);
      const patternRoutes = await this.generateRoutesForPattern(pattern);
      
      const bestRoutes = patternRoutes
        .sort((a, b) => b.route_score - a.route_score)
        .slice(0, this.config.targetRoutesPerPattern);
      
      allRecommendations.push(...bestRoutes);
      console.log(`✅ [STANDALONE-LOOP] Generated ${bestRoutes.length} loop routes for ${pattern.pattern_name}`);
    }

    console.log(`\n🔍 [STANDALONE-LOOP] Total loop routes generated: ${allRecommendations.length}`);
    
    if (this.config.outputPath) {
      await this.exportRoutes(allRecommendations);
    }

    return allRecommendations;
  }

  /**
   * Generate routes for a specific loop pattern
   */
  private async generateRoutesForPattern(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    console.log(`📏 [STANDALONE-LOOP] Targeting loop: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    
    const patternRoutes: RouteRecommendation[] = [];
    const usedAreas: any[] = [];
    const toleranceLevels = RouteGenerationBusinessLogic.getToleranceLevels(pattern);
    const seenTrailCombinations = new Set<string>();

    for (const tolerance of toleranceLevels) {
      if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;
      
      console.log(`🔍 [STANDALONE-LOOP] Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
      
      // Try Hawick Circuits if enabled
      if (this.config.useHawickCircuits) {
        await this.generateLoopsWithHawickCircuits(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
      }
      
      // Try KSP-based loops as fallback
      if (patternRoutes.length < this.config.targetRoutesPerPattern) {
        await this.generateLoopsWithKspCircuits(pattern, tolerance, patternRoutes, usedAreas, seenTrailCombinations);
      }
    }

    return patternRoutes;
  }

  /**
   * Strategy 1: Use pgr_hawickCircuits to find all cycles in the network
   * Based on golden commit implementation
   */
  private async generateLoopsWithHawickCircuits(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: any[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      console.log(`🔄 [STANDALONE-LOOP] Finding loops with Hawick Circuits...`);
      
      // Use ways_noded but find larger loops by combining multiple edges
      const loops = await this.pgClient.query(`
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
           FROM ${this.config.stagingSchema}.ways_noded
           WHERE source IS NOT NULL 
             AND target IS NOT NULL 
             AND cost >= 0.1  -- Minimum 100m segments
           ORDER BY id'
        )
        ORDER BY path_id, path_seq
        LIMIT ${this.config.hawickMaxRows}
      `);

      console.log(`🔍 [STANDALONE-LOOP] Found ${loops.rows.length} potential loop edges with Hawick Circuits`);

      // Group loops by path_id (cycle ID) instead of path_seq
      const loopGroups = new Map<number, any[]>();
      loops.rows.forEach(row => {
        if (!loopGroups.has(row.path_id)) {
          loopGroups.set(row.path_id, []);
        }
        loopGroups.get(row.path_id)!.push(row);
      });

      // Filter cycles by total distance after grouping
      const validCycles = new Map<number, any[]>();
      for (const [pathId, cycleEdges] of loopGroups) {
        const totalDistance = Math.max(...cycleEdges.map(edge => edge.agg_cost));
        const minDistance = pattern.target_distance_km * (1 - tolerance.distance / 100);
        const maxDistance = pattern.target_distance_km * (1 + tolerance.distance / 100);
        
        if (totalDistance >= minDistance && totalDistance <= maxDistance) {
          validCycles.set(pathId, cycleEdges);
        }
      }

      console.log(`🔍 [STANDALONE-LOOP] Found ${validCycles.size} valid cycles within distance tolerance`);

      for (const [pathId, loopEdges] of validCycles) {
        if (patternRoutes.length >= this.config.targetRoutesPerPattern) break;

        const route = await this.createLoopRouteFromEdges(
          pattern,
          tolerance,
          loopEdges,
          pathId,
          'hawick-circuits',
          seenTrailCombinations
        );

        if (route) {
          patternRoutes.push(route);
          console.log(`✅ [STANDALONE-LOOP] Added Hawick Circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
        }
      }
    } catch (error) {
      console.error('❌ [STANDALONE-LOOP] Error with Hawick Circuits:', error);
    }
  }

  /**
   * Strategy 2: Use KSP to find loops by connecting distant endpoints
   * Based on golden commit implementation
   */
  private async generateLoopsWithKspCircuits(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    patternRoutes: RouteRecommendation[],
    usedAreas: any[],
    seenTrailCombinations: Set<string>
  ): Promise<void> {
    try {
      console.log(`🔄 [STANDALONE-LOOP] Finding loops with KSP circuits...`);
      
      // Get endpoints that are far enough apart to form loops
      const endpoints = await this.pgClient.query(`
        SELECT DISTINCT 
          source as node_id,
          ST_X(ST_Transform(ST_Centroid(ST_Collect(geom)), 4326)) as lon,
          ST_Y(ST_Transform(ST_Centroid(ST_Collect(geom)), 4326)) as lat
        FROM ${this.config.stagingSchema}.ways_noded
        WHERE source IS NOT NULL 
          AND target IS NOT NULL
        GROUP BY source
        HAVING COUNT(*) >= 2
        ORDER BY RANDOM()
        LIMIT 20
      `);

      console.log(`🔍 [STANDALONE-LOOP] Found ${endpoints.rows.length} potential loop endpoints`);

      for (let i = 0; i < endpoints.rows.length && patternRoutes.length < this.config.targetRoutesPerPattern; i++) {
        const startNode = endpoints.rows[i];
        
        // Find KSP routes from this node
        const kspRoutes = await this.pgClient.query(`
          SELECT 
            seq,
            path_seq,
            node,
            edge,
            cost,
            agg_cost
          FROM pgr_ksp(
            'SELECT 
              id, 
              source, 
              target, 
              cost,
              reverse_cost
             FROM ${this.config.stagingSchema}.ways_noded
             WHERE source IS NOT NULL 
               AND target IS NOT NULL 
               AND cost >= 0.1
             ORDER BY id',
            ${startNode.node_id},
            ${startNode.node_id},  -- Return to start for loop
            3,  -- K value
            false
          )
          WHERE agg_cost >= $1 AND agg_cost <= $2
          ORDER BY agg_cost DESC
        `, [
          pattern.target_distance_km * (1 - tolerance.distance / 100),
          pattern.target_distance_km * (1 + tolerance.distance / 100)
        ]);

        if (kspRoutes.rows.length > 0) {
          const route = await this.createLoopRouteFromEdges(
            pattern,
            tolerance,
            kspRoutes.rows,
            i,
            'ksp-circuits',
            seenTrailCombinations
          );

          if (route) {
            patternRoutes.push(route);
            console.log(`✅ [STANDALONE-LOOP] Added KSP Circuit loop: ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, ${route.recommended_elevation_gain.toFixed(0)}m)`);
          }
        }
      }
    } catch (error) {
      console.error('❌ [STANDALONE-LOOP] Error with KSP circuits:', error);
    }
  }

  /**
   * Create a route recommendation from loop edges
   */
  private async createLoopRouteFromEdges(
    pattern: RoutePattern,
    tolerance: ToleranceLevel,
    loopEdges: any[],
    pathId: number,
    method: string,
    seenTrailCombinations: Set<string>
  ): Promise<RouteRecommendation | null> {
    try {
      if (loopEdges.length === 0) return null;

      // Get trail information for the edges
      const edgeIds = loopEdges.map(edge => edge.edge).filter(id => id !== null);
      if (edgeIds.length === 0) return null;

      const trailInfo = await this.pgClient.query(`
        SELECT 
          w.id,
          w.original_trail_id,
          w.original_trail_name,
          w.length_km,
          w.elevation_gain,
          w.elevation_loss,
          w.geom
        FROM ${this.config.stagingSchema}.ways_noded w
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

      // Calculate route score
      const distanceScore = RouteGenerationBusinessLogic.calculateDistanceScore(totalLength, pattern.target_distance_km, tolerance.distance);
      const elevationScore = RouteGenerationBusinessLogic.calculateElevationScore(totalElevationGain, pattern.target_elevation_gain, tolerance.elevation);
      const routeScore = (distanceScore + elevationScore) / 2;

      // Create route name
      const routeName = `${pattern.pattern_name} Loop (${method}) - ${trailNames.slice(0, 3).join(', ')}${trailNames.length > 3 ? '...' : ''}`;

      return {
        route_name: routeName,
        recommended_length_km: totalLength,
        recommended_elevation_gain: totalElevationGain,
        recommended_elevation_loss: totalElevationLoss,
        route_score: routeScore,
        route_type: 'loop',
        pattern_name: pattern.pattern_name,
        method: method,
        trail_names: trailNames,
        trail_count: trailNames.length,
        geometry: null, // Could be populated with ST_Collect(geom) if needed
        created_at: new Date(),
        updated_at: new Date()
      };
    } catch (error) {
      console.error('❌ [STANDALONE-LOOP] Error creating loop route:', error);
      return null;
    }
  }

  /**
   * Export routes to file if output path is specified
   */
  private async exportRoutes(routes: RouteRecommendation[]): Promise<void> {
    if (!this.config.outputPath) return;

    try {
      const fs = require('fs');
      const exportData = {
        metadata: {
          generated_at: new Date().toISOString(),
          total_routes: routes.length,
          region: this.config.region,
          staging_schema: this.config.stagingSchema
        },
        routes: routes
      };

      fs.writeFileSync(this.config.outputPath, JSON.stringify(exportData, null, 2));
      console.log(`📁 [STANDALONE-LOOP] Exported ${routes.length} routes to ${this.config.outputPath}`);
    } catch (error) {
      console.error('❌ [STANDALONE-LOOP] Error exporting routes:', error);
    }
  }
}
