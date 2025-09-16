#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { LollipopRouteGeneratorServiceLengthFirst } from '../src/services/layer3/LollipopRouteGeneratorServiceLengthFirst';
import { getDatabasePoolConfig } from '../src/utils/config-loader';

interface AreaOptimizedRoute {
  anchor_node: number;
  dest_node: number;
  outbound_distance: number;
  return_distance: number;
  total_distance: number;
  path_id: number;
  connection_type: string;
  route_shape: string;
  edge_overlap_count: number;
  edge_overlap_percentage: number;
  route_geometry: string;
  edge_ids: number[];
  // New area-based metrics
  internal_area_km2: number;
  area_efficiency: number; // area per km of route
  route_compactness: number; // area / perimeter^2 ratio
  combined_area_score?: number; // optional combined scoring metric
}

class AreaBasedLoopOptimizer {
  private pgClient: Pool;
  private stagingSchema: string;
  
  constructor(pgClient: Pool, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }
  
  /**
   * Calculate the internal area of a loop route using PostGIS
   */
  async calculateLoopArea(edgeIds: number[]): Promise<{
    area_km2: number;
    perimeter_km: number;
    compactness: number;
    geometry: string;
  } | null> {
    try {
      const result = await this.pgClient.query(`
        WITH route_edges AS (
          SELECT 
            wn.id,
            t.geometry as the_geom,
            wn.length_km
        FROM ${this.stagingSchema}.ways_noded wn
        LEFT JOIN ${this.stagingSchema}.trails t ON wn.original_trail_uuid = t.app_uuid
          WHERE wn.id = ANY($1)
            AND t.geometry IS NOT NULL
            AND ST_IsValid(t.geometry)
        ),
        route_geometry AS (
          SELECT 
            ST_LineMerge(ST_Union(the_geom)) as route_line,
            SUM(length_km) as total_length_km
          FROM route_edges
        ),
        route_polygon AS (
          SELECT 
            CASE 
              WHEN ST_IsClosed(route_line) THEN
                ST_MakePolygon(route_line)
              ELSE
                -- For non-closed routes, try to close them by connecting endpoints
                CASE 
                  WHEN ST_GeometryType(route_line) = 'ST_LineString' THEN
                    ST_MakePolygon(
                      ST_AddPoint(
                        route_line,
                        ST_StartPoint(route_line)
                      )
                    )
                  ELSE
                    -- If not a LineString, try to convert or skip
                    NULL
                END
            END as route_polygon,
            total_length_km
          FROM route_geometry
        ),
        area_calculation AS (
          SELECT 
            route_polygon,
            total_length_km,
            ST_Area(route_polygon::geography) / 1000000.0 as area_km2, -- Convert m² to km²
            ST_Perimeter(route_polygon::geography) / 1000.0 as perimeter_km, -- Convert m to km
            CASE 
              WHEN ST_Perimeter(route_polygon::geography) > 0 THEN
                ST_Area(route_polygon::geography) / (ST_Perimeter(route_polygon::geography) * ST_Perimeter(route_polygon::geography))
              ELSE 0
            END as compactness
          FROM route_polygon
          WHERE ST_IsValid(route_polygon)
        )
        SELECT 
          area_km2,
          perimeter_km,
          compactness,
          ST_AsGeoJSON(route_polygon) as geometry
        FROM area_calculation
        WHERE area_km2 > 0
      `, [edgeIds]);
      
      if (result.rows.length > 0) {
        return {
          area_km2: result.rows[0].area_km2,
          perimeter_km: result.rows[0].perimeter_km,
          compactness: result.rows[0].compactness,
          geometry: result.rows[0].geometry
        };
      }
      
      return null;
    } catch (error) {
      console.error('Error calculating loop area:', error);
      return null;
    }
  }
  
