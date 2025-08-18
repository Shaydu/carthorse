#!/usr/bin/env ts-node

/**
 * Route Statistics Analyzer
 * 
 * This script analyzes route statistics including elevation data, constituent trails,
 * and other metrics to help debug route generation issues.
 */

import { Pool } from 'pg';

interface RouteStats {
  route_id: string;
  route_name: string;
  total_distance_km: number;
  total_elevation_gain: number;
  total_elevation_loss: number;
  min_elevation: number;
  max_elevation: number;
  constituent_trails: TrailStats[];
  trail_count: number;
  has_geometry: boolean;
  geometry_type: string;
}

interface TrailStats {
  trail_id: string;
  trail_name: string;
  length_km: number;
  elevation_gain: number;
  elevation_loss: number;
  min_elevation: number;
  max_elevation: number;
  avg_elevation: number;
}

async function analyzeRouteStats() {
  console.log('📊 Analyzing route statistics...');
  
  const pgClient = new Pool({
    host: 'localhost',
    database: 'trail_master_db',
    user: 'shaydu'
  });

  try {
    await pgClient.connect();
    
    // Find the most recent staging schema
    const schemaResult = await pgClient.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.log('❌ No staging schemas found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`🔍 Using staging schema: ${stagingSchema}`);
    
    // Check if route_recommendations table exists
    const tableExists = await pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'route_recommendations'
      )
    `, [stagingSchema]);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ route_recommendations table not found');
      return;
    }
    
    // Get route count
    const routeCount = await pgClient.query(`
      SELECT COUNT(*) as count FROM ${stagingSchema}.route_recommendations
    `);
    
    console.log(`📈 Found ${routeCount.rows[0].count} routes`);
    
    if (parseInt(routeCount.rows[0].count) === 0) {
      console.log('❌ No routes found in route_recommendations table');
      return;
    }
    
    // First, let's check what columns actually exist in route_recommendations
    const columnsCheck = await pgClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'route_recommendations'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log(`📋 route_recommendations columns: ${columnsCheck.rows.map(r => `${r.column_name}(${r.data_type})`).join(', ')}`);
    
    // Get detailed route statistics with correct column names
    const routeStats = await pgClient.query(`
      SELECT 
        id,
        route_name,
        recommended_length_km as total_distance_km,
        recommended_elevation_gain as total_elevation_gain,
        route_geometry,
        ST_GeometryType(route_geometry) as geometry_type,
        ST_IsEmpty(route_geometry) as is_empty,
        ST_IsValid(route_geometry) as is_valid,
        ST_NumPoints(route_geometry) as num_points,
        ST_Dimension(route_geometry) as dimension,
        ST_ZMin(route_geometry) as min_elevation,
        ST_ZMax(route_geometry) as max_elevation,
        ST_Length(route_geometry) as geom_length,
        trail_count,
        route_score,
        similarity_score,
        route_type,
        route_shape,
        created_at
      FROM ${stagingSchema}.route_recommendations
      ORDER BY created_at DESC
    `);
    
    console.log('\n🏃 ROUTE STATISTICS:');
    console.log('===================');
    
    for (const route of routeStats.rows) {
      console.log(`\n📋 Route: ${route.route_name || 'Unknown'} (ID: ${route.id})`);
      console.log(`   📏 Distance: ${route.total_distance_km?.toFixed(2) || 'N/A'} km`);
      console.log(`   ⬆️  Elevation Gain: ${route.total_elevation_gain?.toFixed(0) || 'N/A'} m`);
      console.log(`   📍 Min Elevation: ${route.min_elevation?.toFixed(0) || 'N/A'} m`);
      console.log(`   📍 Max Elevation: ${route.max_elevation?.toFixed(0) || 'N/A'} m`);
      console.log(`   🗺️  Geometry Type: ${route.geometry_type || 'N/A'}`);
      console.log(`   📊 Geometry Points: ${route.num_points || 'N/A'}`);
      console.log(`   📐 Dimension: ${route.dimension || 'N/A'}`);
      console.log(`   📏 Geometry Length: ${route.geom_length?.toFixed(2) || 'N/A'} km`);
      console.log(`   ✅ Is Empty: ${route.is_empty}`);
      console.log(`   ✅ Is Valid: ${route.is_valid}`);
      console.log(`   🛤️  Trail Count: ${route.trail_count || 'N/A'}`);
      console.log(`   🎯 Route Score: ${route.route_score?.toFixed(3) || 'N/A'}`);
      console.log(`   🔄 Similarity Score: ${route.similarity_score?.toFixed(3) || 'N/A'}`);
      console.log(`   📋 Route Type: ${route.route_type || 'N/A'}`);
      console.log(`   🔄 Route Shape: ${route.route_shape || 'N/A'}`);
      console.log(`   🕒 Created: ${route.created_at}`);
    }
    
    // Check constituent trails for each route
    console.log('\n🔗 CONSTITUENT TRAIL ANALYSIS:');
    console.log('=============================');
    
    for (const route of routeStats.rows) {
      console.log(`\n🏃 Route: ${route.route_name || 'Unknown'} (ID: ${route.id})`);
      
      // Get constituent trails for this route
      const constituentTrails = await pgClient.query(`
        SELECT 
          t.app_uuid as trail_id,
          t.name as trail_name,
          t.length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.min_elevation,
          t.max_elevation,
          t.avg_elevation,
          ST_Length(t.geometry) as geom_length,
          ST_GeometryType(t.geometry) as geom_type,
          ST_Dimension(t.geometry) as geom_dimension
        FROM ${stagingSchema}.trails t
        WHERE t.app_uuid IN (
          SELECT DISTINCT unnest(string_to_array(rr.constituent_trail_uuids, ',')) as trail_uuid
          FROM ${stagingSchema}.route_recommendations rr
          WHERE rr.id = $1
        )
        ORDER BY t.name
      `, [route.id]);
      
      if (constituentTrails.rows.length === 0) {
        console.log(`   ❌ No constituent trails found`);
        
        // Check if constituent_trail_uuids column exists and has data
        const columnCheck = await pgClient.query(`
          SELECT 
            column_name,
            data_type
          FROM information_schema.columns 
          WHERE table_schema = $1 
            AND table_name = 'route_recommendations' 
            AND column_name = 'constituent_trail_uuids'
        `, [stagingSchema]);
        
        if (columnCheck.rows.length === 0) {
          console.log(`   ⚠️  constituent_trail_uuids column does not exist`);
        } else {
          const trailUuids = await pgClient.query(`
            SELECT constituent_trail_uuids 
            FROM ${stagingSchema}.route_recommendations 
            WHERE id = $1
          `, [route.id]);
          
          console.log(`   📋 constituent_trail_uuids: ${trailUuids.rows[0]?.constituent_trail_uuids || 'NULL'}`);
        }
      } else {
        console.log(`   📊 Found ${constituentTrails.rows.length} constituent trails:`);
        
        let totalLength = 0;
        let totalGain = 0;
        let totalLoss = 0;
        let minElev = Infinity;
        let maxElev = -Infinity;
        
        for (const trail of constituentTrails.rows) {
          console.log(`      🛤️  ${trail.trail_name || 'Unknown'} (${trail.trail_id})`);
          console.log(`         📏 Length: ${trail.length_km?.toFixed(2) || 'N/A'} km`);
          console.log(`         ⬆️  Gain: ${trail.elevation_gain?.toFixed(0) || 'N/A'} m`);
          console.log(`         ⬇️  Loss: ${trail.elevation_loss?.toFixed(0) || 'N/A'} m`);
          console.log(`         📍 Min/Max Elev: ${trail.min_elevation?.toFixed(0) || 'N/A'}/${trail.max_elevation?.toFixed(0) || 'N/A'} m`);
          console.log(`         📊 Avg Elev: ${trail.avg_elevation?.toFixed(0) || 'N/A'} m`);
          console.log(`         🗺️  Geom: ${trail.geom_type} (${trail.geom_dimension}D, ${trail.geom_length?.toFixed(2) || 'N/A'} km)`);
          
          totalLength += trail.length_km || 0;
          totalGain += trail.elevation_gain || 0;
          totalLoss += trail.elevation_loss || 0;
          if (trail.min_elevation) minElev = Math.min(minElev, trail.min_elevation);
          if (trail.max_elevation) maxElev = Math.max(maxElev, trail.max_elevation);
        }
        
        console.log(`   📈 Constituent Trail Totals:`);
        console.log(`      📏 Total Length: ${totalLength.toFixed(2)} km`);
        console.log(`      ⬆️  Total Gain: ${totalGain.toFixed(0)} m`);
        console.log(`      ⬇️  Total Loss: ${totalLoss.toFixed(0)} m`);
        console.log(`      📍 Elevation Range: ${minElev === Infinity ? 'N/A' : minElev.toFixed(0)} - ${maxElev === -Infinity ? 'N/A' : maxElev.toFixed(0)} m`);
      }
    }
    
    // Check export_edges table
    console.log('\n🔗 EXPORT EDGES ANALYSIS:');
    console.log('=========================');
    
    const exportEdgesCheck = await pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN source IS NOT NULL THEN 1 END) as edges_with_source,
        COUNT(CASE WHEN target IS NOT NULL THEN 1 END) as edges_with_target,
        COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as edges_with_both,
        COUNT(CASE WHEN geojson IS NOT NULL THEN 1 END) as edges_with_geojson,
        COUNT(CASE WHEN trail_id IS NOT NULL THEN 1 END) as edges_with_trail_id,
        COUNT(CASE WHEN trail_name IS NOT NULL THEN 1 END) as edges_with_trail_name
      FROM ${stagingSchema}.export_edges
    `);
    
    const edges = exportEdgesCheck.rows[0];
    console.log(`📊 Export Edges Statistics:`);
    console.log(`   📏 Total Edges: ${edges.total_edges}`);
    console.log(`   🔗 With Source: ${edges.edges_with_source}`);
    console.log(`   🔗 With Target: ${edges.edges_with_target}`);
    console.log(`   🔗 With Both: ${edges.edges_with_both}`);
    console.log(`   🗺️  With GeoJSON: ${edges.edges_with_geojson}`);
    console.log(`   🛤️  With Trail ID: ${edges.edges_with_trail_id}`);
    console.log(`   🛤️  With Trail Name: ${edges.edges_with_trail_name}`);
    
    // Check ways_noded table
    console.log('\n🔗 WAYS_NODED ANALYSIS:');
    console.log('=======================');
    
    const waysNodedCheck = await pgClient.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN source IS NOT NULL THEN 1 END) as edges_with_source,
        COUNT(CASE WHEN target IS NOT NULL THEN 1 END) as edges_with_target,
        COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as edges_with_both,
        COUNT(CASE WHEN the_geom IS NOT NULL THEN 1 END) as edges_with_geom,
        COUNT(CASE WHEN elevation_gain IS NOT NULL THEN 1 END) as edges_with_elevation_gain,
        COUNT(CASE WHEN elevation_loss IS NOT NULL THEN 1 END) as edges_with_elevation_loss,
        COUNT(CASE WHEN trail_name IS NOT NULL THEN 1 END) as edges_with_trail_name
      FROM ${stagingSchema}.ways_noded
    `);
    
    const ways = waysNodedCheck.rows[0];
    console.log(`📊 Ways Noded Statistics:`);
    console.log(`   📏 Total Edges: ${ways.total_edges}`);
    console.log(`   🔗 With Source: ${ways.edges_with_source}`);
    console.log(`   🔗 With Target: ${ways.edges_with_target}`);
    console.log(`   🔗 With Both: ${ways.edges_with_both}`);
    console.log(`   🗺️  With Geometry: ${ways.edges_with_geom}`);
    console.log(`   ⬆️  With Elevation Gain: ${ways.edges_with_elevation_gain}`);
    console.log(`   ⬇️  With Elevation Loss: ${ways.edges_with_elevation_loss}`);
    console.log(`   🛤️  With Trail Name: ${ways.edges_with_trail_name}`);
    
    // Sample some edges to see their data
    console.log('\n📋 SAMPLE EDGE DATA:');
    console.log('===================');
    
    const sampleEdges = await pgClient.query(`
      SELECT 
        id,
        source,
        target,
        trail_name,
        cost as length_km,
        elevation_gain,
        elevation_loss,
        ST_GeometryType(the_geom) as geom_type,
        ST_Dimension(the_geom) as geom_dimension,
        ST_NumPoints(the_geom) as num_points
      FROM ${stagingSchema}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
      LIMIT 5
    `);
    
    for (const edge of sampleEdges.rows) {
      console.log(`\n   🔗 Edge ${edge.id}: ${edge.source} → ${edge.target}`);
      console.log(`      🛤️  Trail: ${edge.trail_name || 'Unknown'}`);
      console.log(`      📏 Length: ${edge.length_km?.toFixed(2) || 'N/A'} km`);
      console.log(`      ⬆️  Gain: ${edge.elevation_gain?.toFixed(0) || 'N/A'} m`);
      console.log(`      ⬇️  Loss: ${edge.elevation_loss?.toFixed(0) || 'N/A'} m`);
      console.log(`      🗺️  Geometry: ${edge.geom_type} (${edge.geom_dimension}D, ${edge.num_points} points)`);
    }
    
  } catch (error) {
    console.error('❌ Error analyzing route stats:', error);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  analyzeRouteStats().catch(console.error);
}
