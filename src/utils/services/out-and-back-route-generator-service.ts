import { Pool } from 'pg';
import { RoutePattern, RouteRecommendation } from '../ksp-route-generator';
import { RoutePatternSqlHelpers } from '../sql/route-pattern-sql-helpers';
import { RouteDiscoveryConfigLoader } from '../../config/route-discovery-config-loader';
import * as fs from 'fs';
import * as path from 'path';

export interface OutAndBackGeneratorConfig {
  stagingSchema: string;
  region: string;
  targetRoutesPerPattern: number;
  minDistanceBetweenRoutes: number;
}

export class OutAndBackGeneratorService {
  private sqlHelpers: RoutePatternSqlHelpers;
  private configLoader: RouteDiscoveryConfigLoader;
  private logFile: string;

  constructor(
    private pgClient: Pool,
    private config: OutAndBackGeneratorConfig
  ) {
    this.sqlHelpers = new RoutePatternSqlHelpers(pgClient);
    this.configLoader = RouteDiscoveryConfigLoader.getInstance();
    
    this.logFile = path.join(process.cwd(), 'logs', 'out-and-back-generation.log');
    
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(message);
    try {
      fs.appendFileSync(this.logFile, logMessage + '\n');
    } catch (error) {
      console.warn(`⚠️ Failed to write to log file ${this.logFile}:`, error);
    }
  }