  /**
   * Find loops using Hawick Circuits and calculate their areas
   */
  async findAreaOptimizedLoops(): Promise<AreaOptimizedRoute[]> {
    console.log('🔄 Finding area-optimized loops using Hawick Circuits...');
    
    // First, find all cycles using Hawick Circuits
    const cyclesResult = await this.pgClient.query(`
      WITH all_cycles AS (
        SELECT 
          path_id as cycle_id,
          edge as edge_id,
          cost,
          agg_cost,
          path_seq
        FROM pgr_hawickcircuits(
          'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded WHERE source IS NOT NULL AND target IS NOT NULL'
        )
        ORDER BY path_id, path_seq
      ),
      cycle_stats AS (
        SELECT 
          cycle_id,
          COUNT(*) as edge_count,
          COUNT(DISTINCT edge_id) as unique_edge_count,
          SUM(cost) as total_distance,
          array_agg(edge_id ORDER BY path_seq) as edge_ids
        FROM all_cycles
        GROUP BY cycle_id
      ),
      filtered_cycles AS (
        SELECT *
        FROM cycle_stats
        WHERE total_distance >= 10.0  -- Minimum 10km
          AND total_distance <= 200.0  -- Maximum 200km
          AND edge_count >= 5  -- At least 5 edges for meaningful area
          AND unique_edge_count = edge_count  -- No duplicate edges (true loop)
      )
      SELECT 
        cycle_id,
        total_distance,
        edge_count,
        edge_ids
      FROM filtered_cycles
      ORDER BY total_distance DESC
      LIMIT 100  -- Limit to top 100 cycles for area calculation
    `);
    
    console.log(`   🔍 Found ${cyclesResult.rows.length} potential cycles for area analysis`);
    
    const areaOptimizedRoutes: AreaOptimizedRoute[] = [];
    
    // Calculate area for each cycle
    for (const cycle of cyclesResult.rows) {
      console.log(`   📐 Calculating area for cycle ${cycle.cycle_id} (${cycle.total_distance.toFixed(2)}km, ${cycle.edge_count} edges)...`);
      
      const areaResult = await this.calculateLoopArea(cycle.edge_ids);
      
      if (areaResult && areaResult.area_km2 > 0.1) { // Minimum 0.1 km² area
        const areaEfficiency = areaResult.area_km2 / cycle.total_distance; // km² per km of route
        
        const route: AreaOptimizedRoute = {
          anchor_node: cycle.cycle_id, // Use cycle_id as anchor
          dest_node: cycle.cycle_id,   // Same for destination (it's a loop)
          outbound_distance: cycle.total_distance / 2, // Split distance
          return_distance: cycle.total_distance / 2,
          total_distance: cycle.total_distance,
          path_id: 1,
          connection_type: 'area_optimized_loop',
          route_shape: `Area-optimized loop (${areaResult.area_km2.toFixed(2)} km²)`,
          edge_overlap_count: 0, // No overlap in true loops
          edge_overlap_percentage: 0,
          route_geometry: areaResult.geometry,
          edge_ids: cycle.edge_ids,
          internal_area_km2: areaResult.area_km2,
          area_efficiency: areaEfficiency,
          route_compactness: areaResult.compactness
        };
        
        areaOptimizedRoutes.push(route);
        
        console.log(`      ✅ Area: ${areaResult.area_km2.toFixed(2)} km², Efficiency: ${areaEfficiency.toFixed(4)} km²/km, Compactness: ${areaResult.compactness.toFixed(6)}`);
      } else {
        console.log(`      ❌ Invalid or too small area for cycle ${cycle.cycle_id}`);
      }
    }
    
    console.log(`   🎯 Successfully calculated areas for ${areaOptimizedRoutes.length} cycles`);
    
    return areaOptimizedRoutes;
  }
  
