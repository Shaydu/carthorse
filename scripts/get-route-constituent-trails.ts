import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Database configuration
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'password'
});

interface RouteTrailInfo {
  route_uuid: string;
  route_name: string;
  route_type: string;
  route_shape: string;
  target_distance_km: number;
  target_elevation_gain: number;
  actual_distance_km: number;
  actual_elevation_gain: number;
  constituent_trails: Array<{
    app_uuid: string;
    name: string;
    trail_type: string;
    surface: string;
    difficulty: string;
    length_km: number;
    elevation_gain: number;
    elevation_loss: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
    source: string;
    osm_id: string;
  }>;
  edge_count: number;
  unique_trail_count: number;
}

async function getRouteConstituentTrails() {
  console.log('🔍 Retrieving constituent trails for all routes...');
  
  try {
    // Get all route recommendations
    const routesResult = await pool.query(`
      SELECT 
        route_uuid,
        route_name,
        route_type,
        route_shape,
        input_distance_km,
        input_elevation_gain,
        recommended_distance_km,
        recommended_elevation_gain,
        route_edges,
        trail_count,
        route_score,
        created_at
      FROM public.route_recommendations
      WHERE route_shape = 'out-and-back'
      ORDER BY route_name, created_at DESC
      LIMIT 10
    `);
    
    console.log(`📋 Found ${routesResult.rows.length} routes to analyze`);
    
    const routeTrailInfo: RouteTrailInfo[] = [];
    
    for (const route of routesResult.rows) {
      console.log(`\n🔍 Analyzing route: ${route.route_name}`);
      
      // Parse the route edges
      const routeEdges = typeof route.route_edges === 'string' 
        ? JSON.parse(route.route_edges) 
        : route.route_edges;
      
      if (!routeEdges || !Array.isArray(routeEdges)) {
        console.log(`  ⚠️ No valid route edges found for ${route.route_name}`);
        continue;
      }
      
      // Extract edge IDs (convert to integers)
      const edgeIds = routeEdges
        .map((edge: any) => parseInt(edge.id))
        .filter((id: number) => !isNaN(id) && id > 0);
      
      if (edgeIds.length === 0) {
        console.log(`  ⚠️ No valid edge IDs found for ${route.route_name}`);
        continue;
      }
      
      console.log(`  📍 Route uses ${edgeIds.length} edges: [${edgeIds.join(', ')}]`);
      
      // Get the trails that correspond to these edges with their individual metrics
      const trailsResult = await pool.query(`
        SELECT DISTINCT
          t.app_uuid,
          t.name,
          t.trail_type,
          t.surface,
          t.difficulty,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          t.source,
          t.osm_id,
          COUNT(re.id) as edge_count
        FROM trails t
        INNER JOIN routing_edges re ON t.app_uuid = re.app_uuid
        WHERE re.id = ANY($1::integer[])
        GROUP BY t.app_uuid, t.name, t.trail_type, t.surface, t.difficulty, 
                 t.length_km, t.elevation_gain, t.elevation_loss, t.max_elevation, 
                 t.min_elevation, t.avg_elevation, t.source, t.osm_id
        ORDER BY t.name
      `, [edgeIds]);
      
      const constituentTrails = trailsResult.rows;
      const uniqueTrailCount = new Set(constituentTrails.map(t => t.app_uuid)).size;
      
      console.log(`  🛤️ Found ${constituentTrails.length} trail segments from ${uniqueTrailCount} unique trails`);
      
      // Calculate totals from constituent trails
      const totalTrailDistance = constituentTrails.reduce((sum, t) => sum + (t.length_km || 0), 0);
      const totalTrailElevation = constituentTrails.reduce((sum, t) => sum + (t.elevation_gain || 0), 0);
      
      // For out-and-back routes, double the distance and elevation
      const outAndBackDistance = totalTrailDistance * 2;
      const outAndBackElevation = totalTrailElevation * 2;
      
      routeTrailInfo.push({
        route_uuid: route.route_uuid,
        route_name: route.route_name,
        route_type: route.route_type,
        route_shape: route.route_shape,
        target_distance_km: route.input_distance_km,
        target_elevation_gain: route.input_elevation_gain,
        actual_distance_km: route.recommended_distance_km,
        actual_elevation_gain: route.recommended_elevation_gain,
        constituent_trails: constituentTrails,
        edge_count: edgeIds.length,
        unique_trail_count: uniqueTrailCount
      });
    }
    
    // Save detailed analysis to JSON
    const outputPath = path.join(__dirname, '../test-output/route-constituent-trails.json');
    fs.writeFileSync(outputPath, JSON.stringify(routeTrailInfo, null, 2));
    console.log(`\n💾 Saved detailed analysis to: ${outputPath}`);
    
    // Generate detailed summary report
    console.log('\n📊 DETAILED ROUTE CONSTITUENT TRAILS SUMMARY:');
    console.log('==============================================');
    
    for (const routeInfo of routeTrailInfo) {
      console.log(`\n🏃 ROUTE: ${routeInfo.route_name}`);
      console.log(`   Target: ${routeInfo.target_distance_km}km, ${routeInfo.target_elevation_gain}m`);
      console.log(`   Actual: ${routeInfo.actual_distance_km}km, ${routeInfo.actual_elevation_gain}m`);
      console.log(`   Uses: ${routeInfo.edge_count} edges from ${routeInfo.unique_trail_count} unique trails`);
      
      // Calculate totals from constituent trails
      const totalTrailDistance = routeInfo.constituent_trails.reduce((sum, t) => sum + (t.length_km || 0), 0);
      const totalTrailElevation = routeInfo.constituent_trails.reduce((sum, t) => sum + (t.elevation_gain || 0), 0);
      const outAndBackDistance = totalTrailDistance * 2;
      const outAndBackElevation = totalTrailElevation * 2;
      
      console.log(`   One-way trail total: ${totalTrailDistance.toFixed(2)}km, ${totalTrailElevation.toFixed(0)}m`);
      console.log(`   Out-and-back total: ${outAndBackDistance.toFixed(2)}km, ${outAndBackElevation.toFixed(0)}m`);
      
      if (routeInfo.constituent_trails.length > 0) {
        console.log(`   Constituent trails:`);
        routeInfo.constituent_trails.forEach((trail, index) => {
          console.log(`     ${index + 1}. ${trail.name}`);
          console.log(`        Distance: ${trail.length_km?.toFixed(2) || 'N/A'}km`);
          console.log(`        Elevation Gain: ${trail.elevation_gain?.toFixed(0) || 'N/A'}m`);
          console.log(`        Type: ${trail.trail_type || 'N/A'}`);
          console.log(`        Surface: ${trail.surface || 'N/A'}`);
          console.log(`        Difficulty: ${trail.difficulty || 'N/A'}`);
        });
      } else {
        console.log(`   ⚠️ No constituent trails found - edges may not be mapped to trails`);
      }
    }
    
    // Generate statistics
    const totalRoutes = routeTrailInfo.length;
    const avgTrailsPerRoute = routeTrailInfo.reduce((sum, r) => sum + r.unique_trail_count, 0) / totalRoutes;
    const allTrailNames = new Set(routeTrailInfo.flatMap(r => r.constituent_trails.map(t => t.name)));
    
    console.log('\n📈 STATISTICS:');
    console.log(`   Total routes analyzed: ${totalRoutes}`);
    console.log(`   Average trails per route: ${avgTrailsPerRoute.toFixed(1)}`);
    console.log(`   Total unique trails used: ${allTrailNames.size}`);
    
    if (allTrailNames.size > 0) {
      console.log(`   Most common trails:`);
      
      // Count trail usage
      const trailUsage: { [key: string]: number } = {};
      routeTrailInfo.forEach(route => {
        route.constituent_trails.forEach(trail => {
          trailUsage[trail.name] = (trailUsage[trail.name] || 0) + 1;
        });
      });
      
      const sortedTrails = Object.entries(trailUsage)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);
      
      sortedTrails.forEach(([name, count]) => {
        console.log(`     ${name}: ${count} routes`);
      });
    } else {
      console.log(`   ⚠️ No trails found - check edge to trail mapping`);
    }
    
  } catch (error) {
    console.error('❌ Error retrieving route constituent trails:', error);
  } finally {
    await pool.end();
  }
}

// Run the analysis
getRouteConstituentTrails().catch(console.error); 