  /**
   * Generate true out-and-back routes from existing P2P routes
   * Creates A-B-C-D-C-B-A patterns with proper doubled geometry and stats
   */
  async generateOutAndBackRoutes(): Promise<RouteRecommendation[]> {
    this.log('[OUT-AND-BACK] 🎯 Generating true out-and-back routes from P2P routes...');
    
    const patterns = await this.sqlHelpers.loadOutAndBackPatterns();
    const allRecommendations: RouteRecommendation[] = [];
    
    this.log(`[OUT-AND-BACK] 📊 ROUTE GENERATION SUMMARY:`);
    this.log(`[OUT-AND-BACK]    - Total patterns to process: ${patterns.length}`);
    this.log(`[OUT-AND-BACK]    - Target routes per pattern: ${this.config.targetRoutesPerPattern}`);
    
    for (const pattern of patterns) {
      this.log(`[OUT-AND-BACK] \n🎯 Processing out-and-back pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      const patternRoutes = await this.generateOutAndBackRoutesForPattern(pattern);
      
      allRecommendations.push(...patternRoutes);
      this.log(`[OUT-AND-BACK] ✅ Generated ${patternRoutes.length} true out-and-back routes for ${pattern.pattern_name}`);
      
      patternRoutes.forEach((route, index) => {
        this.log(`[OUT-AND-BACK]    ${index + 1}. ${route.route_name} (${route.recommended_length_km.toFixed(2)}km, +${route.recommended_elevation_gain.toFixed(0)}m)`);
      });
    }

    return allRecommendations;
  }

  /**
   * Generate true out-and-back routes for a specific pattern
   */
  private async generateOutAndBackRoutesForPattern(pattern: RoutePattern): Promise<RouteRecommendation[]> {
    // Find existing P2P routes that could be converted to out-and-back
    const existingP2PRoutes = await this.pgClient.query(`
      SELECT 
        route_uuid,
        route_name,
        recommended_length_km as one_way_distance,
        recommended_elevation_gain as one_way_elevation,
        route_path,
        route_edges,
        route_score,
        similarity_score
      FROM ${this.config.stagingSchema}.route_recommendations 
      WHERE route_shape = 'point-to-point'
        AND recommended_length_km BETWEEN $1 * 0.5 AND $1 * 1.5
        AND recommended_elevation_gain BETWEEN $2 * 0.5 AND $2 * 1.5
      ORDER BY route_score DESC
      LIMIT 30
    `, [pattern.target_distance_km / 2, pattern.target_elevation_gain / 2]);
    
    if (existingP2PRoutes.rows.length === 0) {
      this.log('⚠️ No suitable point-to-point routes found for out-and-back conversion');
      return [];
    }
    
    this.log(`✅ Found ${existingP2PRoutes.rows.length} suitable point-to-point routes for conversion`);
    
    const outAndBackRoutes: RouteRecommendation[] = [];
    
    for (const p2pRoute of existingP2PRoutes.rows.slice(0, this.config.targetRoutesPerPattern)) {
      try {
        this.log(`🔄 Converting P2P route: ${p2pRoute.route_name} (${p2pRoute.one_way_distance.toFixed(2)}km → ${(p2pRoute.one_way_distance * 2).toFixed(2)}km)`);
        
        // Parse the existing route path
        const routePath = p2pRoute.route_path;
        const routeEdges = p2pRoute.route_edges;
        
        if (!routePath || !routePath.steps || !Array.isArray(routePath.steps)) {
          this.log(`  ⚠️ Invalid route path for ${p2pRoute.route_uuid}`);
          continue;
        }
        
        // Create the out-and-back route path: A-B-C-D-C-B-A
        const outboundSteps = routePath.steps;
        const returnSteps = [...outboundSteps].reverse().map((step: any, index: number) => ({
          ...step,
          seq: outboundSteps.length + index,
          path_seq: outboundSteps.length + index,
          agg_cost: step.agg_cost + outboundSteps[outboundSteps.length - 1].agg_cost
        }));
        
        const outAndBackPath = {
          path_id: routePath.path_id,
          steps: [...outboundSteps, ...returnSteps] // A-B-C-D-C-B-A pattern
        };
        
        // Get the geometry for the outbound journey
        const outboundEdgeIds = outboundSteps
          .map((step: any) => step.edge)
          .filter((edge: number) => edge !== -1);
        
        if (outboundEdgeIds.length === 0) {
          this.log(`  ⚠️ No valid edges found for route ${p2pRoute.route_uuid}`);
          continue;
        }
        
        // Create the true out-and-back geometry: outbound + reversed return
        const outAndBackGeometry = await this.createOutAndBackGeometry(outboundEdgeIds);
        
        if (!outAndBackGeometry) {
          this.log(`  ⚠️ No geometry found for route ${p2pRoute.route_uuid}`);
          continue;
        }
        
        // Use the actual calculated distance from the geometry
        const outAndBackDistance = outAndBackGeometry.length_km;
        const outboundLength = outAndBackGeometry.outbound_length_km;
        
        // Calculate elevation stats from the actual geometry
        const elevationStats = await this.calculateElevationStatsFromGeometry(outAndBackGeometry.geometry);
        const outAndBackElevation = elevationStats.total_elevation_gain;
        
        this.log(`  📏 Route metrics: ${outboundLength.toFixed(2)}km outbound → ${outAndBackDistance.toFixed(2)}km total (out-and-back), ${outAndBackElevation.toFixed(0)}m elevation`);
        this.log(`  🔄 Geometry validation: start/end match = ${outAndBackGeometry.points_match}`);
        
        // Check if the out-and-back route meets the target criteria
        const distanceOk = outAndBackDistance >= pattern.target_distance_km * 0.8 && outAndBackDistance <= pattern.target_distance_km * 1.2;
        const elevationOk = outAndBackElevation >= pattern.target_elevation_gain * 0.8 && outAndBackElevation <= pattern.target_elevation_gain * 1.2;
        
        if (distanceOk && elevationOk) {
          // Calculate quality score based on how well it matches the target
          const distanceScore = 1.0 - Math.abs(outAndBackDistance - pattern.target_distance_km) / pattern.target_distance_km;
          const elevationScore = 1.0 - Math.abs(outAndBackElevation - pattern.target_elevation_gain) / pattern.target_elevation_gain;
          const finalScore = (distanceScore + elevationScore) / 2;
          
          this.log(`  ✅ Route meets criteria! Score: ${finalScore.toFixed(3)}`);
          
          // Create a synthetic edge that represents the complete out-and-back route
          const outAndBackEdge = {
            id: `out-and-back-${p2pRoute.route_uuid}`,
            cost: outAndBackDistance,
            trail_name: `${p2pRoute.route_name} (True Out-and-Back)`,
            trail_type: 'out-and-back',
            elevation_gain: outAndBackElevation,
            elevation_loss: elevationStats.total_elevation_loss,
            geometry: outAndBackGeometry.geometry,
            length_km: outAndBackDistance
          };
          
          // Create the out-and-back route recommendation
          const recommendation: RouteRecommendation = {
            route_uuid: `true-out-and-back-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            route_name: `${pattern.pattern_name} - True Out-and-Back via ${p2pRoute.route_name}`,
            route_shape: 'out-and-back',
            input_length_km: pattern.target_distance_km,
            input_elevation_gain: pattern.target_elevation_gain,
            recommended_length_km: outAndBackDistance,
            recommended_elevation_gain: outAndBackElevation,
            route_path: outAndBackPath,
            route_edges: [outAndBackEdge],
            trail_count: 1,
            route_score: Math.floor(finalScore * 100),
            similarity_score: finalScore,
            region: this.config.region
          };
          
          outAndBackRoutes.push(recommendation);
          
          if (outAndBackRoutes.length >= this.config.targetRoutesPerPattern) {
            this.log(`  🎯 Reached ${this.config.targetRoutesPerPattern} out-and-back routes`);
            break;
          }
        } else {
          this.log(`  ❌ Route doesn't meet criteria (distance: ${distanceOk}, elevation: ${elevationOk})`);
        }
        
      } catch (error: any) {
        this.log(`❌ Failed to convert route ${p2pRoute.route_uuid}: ${error.message}`);
      }
    }
    
    // Sort by score and take top routes
    const bestRoutes = outAndBackRoutes
      .sort((a, b) => b.route_score - a.route_score)
      .slice(0, this.config.targetRoutesPerPattern);
    
    this.log(`✅ Generated ${bestRoutes.length} TRUE out-and-back routes for ${pattern.pattern_name}`);
    return bestRoutes;
  }

  /**
   * Create true out-and-back geometry: A-B-C-D + D-C-B-A = A-B-C-D-C-B-A
   */
  private async createOutAndBackGeometry(outboundEdgeIds: number[]): Promise<any> {
    try {
      // First, get the complete outbound path as a single LineString
      const outboundPathResult = await this.pgClient.query(`
        SELECT 
          ST_LineMerge(ST_Union(geometry ORDER BY id)) as outbound_path,
          ST_Length(ST_Union(geometry ORDER BY id)::geography) / 1000.0 as outbound_length_km
        FROM ${this.config.stagingSchema}.ways_noded 
        WHERE id = ANY($1::integer[])
      `, [outboundEdgeIds]);
      
      if (!outboundPathResult.rows[0]?.outbound_path) {
        throw new Error('No outbound path found');
      }
      
      const outboundPath = outboundPathResult.rows[0].outbound_path;
      const outboundLength = outboundPathResult.rows[0].outbound_length_km;
      
      // Create the return path by reversing the outbound path
      const returnPathResult = await this.pgClient.query(`
        SELECT ST_Reverse($1::geometry) as return_path
      `, [outboundPath]);
      
      const returnPath = returnPathResult.rows[0].return_path;
      
      // Concatenate outbound and return paths to create true out-and-back geometry
      const outAndBackGeometryResult = await this.pgClient.query(`
        SELECT 
          ST_AsGeoJSON(ST_LineMerge(ST_Union($1::geometry, $2::geometry)), 6, 0) as out_and_back_geojson,
          ST_Length(ST_LineMerge(ST_Union($1::geometry, $2::geometry))::geography) / 1000.0 as total_length_km,
          ST_StartPoint($1::geometry) as start_point,
          ST_EndPoint(ST_LineMerge(ST_Union($1::geometry, $2::geometry))) as end_point
        FROM (SELECT 1) as dummy
      `, [outboundPath, returnPath]);
      
      const totalLength = outAndBackGeometryResult.rows[0].total_length_km;
      const startPoint = outAndBackGeometryResult.rows[0].start_point;
      const endPoint = outAndBackGeometryResult.rows[0].end_point;
      
      // Verify that start and end points are the same (true out-and-back)
      const startEndCheck = await this.pgClient.query(`
        SELECT ST_DWithin($1::geometry, $2::geometry, 1.0) as points_match
      `, [startPoint, endPoint]);
      
      const pointsMatch = startEndCheck.rows[0].points_match;
      
      this.log(`  🔄 Out-and-back geometry: ${outboundLength.toFixed(2)}km outbound → ${totalLength.toFixed(2)}km total, start/end match: ${pointsMatch}`);
      
      return {
        geometry: outAndBackGeometryResult.rows[0].out_and_back_geojson,
        length_km: totalLength,
        outbound_length_km: outboundLength,
        points_match: pointsMatch
      };
      
    } catch (error) {
      this.log(`⚠️ Failed to create out-and-back geometry: ${error}`);
      return null;
    }
  }

  /**
   * Calculate elevation statistics from a GeoJSON geometry
   */
  private async calculateElevationStatsFromGeometry(geojsonGeometry: string): Promise<any> {
    try {
      const elevationResult = await this.pgClient.query(`
        WITH pts AS (
          SELECT 
            (dp.path)[1] AS pt_index,
            ST_Z(dp.geom) AS z
          FROM ST_DumpPoints(ST_GeomFromGeoJSON($1)) dp
        ),
        deltas AS (
          SELECT
            GREATEST(z - LAG(z) OVER (ORDER BY pt_index), 0) AS up,
            GREATEST(LAG(z) OVER (ORDER BY pt_index) - z, 0) AS down,
            z
          FROM pts
        ),
        agg AS (
          SELECT 
            COALESCE(SUM(up), 0) AS total_elevation_gain,
            COALESCE(SUM(down), 0) AS total_elevation_loss,
            MAX(z) AS max_elevation,
            MIN(z) AS min_elevation,
            AVG(z) AS avg_elevation
          FROM deltas
        )
        SELECT * FROM agg
      `, [geojsonGeometry]);
      
      return elevationResult.rows[0];
      
    } catch (error) {
      this.log(`⚠️ Failed to calculate elevation stats: ${error}`);
      return {
        total_elevation_gain: 0,
        total_elevation_loss: 0,
        max_elevation: 0,
        min_elevation: 0,
        avg_elevation: 0
      };
    }
  }

  /**
   * Store route recommendations in the database
   */
  async storeRouteRecommendations(recommendations: RouteRecommendation[]): Promise<void> {
    this.log(`[OUT-AND-BACK] 💾 Storing ${recommendations.length} true out-and-back route recommendations...`);
    
    for (const recommendation of recommendations) {
      try {
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.route_recommendations (
            route_uuid, route_name, route_shape, region,
            input_length_km, input_elevation_gain,
            recommended_length_km, recommended_elevation_gain,
            route_path, route_edges, trail_count,
            route_score, similarity_score, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
          ON CONFLICT (route_uuid) DO UPDATE SET
            route_name = EXCLUDED.route_name,
            recommended_length_km = EXCLUDED.recommended_length_km,
            recommended_elevation_gain = EXCLUDED.recommended_elevation_gain,
            route_score = EXCLUDED.route_score,
            similarity_score = EXCLUDED.similarity_score
        `, [
          recommendation.route_uuid,
          recommendation.route_name,
          recommendation.route_shape,
          recommendation.region,
          recommendation.input_length_km,
          recommendation.input_elevation_gain,
          recommendation.recommended_length_km,
          recommendation.recommended_elevation_gain,
          JSON.stringify(recommendation.route_path),
          JSON.stringify(recommendation.route_edges),
          recommendation.trail_count,
          recommendation.route_score,
          recommendation.similarity_score
        ]);
      } catch (error) {
        this.log(`❌ Failed to store route ${recommendation.route_uuid}: ${error}`);
      }
    }
    
    this.log(`[TRUE-OUT-AND-BACK] ✅ Stored ${recommendations.length} true out-and-back route recommendations`);
  }
}