  /**
   * Find area-optimized lollipop routes using strategic entry points
   */
  async findAreaOptimizedLollipopRoutes(): Promise<AreaOptimizedRoute[]> {
    console.log('🔄 Finding area-optimized lollipop routes...');
    
    // Find strategic entry points (degree-1 and high-degree nodes)
    const entryPoints = await this.pgClient.query(`
      WITH node_degrees AS (
        SELECT 
          v.id,
          ST_Y(v.the_geom) as lat,
          ST_X(v.the_geom) as lng,
          COUNT(e.id) as degree,
          array_agg(DISTINCT COALESCE(t.name, 'Unknown')) as trail_names
        FROM ${this.stagingSchema}.ways_noded_vertices_pgr v
        LEFT JOIN ${this.stagingSchema}.ways_noded e ON (e.source = v.id OR e.target = v.id)
        LEFT JOIN ${this.stagingSchema}.trails t ON e.original_trail_uuid = t.app_uuid
        GROUP BY v.id, v.the_geom
      )
      SELECT 
        id as node_id,
        lat,
        lng,
        degree,
        trail_names
      FROM node_degrees
      WHERE degree = 1 OR degree >= 3  -- Trailheads or strategic junctions
      ORDER BY 
        CASE WHEN degree = 1 THEN 1 ELSE 0 END DESC,  -- Prioritize trailheads
        degree DESC
      LIMIT 20
    `);
    
    console.log(`   🎯 Found ${entryPoints.rows.length} strategic entry points`);
    
    const areaOptimizedRoutes: AreaOptimizedRoute[] = [];
    
    // Generate lollipop routes from each entry point
    for (const entryPoint of entryPoints.rows) {
      console.log(`   📍 Processing entry point ${entryPoint.node_id} (degree ${entryPoint.degree})...`);
      
      // Find reachable destinations
      const destinations = await this.pgClient.query(`
        WITH reachable_nodes AS (
          SELECT 
            end_vid as dest_node,
            agg_cost as distance_km
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            $1::bigint,
            (SELECT array_agg(id::bigint) FROM ${this.stagingSchema}.ways_noded_vertices_pgr),
            false
          )
          WHERE agg_cost > 5.0 AND agg_cost < 50.0 AND end_vid != $1
        )
        SELECT dest_node, distance_km
        FROM reachable_nodes
        ORDER BY distance_km ASC
        LIMIT 10
      `, [entryPoint.node_id]);
      
      // Generate routes to top destinations
      for (const dest of destinations.rows.slice(0, 5)) { // Limit to top 5 destinations
        try {
          // Generate outbound path
          const outboundPath = await this.pgClient.query(`
            SELECT edge, cost, agg_cost
            FROM pgr_dijkstra(
              'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
              $1::bigint, $2::bigint, false
            )
            WHERE edge != -1
          `, [entryPoint.node_id, dest.dest_node]);
          
          if (outboundPath.rows.length === 0) continue;
          
          // Generate return path
          const returnPath = await this.pgClient.query(`
            SELECT edge, cost, agg_cost
            FROM pgr_dijkstra(
              'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
              $1::bigint, $2::bigint, false
            )
            WHERE edge != -1
          `, [dest.dest_node, entryPoint.node_id]);
          
          if (returnPath.rows.length === 0) continue;
          
          const outboundDistance = outboundPath.rows[outboundPath.rows.length - 1].agg_cost;
          const returnDistance = returnPath.rows[returnPath.rows.length - 1].agg_cost;
          const totalDistance = outboundDistance + returnDistance;
          
          const outboundEdges = outboundPath.rows.map(row => row.edge);
          const returnEdges = returnPath.rows.map(row => row.edge);
          const allEdges = [...outboundEdges, ...returnEdges];
          
          // Calculate area for this lollipop route
          const areaResult = await this.calculateLoopArea(allEdges);
          
          if (areaResult && areaResult.area_km2 > 0.05) { // Minimum 0.05 km² area
            const areaEfficiency = areaResult.area_km2 / totalDistance;
            
            const route: AreaOptimizedRoute = {
              anchor_node: entryPoint.node_id,
              dest_node: dest.dest_node,
              outbound_distance: outboundDistance,
              return_distance: returnDistance,
              total_distance: totalDistance,
              path_id: 1,
              connection_type: 'area_optimized_lollipop',
              route_shape: `Area-optimized lollipop (${areaResult.area_km2.toFixed(2)} km²)`,
              edge_overlap_count: outboundEdges.filter(edge => returnEdges.includes(edge)).length,
              edge_overlap_percentage: (outboundEdges.filter(edge => returnEdges.includes(edge)).length / Math.max(outboundEdges.length, returnEdges.length)) * 100,
              route_geometry: areaResult.geometry,
              edge_ids: allEdges,
              internal_area_km2: areaResult.area_km2,
              area_efficiency: areaEfficiency,
              route_compactness: areaResult.compactness
            };
            
            areaOptimizedRoutes.push(route);
            
            console.log(`      ✅ Lollipop: ${totalDistance.toFixed(2)}km, Area: ${areaResult.area_km2.toFixed(2)} km², Efficiency: ${areaEfficiency.toFixed(4)} km²/km`);
          }
        } catch (error) {
          console.error(`      ❌ Error generating lollipop route:`, error);
        }
      }
    }
    
    return areaOptimizedRoutes;
  }
  
