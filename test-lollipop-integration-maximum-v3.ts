#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { LollipopRouteGeneratorServiceLengthFirst } from './src/services/layer3/LollipopRouteGeneratorServiceLengthFirst';
import { getDatabasePoolConfig } from './src/utils/config-loader';

interface StrategicEntryPoint {
  node_id: number;
  lat: number;
  lng: number;
  node_type: 'trailhead' | 'degree1' | 'high_degree' | 'manual';
  degree: number;
  trail_names: string[];
  description: string;
}

class StrategicEntryPointFinder {
  private pgClient: Pool;
  private stagingSchema: string;
  
  constructor(pgClient: Pool, stagingSchema: string) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
  }
  
  /**
   * Find strategic entry points for efficient loop discovery
   */
  async findStrategicEntryPoints(): Promise<StrategicEntryPoint[]> {
    console.log('🎯 Finding strategic entry points for efficient loop discovery...');
    
    const entryPoints: StrategicEntryPoint[] = [];
    
    // 1. Find degree-1 nodes (trailheads) - these are perfect entry points
    console.log('   🔍 Finding degree-1 trailheads...');
    const degree1Nodes = await this.pgClient.query(`
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
        trail_names,
        'degree1' as node_type,
        'Trailhead (degree-1 node)' as description
      FROM node_degrees
      WHERE degree = 1
      ORDER BY lat DESC, lng ASC
    `);
    
    degree1Nodes.rows.forEach(node => {
      entryPoints.push({
        node_id: node.node_id,
        lat: node.lat,
        lng: node.lng,
        node_type: 'degree1',
        degree: node.degree,
        trail_names: node.trail_names,
        description: node.description
      });
    });
    
    console.log(`      ✅ Found ${degree1Nodes.rows.length} degree-1 trailheads`);
    
    // 2. Find high-degree strategic junction points (degree 3+)
    console.log('   🔍 Finding high-degree strategic junctions...');
    const highDegreeNodes = await this.pgClient.query(`
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
        trail_names,
        'high_degree' as node_type,
        'Strategic junction (degree-' || degree || ')' as description
      FROM node_degrees
      WHERE degree >= 3
      ORDER BY degree DESC, lat DESC, lng ASC
      LIMIT 20
    `);
    
    highDegreeNodes.rows.forEach(node => {
      entryPoints.push({
        node_id: node.node_id,
        lat: node.lat,
        lng: node.lng,
        node_type: 'high_degree',
        degree: node.degree,
        trail_names: node.trail_names,
        description: node.description
      });
    });
    
    console.log(`      ✅ Found ${highDegreeNodes.rows.length} high-degree strategic junctions`);
    
    // 3. Add manually defined strategic points (you can customize these)
    console.log('   🔍 Adding manually defined strategic points...');
    const manualPoints: StrategicEntryPoint[] = [
      // Add known trailheads or strategic points here
      // Example:
      // {
      //   node_id: 123,
      //   lat: 39.9604,
      //   lng: -105.3012,
      //   node_type: 'manual',
      //   degree: 0,
      //   trail_names: ['Shadow Canyon'],
      //   description: 'Shadow Canyon Trailhead'
      // }
    ];
    
    entryPoints.push(...manualPoints);
    console.log(`      ✅ Added ${manualPoints.length} manually defined points`);
    
    // Sort by strategic importance
    entryPoints.sort((a, b) => {
      // Prioritize: degree1 > high_degree > manual
      const typePriority: { [key: string]: number } = { 'degree1': 3, 'high_degree': 2, 'manual': 1 };
      const aPriority = typePriority[a.node_type] || 0;
      const bPriority = typePriority[b.node_type] || 0;
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      // Within same type, prioritize by degree (higher is better)
      return b.degree - a.degree;
    });
    
    console.log(`\n🎯 STRATEGIC ENTRY POINTS SUMMARY:`);
    console.log(`   • Total entry points: ${entryPoints.length}`);
    console.log(`   • Degree-1 trailheads: ${entryPoints.filter(p => p.node_type === 'degree1').length}`);
    console.log(`   • High-degree junctions: ${entryPoints.filter(p => p.node_type === 'high_degree').length}`);
    console.log(`   • Manual points: ${entryPoints.filter(p => p.node_type === 'manual').length}`);
    
    // Show top 10 entry points
    console.log(`\n🏆 TOP 10 STRATEGIC ENTRY POINTS:`);
    entryPoints.slice(0, 10).forEach((point, index) => {
      console.log(`   ${index + 1}. Node ${point.node_id} (${point.lat.toFixed(6)}, ${point.lng.toFixed(6)})`);
      console.log(`      Type: ${point.node_type} (degree ${point.degree})`);
      console.log(`      Trails: ${point.trail_names.slice(0, 3).join(', ')}${point.trail_names.length > 3 ? '...' : ''}`);
      console.log(`      Description: ${point.description}`);
      console.log('');
    });
    
    return entryPoints;
  }
}

