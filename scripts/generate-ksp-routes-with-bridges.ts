import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { PgRoutingHelpers } from '../src/utils/pgrouting-helpers';

interface RoutePattern {
  id: number;
  pattern_name: string;
  target_distance_km: number;
  target_elevation_gain: number;
  route_shape: string;
  tolerance_percent: number;
}

interface RouteRecommendation {
  route_uuid: string;
  route_name: string;
  route_type: string;
  route_shape: string;
  input_distance_km: number;
  input_elevation_gain: number;
  recommended_distance_km: number;
  recommended_elevation_gain: number;
  route_path: any;
  route_edges: any;
  trail_count: number;
  route_score: number;
  similarity_score: number;
  region: string;
}

async function generateKspRoutes() {
  console.log('🧭 Generating K-Shortest Paths routes from route patterns...');
  
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: 'shaydu'
  });

  try {
    // Step 1: Load route patterns
    console.log('📋 Loading route patterns...');
    const patternsResult = await pool.query(`
      SELECT * FROM public.route_patterns 
      ORDER BY target_distance_km
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} route patterns`);

    // Step 2: Create staging schema
    const stagingSchema = `ksp_routes_${Date.now()}`;
    console.log(`📁 Creating staging schema: ${stagingSchema}`);
    
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${stagingSchema}`);
    
    // Step 3: Create staging tables (integer domain)
    console.log('📊 Creating staging tables...');
    await pool.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT,
        name TEXT,
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);

    // Step 4: Copy trail data (Boulder bbox)
    console.log('📊 Copying trail data...');
    
    // Try a larger bbox for better connectivity
    const useLargerBbox = true; // Set to false to use original Boulder bbox
    
    let bboxFilter = '';
    if (useLargerBbox) {
      // Larger bbox covering more of Boulder County for better connectivity
      bboxFilter = `AND ST_Intersects(geometry, ST_MakeEnvelope(-105.4, 39.9, -105.2, 40.1, 4326))`;
      console.log('🗺️ Using larger bbox for better connectivity...');
    } else {
      // Original Boulder bbox
      bboxFilter = `AND ST_Intersects(geometry, ST_MakeEnvelope(-105.33917192801866, 39.95803339005218, -105.2681945500977, 40.0288146943966, 4326))`;
      console.log('🗺️ Using original Boulder bbox...');
    }
    
    await pool.query(`
      INSERT INTO ${stagingSchema}.trails (app_uuid, name, length_km, elevation_gain, elevation_loss, geometry)
      SELECT app_uuid::text, name, length_km, elevation_gain, elevation_loss, geometry
      FROM public.trails
      WHERE geometry IS NOT NULL 
        AND ST_IsValid(geometry)
        ${bboxFilter}
    `);

    const trailsCount = await pool.query(`SELECT COUNT(*) FROM ${stagingSchema}.trails`);
    console.log(`✅ Copied ${trailsCount.rows[0].count} trails to staging`);

    // Step 5: Create pgRouting network
    const pgrouting = new PgRoutingHelpers({
      stagingSchema,
      pgClient: pool
    });

    console.log('🔄 Creating pgRouting network...');
    const networkCreated = await pgrouting.createPgRoutingViews();
    if (!networkCreated) {
      throw new Error('Failed to create pgRouting network');
    }

    // Step 6: Get network statistics
    const statsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded) as edges,
        (SELECT COUNT(*) FROM ${stagingSchema}.ways_noded_vertices_pgr) as vertices
    `);
    console.log(`📊 Network created: ${statsResult.rows[0].edges} edges, ${statsResult.rows[0].vertices} vertices`);

    // Step 6.5: Add length and elevation columns to ways_noded for KSP routing
    console.log('📏 Adding length and elevation columns to ways_noded...');
    
    // Add length_km column
    await pool.query(`
      ALTER TABLE ${stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS length_km DOUBLE PRECISION
    `);
    
    // Calculate length in kilometers
    await pool.query(`
      UPDATE ${stagingSchema}.ways_noded 
      SET length_km = ST_Length(the_geom::geography) / 1000
    `);
    
    // Add elevation_gain column (we'll calculate this from the trail data)
    await pool.query(`
      ALTER TABLE ${stagingSchema}.ways_noded 
      ADD COLUMN IF NOT EXISTS elevation_gain DOUBLE PRECISION DEFAULT 0
    `);
    
    // Calculate elevation gain by joining with trail data
    await pool.query(`
      UPDATE ${stagingSchema}.ways_noded w
      SET elevation_gain = COALESCE(t.elevation_gain, 0)
      FROM ${stagingSchema}.trails t
      WHERE w.old_id = t.id
    `);
    
    console.log('✅ Added length_km and elevation_gain columns to ways_noded');

    // Step 6.5.5: Add virtual bridges for small gaps (up to 20m)
    console.log('🌉 Adding virtual bridges for gaps up to 20m...');
    
    const maxGapDistance = 0.00018; // ~20 meters in degrees (20m / 111320 m/degree)
    
    // Find disconnected node pairs within 50m of each other
    const gapBridges = await pool.query(`
      WITH disconnected_pairs AS (
        SELECT 
          v1.id as node1_id,
          v2.id as node2_id,
          ST_Distance(v1.the_geom, v2.the_geom) as distance_degrees,
          v1.the_geom as geom1,
          v2.the_geom as geom2
        FROM ${stagingSchema}.ways_noded_vertices_pgr v1
        CROSS JOIN ${stagingSchema}.ways_noded_vertices_pgr v2
        WHERE v1.id < v2.id
          AND ST_DWithin(v1.the_geom, v2.the_geom, $1)
          AND NOT EXISTS (
            SELECT 1 FROM ${stagingSchema}.ways_noded e 
            WHERE (e.source = v1.id AND e.target = v2.id) 
               OR (e.source = v2.id AND e.target = v1.id)
          )
      )
      SELECT 
        node1_id,
        node2_id,
        distance_degrees,
        (distance_degrees * 111320) as distance_meters,
        ST_MakeLine(geom1, geom2) as bridge_geom
      FROM disconnected_pairs
      WHERE distance_degrees <= $1
      ORDER BY distance_degrees
      LIMIT 100  -- Limit to prevent too many bridges
    `, [maxGapDistance]);
    
    if (gapBridges.rows.length > 0) {
      console.log(`🌉 Found ${gapBridges.rows.length} gaps to bridge (max 50m)`);
      
      // Add virtual bridge edges
      let bridgesAdded = 0;
      for (const bridge of gapBridges.rows) {
        try {
          await pool.query(`
            INSERT INTO ${stagingSchema}.ways_noded (id, source, target, the_geom, length_km, elevation_gain, old_id)
            VALUES (
              (SELECT COALESCE(MAX(id), 0) + 1 FROM ${stagingSchema}.ways_noded),
              $1, $2, $3, $4, 0, -1
            )
          `, [
            bridge.node1_id, 
            bridge.node2_id, 
            bridge.bridge_geom, 
            bridge.distance_meters / 1000 // Convert meters to km
          ]);
          bridgesAdded++;
        } catch (error) {
          console.log(`  ⚠️ Failed to add bridge between nodes ${bridge.node1_id} and ${bridge.node2_id}: ${error}`);
        }
      }
      
      console.log(`✅ Added ${bridgesAdded} virtual bridge edges`);
      
      // Update network statistics after adding bridges
      const updatedStats = await pool.query(`
        SELECT 
          COUNT(*) as total_edges,
          COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as connected_edges
        FROM ${stagingSchema}.ways_noded
      `);
      
      console.log(`📊 Updated network: ${updatedStats.rows[0].total_edges} total edges, ${updatedStats.rows[0].connected_edges} connected`);
    } else {
      console.log('✅ No gaps found within 50m tolerance');
    }

    // Step 6.6: Analyze network connectivity
    console.log('🔍 Analyzing network connectivity...');
    const analysisResult = await pgrouting.analyzeGraph();
    
    console.log('📊 Raw analyzeGraph result:', JSON.stringify(analysisResult, null, 2));
    
    if (analysisResult.success && analysisResult.analysis) {
      console.log('📊 Network analysis results:');
      console.log(`  - Connected components: ${analysisResult.analysis.components || 'N/A'}`);
      console.log(`  - Isolated nodes: ${analysisResult.analysis.isolated_nodes || 'N/A'}`);
      console.log(`  - Dead ends: ${analysisResult.analysis.dead_ends || 'N/A'}`);
      console.log(`  - Network is connected: ${analysisResult.analysis.is_connected || 'N/A'}`);
    } else {
      console.log('⚠️ Network analysis failed, continuing anyway...');
      console.log('Error:', analysisResult.error);
    }

    // Direct pgr_analyzeGraph call for debugging
    console.log('🔍 Running direct pgr_analyzeGraph...');
    try {
      const directAnalysis = await pool.query(`
        SELECT * FROM pgr_analyzeGraph('${stagingSchema}.ways_noded', 0.000001, 'the_geom', 'id', 'source', 'target')
      `);
      console.log('📊 Direct pgr_analyzeGraph result:', JSON.stringify(directAnalysis.rows, null, 2));
    } catch (error) {
      console.log('❌ Direct pgr_analyzeGraph failed:', error);
    }

    // Step 6.6: Additional network diagnostics
    console.log('🔍 Additional network diagnostics...');
    
    // Check what columns exist in ways_noded
    const waysColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'ways_noded'
      ORDER BY ordinal_position
    `, [stagingSchema]);
    
    console.log('📊 ways_noded table columns:');
    waysColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

    // Check node connectivity
    const nodeConnectivity = await pool.query(`
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN cnt >= 2 THEN 1 END) as intersection_nodes,
        COUNT(CASE WHEN cnt = 1 THEN 1 END) as dead_end_nodes,
        AVG(cnt) as avg_connections
      FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    
    const connectivity = nodeConnectivity.rows[0];
    console.log(`📊 Node connectivity:`);
    console.log(`  - Total nodes: ${connectivity.total_nodes}`);
    console.log(`  - Intersection nodes (≥2 connections): ${connectivity.intersection_nodes}`);
    console.log(`  - Dead end nodes (1 connection): ${connectivity.dead_end_nodes}`);
    console.log(`  - Average connections per node: ${connectivity.avg_connections ? parseFloat(connectivity.avg_connections).toFixed(1) : 'N/A'}`);

    // Check edge connectivity
    const edgeConnectivity = await pool.query(`
      SELECT 
        COUNT(*) as total_edges,
        COUNT(CASE WHEN source IS NOT NULL AND target IS NOT NULL THEN 1 END) as connected_edges,
        AVG(ST_Length(the_geom::geography) / 1000) as avg_length_km
      FROM ${stagingSchema}.ways_noded
    `);
    
    const edges = edgeConnectivity.rows[0];
    console.log(`📊 Edge connectivity:`);
    console.log(`  - Total edges: ${edges.total_edges}`);
    console.log(`  - Connected edges: ${edges.connected_edges}`);
    console.log(`  - Average edge length: ${edges.avg_length_km ? parseFloat(edges.avg_length_km).toFixed(2) : 'N/A'}km`);

    // Step 6.6: Analyze network connectivity and fragmentation
    console.log('🔍 Analyzing network fragmentation...');
    
    // Check for connected components
    const connectedComponents = await pool.query(`
      WITH RECURSIVE component_search AS (
        -- Start with each node
        SELECT id, id as component_id, 1 as depth
        FROM ${stagingSchema}.ways_noded_vertices_pgr
        UNION ALL
        -- Find connected nodes
        SELECT v.id, cs.component_id, cs.depth + 1
        FROM ${stagingSchema}.ways_noded_vertices_pgr v
        JOIN ${stagingSchema}.ways_noded e ON (v.id = e.source OR v.id = e.target)
        JOIN component_search cs ON (e.source = cs.id OR e.target = cs.id)
        WHERE cs.depth < 100  -- Prevent infinite recursion
      )
      SELECT 
        component_id,
        COUNT(DISTINCT id) as node_count,
        MIN(id) as min_node_id,
        MAX(id) as max_node_id
      FROM component_search
      GROUP BY component_id
      ORDER BY node_count DESC
    `);
    
    console.log(`📊 Network fragmentation analysis:`);
    console.log(`  - Connected components: ${connectedComponents.rows.length}`);
    
    if (connectedComponents.rows.length > 0) {
      const largestComponent = connectedComponents.rows[0];
      console.log(`  - Largest component: ${largestComponent.node_count} nodes (${((largestComponent.node_count / connectivity.total_nodes) * 100).toFixed(1)}%)`);
      
      if (connectedComponents.rows.length > 1) {
        console.log(`  - Other components: ${connectedComponents.rows.slice(1).map(c => `${c.node_count} nodes`).join(', ')}`);
      }
    }

    // Check for isolated nodes (no connections)
    const isolatedNodes = await pool.query(`
      SELECT COUNT(*) as isolated_count
      FROM ${stagingSchema}.ways_noded_vertices_pgr v
      WHERE NOT EXISTS (
        SELECT 1 FROM ${stagingSchema}.ways_noded e 
        WHERE e.source = v.id OR e.target = v.id
      )
    `);
    
    console.log(`  - Isolated nodes: ${isolatedNodes.rows[0].isolated_count}`);

    // Step 6.7: Export network components to GeoJSON for visualization
    console.log('📤 Exporting network components to GeoJSON...');
    
    // Export trails (original data)
    const trailsGeoJSON = await pool.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geometry)::json,
              'properties', json_build_object(
                'id', id,
                'app_uuid', app_uuid,
                'name', name,
                'length_km', length_km,
                'elevation_gain', elevation_gain,
                'elevation_loss', elevation_loss
              )
            )
          )
        ) as geojson
      FROM ${stagingSchema}.trails
    `);
    
    if (trailsGeoJSON.rows[0].geojson) {
      fs.writeFileSync('test-output/network-trails.geojson', JSON.stringify(trailsGeoJSON.rows[0].geojson, null, 2));
      console.log('✅ Exported trails to test-output/network-trails.geojson');
    }

    // Export ways_noded edges (pgRouting network)
    const edgesGeoJSON = await pool.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(the_geom)::json,
              'properties', json_build_object(
                'id', id,
                'source', source,
                'target', target,
                'length_km', length_km,
                'elevation_gain', elevation_gain,
                'old_id', old_id
              )
            )
          )
        ) as geojson
      FROM ${stagingSchema}.ways_noded
      WHERE source IS NOT NULL AND target IS NOT NULL
    `);
    
    if (edgesGeoJSON.rows[0].geojson) {
      fs.writeFileSync('test-output/network-edges.geojson', JSON.stringify(edgesGeoJSON.rows[0].geojson, null, 2));
      console.log('✅ Exported edges to test-output/network-edges.geojson');
    }

    // Export vertices (nodes)
    const nodesGeoJSON = await pool.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(the_geom)::json,
              'properties', json_build_object(
                'id', id,
                'cnt', cnt,
                'chk', chk,
                'ein', ein,
                'eout', eout
              )
            )
          )
        ) as geojson
      FROM ${stagingSchema}.ways_noded_vertices_pgr
    `);
    
    if (nodesGeoJSON.rows[0].geojson) {
      fs.writeFileSync('test-output/network-nodes.geojson', JSON.stringify(nodesGeoJSON.rows[0].geojson, null, 2));
      console.log('✅ Exported nodes to test-output/network-nodes.geojson');
    }

    // Export a combined network view
    const combinedGeoJSON = await pool.query(`
      SELECT 
        json_build_object(
          'type', 'FeatureCollection',
          'features', json_agg(feature)
        ) as geojson
      FROM (
        -- Add edges
        SELECT 
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(the_geom)::json,
            'properties', json_build_object(
              'type', 'edge',
              'id', id,
              'source', source,
              'target', target,
              'length_km', length_km,
              'elevation_gain', elevation_gain
            )
          ) as feature
        FROM ${stagingSchema}.ways_noded
        WHERE source IS NOT NULL AND target IS NOT NULL
        UNION ALL
        -- Add nodes
        SELECT 
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(the_geom)::json,
            'properties', json_build_object(
              'type', 'node',
              'id', id,
              'connections', cnt,
              'is_intersection', CASE WHEN cnt >= 2 THEN true ELSE false END
            )
          ) as feature
        FROM ${stagingSchema}.ways_noded_vertices_pgr
      ) features
    `);
    
    if (combinedGeoJSON.rows[0].geojson) {
      fs.writeFileSync('test-output/network-combined.geojson', JSON.stringify(combinedGeoJSON.rows[0].geojson, null, 2));
      console.log('✅ Exported combined network to test-output/network-combined.geojson');
    }

    // Step 7: Generate routes for each pattern
    const allRecommendations: RouteRecommendation[] = [];
    
    for (const pattern of patterns) {
      console.log(`\n🎯 Processing pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      // Get intersection nodes for routing
      const nodesResult = await pool.query(`
        SELECT pg_id as id, node_type, connection_count 
        FROM ${stagingSchema}.node_mapping 
        WHERE node_type IN ('intersection', 'simple_connection')
        ORDER BY connection_count DESC
        LIMIT 20
      `);
      
      if (nodesResult.rows.length < 2) {
        console.log('⚠️ Not enough nodes for routing');
        continue;
      }

      const patternRoutes: RouteRecommendation[] = [];
      const targetRoutes = 5;
      
      // Try different tolerance levels to get 5 routes
      const toleranceLevels = [
        { name: 'strict', distance: pattern.tolerance_percent, elevation: pattern.tolerance_percent, quality: 1.0 },
        { name: 'medium', distance: 50, elevation: 50, quality: 0.8 },
        { name: 'wide', distance: 100, elevation: 100, quality: 0.6 }
      ];

      for (const tolerance of toleranceLevels) {
        if (patternRoutes.length >= targetRoutes) break;
        
        console.log(`🔍 Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
        
        // Generate routes between node pairs
        for (let i = 0; i < Math.min(nodesResult.rows.length - 1, 10); i++) {
          if (patternRoutes.length >= targetRoutes) break;
          
          const startNode = nodesResult.rows[i].id;
          const endNode = nodesResult.rows[i + 1].id;
          
          // Try KSP routing between these nodes
          console.log(`🛤️ Trying KSP from node ${startNode} to node ${endNode}...`);
          
          try {
            // First check if these nodes are connected
            const connectivityCheck = await pool.query(`
              SELECT 
                COUNT(*) as path_exists
              FROM pgr_dijkstra(
                'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
                $1::integer, $2::integer, false
              )
            `, [startNode, endNode]);
            
            const hasPath = connectivityCheck.rows[0].path_exists > 0;
            console.log(`  📊 Path exists: ${hasPath} (${connectivityCheck.rows[0].path_exists} edges)`);
            
            if (!hasPath) {
              console.log(`  ❌ No path exists between nodes ${startNode} and ${endNode}`);
              continue;
            }

            const kspResult = await pool.query(`
              SELECT * FROM pgr_ksp(
                'SELECT id, source, target, (length_km * 1000) + (elevation_gain * 10) as cost FROM ${stagingSchema}.ways_noded',
                $1::integer, $2::integer, 5, false
              )
            `, [startNode, endNode]);
            
            console.log(`✅ KSP found ${kspResult.rows.length} routes`);
            
            if (kspResult.rows.length > 0) {
              // Process each route from KSP
              for (const route of kspResult.rows) {
                // Get the edges for this route
                const routeEdges = await pool.query(`
                  SELECT * FROM ${stagingSchema}.ways_noded 
                  WHERE id = ANY($1::integer[])
                  ORDER BY id
                `, [route.path]);
                
                if (routeEdges.rows.length === 0) {
                  console.log(`  ⚠️ No edges found for route path`);
                  continue;
                }
                
                // Calculate route metrics
                let totalDistance = 0;
                let totalElevationGain = 0;
                
                for (const edge of routeEdges.rows) {
                  totalDistance += edge.length_km || 0;
                  totalElevationGain += edge.elevation_gain || 0;
                }
                
                console.log(`  📏 Route metrics: ${totalDistance.toFixed(2)}km, ${totalElevationGain.toFixed(0)}m elevation`);
                
                // Check if route meets tolerance criteria
                const distanceOk = totalDistance >= pattern.target_distance_km * (1 - tolerance.distance / 100) && totalDistance <= pattern.target_distance_km * (1 + tolerance.distance / 100);
                const elevationOk = totalElevationGain >= pattern.target_elevation_gain * (1 - tolerance.elevation / 100) && totalElevationGain <= pattern.target_elevation_gain * (1 + tolerance.elevation / 100);
                
                if (distanceOk && elevationOk) {
                  // Calculate quality score based on tolerance level
                  const finalScore = tolerance.quality * (1.0 - Math.abs(totalDistance - pattern.target_distance_km) / pattern.target_distance_km);
                  
                  console.log(`  ✅ Route meets criteria! Score: ${finalScore.toFixed(3)}`);
                  
                  // Store the route
                  const recommendation: RouteRecommendation = {
                    route_uuid: `ksp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    route_name: `${pattern.pattern_name} - KSP Route`,
                    route_type: 'custom',
                    route_shape: pattern.route_shape,
                    input_distance_km: pattern.target_distance_km,
                    input_elevation_gain: pattern.target_elevation_gain,
                    recommended_distance_km: totalDistance,
                    recommended_elevation_gain: totalElevationGain,
                    route_path: route,
                    route_edges: routeEdges.rows,
                    trail_count: routeEdges.rows.length, // Assuming trail_count is number of edges
                    route_score: Math.floor(finalScore * 100),
                    similarity_score: finalScore,
                    region: 'boulder'
                  };
                  
                  patternRoutes.push(recommendation);
                  
                  if (patternRoutes.length >= 5) {
                    console.log(`  🎯 Reached 5 routes for this pattern`);
                    break;
                  }
                } else {
                  console.log(`  ❌ Route doesn't meet criteria (distance: ${distanceOk}, elevation: ${elevationOk})`);
                }
              }
            }
          } catch (error: any) {
            console.log(`❌ KSP routing failed: ${error.message}`);
          }
        }
      }
      
      // Sort by score and take top 5
      const bestRoutes = patternRoutes
        .sort((a, b) => b.route_score - a.route_score)
        .slice(0, targetRoutes);
      
      allRecommendations.push(...bestRoutes);
      console.log(`✅ Generated ${bestRoutes.length} routes for ${pattern.pattern_name}`);
    }

    // Step 8: Store recommendations
    console.log(`\n💾 Storing ${allRecommendations.length} route recommendations...`);
    
    for (const rec of allRecommendations) {
      await pool.query(`
        INSERT INTO public.route_recommendations (
          route_uuid, route_name, route_type, route_shape,
          input_distance_km, input_elevation_gain,
          recommended_distance_km, recommended_elevation_gain,
          route_path, route_edges, trail_count, route_score,
          similarity_score, region, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
      `, [
        rec.route_uuid, rec.route_name, rec.route_type, rec.route_shape,
        rec.input_distance_km, rec.input_elevation_gain,
        rec.recommended_distance_km, rec.recommended_elevation_gain,
        JSON.stringify(rec.route_path), JSON.stringify(rec.route_edges),
        rec.trail_count, rec.route_score, rec.similarity_score, rec.region
      ]);
    }

    console.log(`✅ Successfully stored ${allRecommendations.length} route recommendations`);

    // Step 9: Export sample routes
    console.log('📤 Exporting sample routes as GeoJSON...');
    const sampleRoutes = allRecommendations.slice(0, 3);
    
    const routesGeoJSON = {
      type: 'FeatureCollection',
      features: sampleRoutes.map((route, index) => ({
        type: 'Feature',
        properties: {
          layer: 'routes',
          color: ['#FF0000', '#00FF00', '#0000FF'][index % 3],
          route_name: route.route_name,
          distance_km: route.recommended_distance_km,
          trail_count: route.trail_count,
          route_score: route.route_score
        },
        geometry: {
          type: 'LineString',
          coordinates: route.route_edges.map((edge: any) => {
            return [-105.28, 39.98]; // Placeholder coordinates
          })
        }
      }))
    };

    const outputDir = 'test-output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(
      path.join(outputDir, 'ksp-routes.geojson'),
      JSON.stringify(routesGeoJSON, null, 2)
    );

    console.log('✅ Exported sample routes to test-output/ksp-routes.geojson');

    // Step 10: Cleanup
    await pgrouting.cleanupViews();
    await pool.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);

    console.log('✅ KSP route generation completed successfully!');

  } catch (error) {
    console.error('❌ KSP route generation failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the KSP route generation
generateKspRoutes().catch(console.error); 