  /**
   * Optimize routes by area metrics
   */
  optimizeRoutesByArea(routes: AreaOptimizedRoute[]): AreaOptimizedRoute[] {
    console.log('🎯 Optimizing routes by area metrics...');
    
    // Sort by different area-based criteria
    const byArea = [...routes].sort((a, b) => b.internal_area_km2 - a.internal_area_km2);
    const byEfficiency = [...routes].sort((a, b) => b.area_efficiency - a.area_efficiency);
    const byCompactness = [...routes].sort((a, b) => b.route_compactness - a.route_compactness);
    
    console.log(`   📊 Top 5 by area: ${byArea.slice(0, 5).map(r => `${r.internal_area_km2.toFixed(2)} km²`).join(', ')}`);
    console.log(`   📊 Top 5 by efficiency: ${byEfficiency.slice(0, 5).map(r => `${r.area_efficiency.toFixed(4)} km²/km`).join(', ')}`);
    console.log(`   📊 Top 5 by compactness: ${byCompactness.slice(0, 5).map(r => `${r.route_compactness.toFixed(6)}`).join(', ')}`);
    
    // Combine all criteria with weighted scoring
    const optimizedRoutes = routes.map(route => {
      const areaScore = route.internal_area_km2 / Math.max(...routes.map(r => r.internal_area_km2));
      const efficiencyScore = route.area_efficiency / Math.max(...routes.map(r => r.area_efficiency));
      const compactnessScore = route.route_compactness / Math.max(...routes.map(r => r.route_compactness));
      
      const combinedScore = (areaScore * 0.4) + (efficiencyScore * 0.4) + (compactnessScore * 0.2);
      
      return {
        ...route,
        combined_area_score: combinedScore
      };
    });
    
    return optimizedRoutes.sort((a, b) => b.combined_area_score - a.combined_area_score);
  }
}