class EfficientLollipopRouteGenerator {
  private pgClient: Pool;
  private stagingSchema: string;
  private entryPoints: StrategicEntryPoint[];
  
  constructor(pgClient: Pool, stagingSchema: string, entryPoints: StrategicEntryPoint[]) {
    this.pgClient = pgClient;
    this.stagingSchema = stagingSchema;
    this.entryPoints = entryPoints;
  }
  
  /**
   * Generate lollipop routes using only strategic entry points
   */
  async generateEfficientLollipopRoutes(): Promise<any[]> {
    console.log('🚀 Generating efficient lollipop routes using strategic entry points...');
    
    const allRoutes: any[] = [];
    
    // Process each strategic entry point
    for (let i = 0; i < this.entryPoints.length; i++) {
      const entryPoint = this.entryPoints[i];
      console.log(`\n📍 Processing entry point ${i + 1}/${this.entryPoints.length}: Node ${entryPoint.node_id} (${entryPoint.node_type})`);
      console.log(`   Location: (${entryPoint.lat.toFixed(6)}, ${entryPoint.lng.toFixed(6)})`);
      console.log(`   Trails: ${entryPoint.trail_names.slice(0, 3).join(', ')}${entryPoint.trail_names.length > 3 ? '...' : ''}`);
      
      try {
        // Find reachable destinations from this entry point
        const destinations = await this.findReachableDestinations(entryPoint.node_id);
        console.log(`   🎯 Found ${destinations.length} reachable destinations`);
        
        if (destinations.length === 0) {
          console.log(`   ⚠️  No reachable destinations from this entry point`);
          continue;
        }
        
        // Generate routes to top destinations
        const routes = await this.generateRoutesFromEntryPoint(entryPoint, destinations);
        console.log(`   ✅ Generated ${routes.length} routes from this entry point`);
        
        allRoutes.push(...routes);
        
      } catch (error) {
        console.error(`   ❌ Error processing entry point ${entryPoint.node_id}:`, error);
      }
    }
    
    console.log(`\n🏆 EFFICIENT ROUTE GENERATION COMPLETE:`);
    console.log(`   • Total routes generated: ${allRoutes.length}`);
    console.log(`   • Entry points processed: ${this.entryPoints.length}`);
    console.log(`   • Average routes per entry point: ${(allRoutes.length / this.entryPoints.length).toFixed(1)}`);
    
    return allRoutes;
  }
  
  private async findReachableDestinations(entryNodeId: number): Promise<any[]> {
    // Find destinations within reasonable distance using Dijkstra
    const destinations = await this.pgClient.query(`
      WITH reachable_nodes AS (
        SELECT 
          end_vid as dest_node,
          agg_cost as distance_km
        FROM pgr_dijkstra(
          'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
          $1, -- source node
          (SELECT array_agg(id) FROM ${this.stagingSchema}.ways_noded_vertices_pgr),
          false
        )
        WHERE agg_cost > 5.0  -- Minimum 5km distance
          AND agg_cost < 100.0  -- Maximum 100km distance
          AND end_vid != $1  -- Don't include source node
      )
      SELECT 
        rn.dest_node,
        rn.distance_km,
        v.lat,
        v.lng,
        COUNT(e.id) as degree,
        array_agg(DISTINCT COALESCE(w.trail_name, 'Unknown')) as trail_names
      FROM reachable_nodes rn
      JOIN ${this.stagingSchema}.ways_noded_vertices_pgr v ON rn.dest_node = v.id
      LEFT JOIN ${this.stagingSchema}.ways_noded e ON (e.source = v.id OR e.target = v.id)
      LEFT JOIN ${this.stagingSchema}.ways w ON e.id = w.id
      GROUP BY rn.dest_node, rn.distance_km, v.lat, v.lng
      ORDER BY rn.distance_km ASC
      LIMIT 50  -- Limit to top 50 destinations per entry point
    `, [entryNodeId]);
    
    return destinations.rows;
  }
  