async function testLollipopIntegrationMaximumV4() {
  console.log('🚀 Testing AREA-OPTIMIZED LollipopRouteGeneratorService (V4)...');
  console.log('🎯 Strategy: Maximize internal area of loop routes using PostGIS area calculations');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-maximum-v4.ts <schema_name>');
    process.exit(1);
  }

  // Get metadata information
  const { execSync } = require('child_process');
  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let runTimestamp = new Date().toISOString();
  
  try {
    gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.log('⚠️  Could not get git information');
  }

  console.log('\n📋 METADATA:');
  console.log(`   • Schema: ${schema}`);
  console.log(`   • Git Commit: ${gitCommit}`);
  console.log(`   • Git Branch: ${gitBranch}`);
  console.log(`   • Run Timestamp: ${runTimestamp}`);
  console.log(`   • Script: test-lollipop-integration-maximum-v4.ts`);
  console.log(`   • Target: AREA-OPTIMIZED route discovery (maximize internal area)`);
  console.log('');

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    const areaOptimizer = new AreaBasedLoopOptimizer(pgClient, schema);
    
    // Step 1: Find area-optimized true loops
    console.log('\n🔄 STEP 1: Finding area-optimized true loops...');
    const trueLoops = await areaOptimizer.findAreaOptimizedLoops();
    
    // Step 2: Find area-optimized lollipop routes
    console.log('\n🔄 STEP 2: Finding area-optimized lollipop routes...');
    const lollipopRoutes = await areaOptimizer.findAreaOptimizedLollipopRoutes();
    
    // Combine all routes
    const allRoutes = [...trueLoops, ...lollipopRoutes];
    
    if (allRoutes.length > 0) {
      console.log('\n🎯 STEP 3: Optimizing routes by area metrics...');
      const optimizedRoutes = areaOptimizer.optimizeRoutesByArea(allRoutes);
      
      console.log('\n📊 AREA-OPTIMIZED ROUTE DISCOVERY RESULTS:');
      console.log(`   • Total routes found: ${allRoutes.length}`);
      console.log(`   • True loops: ${trueLoops.length}`);
      console.log(`   • Lollipop routes: ${lollipopRoutes.length}`);
      
      // Show top routes by different criteria
      console.log('\n🏆 TOP 10 ROUTES BY COMBINED AREA SCORE:');
      optimizedRoutes.slice(0, 10).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.route_shape}`);
        console.log(`      Distance: ${route.total_distance.toFixed(2)}km`);
        console.log(`      Area: ${route.internal_area_km2.toFixed(2)} km²`);
        console.log(`      Efficiency: ${route.area_efficiency.toFixed(4)} km²/km`);
        console.log(`      Compactness: ${route.route_compactness.toFixed(6)}`);
        console.log(`      Combined Score: ${(route.combined_area_score || 0).toFixed(4)}`);
        console.log('');
      });
      
      // Show top routes by pure area
      console.log('\n🏆 TOP 5 ROUTES BY PURE AREA:');
      const byArea = [...allRoutes].sort((a, b) => b.internal_area_km2 - a.internal_area_km2);
      byArea.slice(0, 5).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.internal_area_km2.toFixed(2)} km² - ${route.route_shape}`);
        console.log(`      Distance: ${route.total_distance.toFixed(2)}km, Efficiency: ${route.area_efficiency.toFixed(4)} km²/km`);
        console.log('');
      });
      
      // Show top routes by area efficiency
      console.log('\n🏆 TOP 5 ROUTES BY AREA EFFICIENCY:');
      const byEfficiency = [...allRoutes].sort((a, b) => b.area_efficiency - a.area_efficiency);
      byEfficiency.slice(0, 5).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.area_efficiency.toFixed(4)} km²/km - ${route.route_shape}`);
        console.log(`      Area: ${route.internal_area_km2.toFixed(2)} km², Distance: ${route.total_distance.toFixed(2)}km`);
        console.log('');
      });
      
      // Statistics
      const totalArea = allRoutes.reduce((sum, route) => sum + route.internal_area_km2, 0);
      const avgArea = totalArea / allRoutes.length;
      const maxArea = Math.max(...allRoutes.map(r => r.internal_area_km2));
      const avgEfficiency = allRoutes.reduce((sum, route) => sum + route.area_efficiency, 0) / allRoutes.length;
      
      console.log('\n📈 AREA-OPTIMIZATION STATISTICS:');
      console.log(`   • Total area covered: ${totalArea.toFixed(2)} km²`);
      console.log(`   • Average area per route: ${avgArea.toFixed(2)} km²`);
      console.log(`   • Maximum area: ${maxArea.toFixed(2)} km²`);
      console.log(`   • Average efficiency: ${avgEfficiency.toFixed(4)} km²/km`);
      console.log(`   • Routes with >1 km² area: ${allRoutes.filter(r => r.internal_area_km2 > 1.0).length}`);
      console.log(`   • Routes with >5 km² area: ${allRoutes.filter(r => r.internal_area_km2 > 5.0).length}`);
      console.log(`   • Routes with >10 km² area: ${allRoutes.filter(r => r.internal_area_km2 > 10.0).length}`);

      // Export to GeoJSON (only the best routes)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFile = `test-output/lollipop-routes-${schema}-v4-area-optimized-${timestamp}.geojson`;
      
      // Export only the top 10 area-optimized routes - we only need the best ones
      const routesToExport = optimizedRoutes.slice(0, 10);
      console.log(`\n📁 Exporting top ${routesToExport.length} area-optimized routes (the best ones only)`);
      console.log(`📁 Routes would be exported to: ${outputFile}`);
      console.log(`   (Export functionality can be added using existing LollipopRouteGeneratorService)`);

    } else {
      console.log('❌ No area-optimized routes found');
    }

  } catch (error) {
    console.error('❌ Error testing area-optimized lollipop integration (V4):', error);
  } finally {
    await pgClient.end();
    console.log('✅ Database connection closed');
  }
}

// Run the test
testLollipopIntegrationMaximumV4().catch(console.error);