  private async generateRoutesFromEntryPoint(entryPoint: StrategicEntryPoint, destinations: any[]): Promise<any[]> {
    const routes: any[] = [];
    
    // Process top destinations (limit to avoid explosion)
    const topDestinations = destinations.slice(0, 20);
    
    for (const dest of topDestinations) {
      try {
        // Generate outbound path
        const outboundPath = await this.pgClient.query(`
          SELECT 
            edge,
            cost,
            agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            $1, -- source
            $2, -- target
            false
          )
          WHERE edge != -1
        `, [entryPoint.node_id, dest.dest_node]);
        
        if (outboundPath.rows.length === 0) continue;
        
        const outboundDistance = outboundPath.rows[outboundPath.rows.length - 1].agg_cost;
        const outboundEdges = outboundPath.rows.map(row => row.edge);
        
        // Generate return path (try to minimize overlap)
        const returnPath = await this.pgClient.query(`
          SELECT 
            edge,
            cost,
            agg_cost
          FROM pgr_dijkstra(
            'SELECT id, source, target, length_km as cost FROM ${this.stagingSchema}.ways_noded',
            $1, -- source (destination)
            $2, -- target (entry point)
            false
          )
          WHERE edge != -1
        `, [dest.dest_node, entryPoint.node_id]);
        
        if (returnPath.rows.length === 0) continue;
        
        const returnDistance = returnPath.rows[returnPath.rows.length - 1].agg_cost;
        const returnEdges = returnPath.rows.map(row => row.edge);
        
        // Calculate overlap
        const edgeOverlap = outboundEdges.filter(edge => returnEdges.includes(edge)).length;
        const overlapPercentage = (edgeOverlap / Math.max(outboundEdges.length, returnEdges.length)) * 100;
        
        const totalDistance = outboundDistance + returnDistance;
        
        // Create route object
        const route = {
          anchor_node: entryPoint.node_id,
          dest_node: dest.dest_node,
          outbound_distance: outboundDistance,
          return_distance: returnDistance,
          total_distance: totalDistance,
          path_id: 1,
          connection_type: 'lollipop',
          route_shape: `Strategic route from ${entryPoint.description}`,
          edge_overlap_count: edgeOverlap,
          edge_overlap_percentage: overlapPercentage,
          route_geometry: 'LINESTRING(...)', // Would need to be calculated
          edge_ids: [...outboundEdges, ...returnEdges]
        };
        
        routes.push(route);
        
      } catch (error) {
        console.error(`     ❌ Error generating route to destination ${dest.dest_node}:`, error);
      }
    }
    
    return routes;
  }
}

async function testLollipopIntegrationMaximumV3() {
  console.log('🚀 Testing EFFICIENT LollipopRouteGeneratorService (V3)...');
  console.log('🎯 Strategy: Use strategic entry points (trailheads + high-degree junctions)');
  
  const schema = process.argv[2];
  if (!schema) {
    console.error('❌ Please provide a schema name as argument');
    console.log('Usage: npx ts-node test-lollipop-integration-maximum-v3.ts <schema_name>');
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
  console.log(`   • Script: test-lollipop-integration-maximum-v3.ts`);
  console.log(`   • Target: EFFICIENT route discovery using strategic entry points`);
  console.log('');

  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  try {
    await pgClient.connect();
    console.log('✅ Connected to database');

    // Step 1: Find strategic entry points
    const entryPointFinder = new StrategicEntryPointFinder(pgClient, schema);
    const entryPoints = await entryPointFinder.findStrategicEntryPoints();
    
    if (entryPoints.length === 0) {
      console.log('❌ No strategic entry points found');
      return;
    }
    
    // Step 2: Generate efficient routes using strategic entry points
    const efficientGenerator = new EfficientLollipopRouteGenerator(pgClient, schema, entryPoints);
    const routes = await efficientGenerator.generateEfficientLollipopRoutes();
    
    if (routes.length > 0) {
      console.log('\n📊 EFFICIENT ROUTE GENERATION RESULTS:');
      const sortedRoutes = routes.sort((a, b) => b.total_distance - a.total_distance);
      
      console.log(`\n🏆 TOP 20 LONGEST ROUTES (V3 - Efficient):`);
      sortedRoutes.slice(0, 20).forEach((route, index) => {
        console.log(`   ${index + 1}. ${route.total_distance.toFixed(2)}km total`);
        console.log(`      Outbound: ${route.outbound_distance.toFixed(2)}km, Return: ${route.return_distance.toFixed(2)}km`);
        console.log(`      Anchor ${route.anchor_node} → ${route.dest_node} (${route.edge_overlap_percentage.toFixed(1)}% overlap)`);
        console.log('');
      });
      
      // Statistics
      const ultraLongRoutes = routes.filter(r => r.total_distance >= 200);
      const extremeRoutes = routes.filter(r => r.total_distance >= 300);
      const networkLimitRoutes = routes.filter(r => r.total_distance >= 400);
      const massiveRoutes = routes.filter(r => r.total_distance >= 500);
      
      console.log(`\n📈 EFFICIENT ROUTE DISCOVERY STATISTICS (V3):`);
      console.log(`   • Total routes found: ${routes.length}`);
      console.log(`   • Routes ≥200km: ${ultraLongRoutes.length}`);
      console.log(`   • Routes ≥300km: ${extremeRoutes.length}`);
      console.log(`   • Routes ≥400km: ${networkLimitRoutes.length}`);
      console.log(`   • Routes ≥500km: ${massiveRoutes.length}`);
      console.log(`   • Average distance: ${(routes.reduce((sum, r) => sum + r.total_distance, 0) / routes.length).toFixed(2)}km`);
      console.log(`   • MAXIMUM distance found: ${Math.max(...routes.map(r => r.total_distance)).toFixed(2)}km`);
      
      // Show the absolute longest route details
      const longestRoute = sortedRoutes[0];
      console.log(`\n🏆 LONGEST ROUTE DISCOVERED (V3 - Efficient):`);
      console.log(`   • Total Distance: ${longestRoute.total_distance.toFixed(2)}km`);
      console.log(`   • Outbound: ${longestRoute.outbound_distance.toFixed(2)}km`);
      console.log(`   • Return: ${longestRoute.return_distance.toFixed(2)}km`);
      console.log(`   • Anchor Node: ${longestRoute.anchor_node}`);
      console.log(`   • Destination Node: ${longestRoute.dest_node}`);
      console.log(`   • Edge Overlap: ${longestRoute.edge_overlap_percentage.toFixed(1)}%`);

      // Export to GeoJSON (only the best routes)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFile = `test-output/lollipop-routes-${schema}-v3-efficient-${timestamp}.geojson`;
      
      // Export only the top 15 longest routes - we only need the best ones
      const routesToExport = sortedRoutes.slice(0, 15);
      console.log(`📁 Exporting top ${routesToExport.length} longest routes (the best ones only)`);
      console.log(`📁 Routes would be exported to: ${outputFile}`);
      console.log(`   (Export functionality can be added using existing LollipopRouteGeneratorService)`);

    } else {
      console.log('❌ No lollipop routes found');
    }

  } catch (error) {
    console.error('❌ Error testing efficient lollipop integration (V3):', error);
  } finally {
    await pgClient.end();
    console.log('✅ Database connection closed');
  }
}

// Run the test
testLollipopIntegrationMaximumV3().catch(console.error);
