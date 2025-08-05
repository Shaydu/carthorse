import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { PgRoutingHelpers, createPgRoutingHelpers } from '../src/utils/pgrouting-helpers';
import { KspRouteGenerator, RoutePattern, RouteRecommendation } from '../src/utils/ksp-route-generator';

async function generateKspRoutes() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'shaydu',
    password: 'shaydu'
  });

  try {
    // Step 1: Load ONLY out-and-back route patterns
    console.log('📋 Loading out-and-back route patterns...');
    const patternsResult = await pool.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'out-and-back'
      ORDER BY target_distance_km
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} out-and-back route patterns`);
    
    console.log('🔍 Out-and-back patterns to process:');
    for (const pattern of patterns) {
      console.log(`  - ${pattern.pattern_name}: ${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m elevation`);
    }

    if (patterns.length === 0) {
      console.log('⚠️ No out-and-back patterns found');
      return;
    }

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

    // Step 4: Copy trail data (Boulder region)
    console.log('📊 Copying trail data...');
    
    // Use specific bbox instead of region filter
    const bboxFilter = `
      AND ST_Intersects(geometry, ST_MakeEnvelope(-105.35545816139866, 39.86840223651447, -105.20922413855001, 40.01750391845792, 4326))
    `;
    console.log('🗺️ Using new bbox filter...');
    
    await pool.query(`
      INSERT INTO ${stagingSchema}.trails (app_uuid, name, geometry, length_km, elevation_gain)
      SELECT app_uuid::text, name, geometry, length_km, elevation_gain
      FROM public.trails
      WHERE geometry IS NOT NULL ${bboxFilter}
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

    // Step 6.5.5: Skip connectivity fixes to ensure routes follow actual trails only
    console.log('⏭️ Skipping connectivity fixes to preserve trail-only routing');

    // Step 7: Generate out-and-back routes using native pgRouting functions
    const allRecommendations: RouteRecommendation[] = [];
    
    for (const pattern of patterns) {
      console.log(`\n🎯 Processing out-and-back pattern: ${pattern.pattern_name} (${pattern.target_distance_km}km, ${pattern.target_elevation_gain}m)`);
      
      // Target half the distance since we'll double it for out-and-back
      const halfTargetDistance = pattern.target_distance_km / 2;
      const halfTargetElevation = pattern.target_elevation_gain / 2;
      
      console.log(`📏 Targeting half-distance: ${halfTargetDistance.toFixed(1)}km, half-elevation: ${halfTargetElevation.toFixed(0)}m`);
      
          // Get trail network entry points with geographic diversity
    const nodesResult = await pool.query(`
      SELECT nm.pg_id as id, nm.node_type, nm.connection_count, 
             ST_X(v.the_geom) as lon, 
             ST_Y(v.the_geom) as lat
      FROM ${stagingSchema}.node_mapping nm
      JOIN ${stagingSchema}.ways_noded_vertices_pgr v ON nm.pg_id = v.id
      WHERE nm.node_type IN ('intersection', 'simple_connection')
      AND nm.connection_count <= 4  -- Prefer entry points (fewer connections)
      ORDER BY nm.connection_count ASC, nm.pg_id
      LIMIT 50
    `);
      
      if (nodesResult.rows.length < 2) {
        console.log('⚠️ Not enough nodes for routing');
        continue;
      }

      const patternRoutes: RouteRecommendation[] = [];
      const targetRoutes = 5;
      
      // Track used geographic areas to ensure diversity
      const usedAreas: Array<{lon: number, lat: number, distance: number}> = [];
      const minDistanceBetweenRoutes = 2.0; // Minimum 2km between route centers
      
      // Try different tolerance levels
      const toleranceLevels = [
        { name: 'strict', distance: pattern.tolerance_percent, elevation: pattern.tolerance_percent, quality: 1.0 },
        { name: 'medium', distance: 50, elevation: 50, quality: 0.8 },
        { name: 'wide', distance: 100, elevation: 100, quality: 0.6 }
      ];

      for (const tolerance of toleranceLevels) {
        if (patternRoutes.length >= targetRoutes) break;
        
        console.log(`🔍 Trying ${tolerance.name} tolerance (${tolerance.distance}% distance, ${tolerance.elevation}% elevation)`);
        
        // Generate out-and-back routes from each node with geographic diversity
        for (let i = 0; i < Math.min(nodesResult.rows.length, 20); i++) {
          if (patternRoutes.length >= targetRoutes) break;
          
          const startNode = nodesResult.rows[i].id;
          const startLon = nodesResult.rows[i].lon;
          const startLat = nodesResult.rows[i].lat;
          
          // Check if this area is already used by another route
          const isAreaUsed = usedAreas.some(area => {
            const distance = Math.sqrt(
              Math.pow((startLon - area.lon) * 111.32 * Math.cos(startLat * Math.PI / 180), 2) +
              Math.pow((startLat - area.lat) * 111.32, 2)
            );
            return distance < minDistanceBetweenRoutes;
          });
          
          if (isAreaUsed) {
            console.log(`  ⏭️ Skipping node ${startNode} - area already used`);
            continue;
          }
          
          // Find reachable nodes within reasonable distance
          const maxSearchDistance = halfTargetDistance * 2;
          console.log(`  🔍 Finding nodes reachable within ${maxSearchDistance.toFixed(1)}km from node ${startNode}...`);
          
          const reachableNodes = await pool.query(`
            SELECT DISTINCT end_vid as node_id, agg_cost as distance_km
            FROM pgr_dijkstra(
              'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
              $1::bigint, 
              (SELECT array_agg(pg_id) FROM ${stagingSchema}.node_mapping WHERE node_type IN ('intersection', 'simple_connection')),
              false
            )
            WHERE agg_cost <= $2
            AND end_vid != $1
            ORDER BY agg_cost DESC
            LIMIT 10
          `, [startNode, maxSearchDistance]);
          
          if (reachableNodes.rows.length === 0) {
            console.log(`  ❌ No reachable nodes found from node ${startNode} within ${maxSearchDistance.toFixed(1)}km`);
            continue;
          }
          
          console.log(`  ✅ Found ${reachableNodes.rows.length} reachable nodes from node ${startNode}`);
          
          // Try each reachable node as a destination
          for (const reachableNode of reachableNodes.rows) {
            if (patternRoutes.length >= targetRoutes) break;
            
            const endNode = reachableNode.node_id;
            const oneWayDistance = reachableNode.distance_km;
            
            console.log(`  🛤️ Trying out-and-back route: ${startNode} → ${endNode} → ${startNode} (one-way: ${oneWayDistance.toFixed(2)}km)`);
            
            // Check if the one-way distance is reasonable for our target
            const minDistance = halfTargetDistance * (1 - tolerance.distance / 100);
            const maxDistance = halfTargetDistance * (1 + tolerance.distance / 100);
            
            if (oneWayDistance < minDistance || oneWayDistance > maxDistance) {
              console.log(`  ❌ One-way distance ${oneWayDistance.toFixed(2)}km outside tolerance range [${minDistance.toFixed(2)}km, ${maxDistance.toFixed(2)}km]`);
              continue;
            }
            
            try {
              // Use KSP to find multiple routes for the outbound journey
              const kspResult = await pool.query(`
                SELECT * FROM pgr_ksp(
                  'SELECT id, source, target, length_km as cost FROM ${stagingSchema}.ways_noded',
                  $1::bigint, $2::bigint, 3, false, false
                )
              `, [startNode, endNode]);
              
              console.log(`✅ KSP found ${kspResult.rows.length} routes`);
              
              // Process each KSP route
              const routeGroups = new Map();
              for (const row of kspResult.rows) {
                if (!routeGroups.has(row.path_id)) {
                  routeGroups.set(row.path_id, []);
                }
                routeGroups.get(row.path_id).push(row);
              }
              
              for (const [pathId, routeSteps] of routeGroups) {
                if (patternRoutes.length >= targetRoutes) break;
                
                // Extract edge IDs from the route steps (skip -1 which means no edge)
                const edgeIds = routeSteps.map((step: any) => step.edge).filter((edge: number) => edge !== -1);
                
                if (edgeIds.length === 0) {
                  console.log(`  ⚠️ No valid edges found for path ${pathId}`);
                  continue;
                }
                
                // Get the edges for this route
                const routeEdges = await pool.query(`
                  SELECT * FROM ${stagingSchema}.ways_noded 
                  WHERE id = ANY($1::integer[])
                  ORDER BY id
                `, [edgeIds]);
                
                if (routeEdges.rows.length === 0) {
                  console.log(`  ⚠️ No edges found for route path`);
                  continue;
                }
                
                // Calculate route metrics (one-way)
                let totalDistance = 0;
                let totalElevationGain = 0;
                
                for (const edge of routeEdges.rows) {
                  totalDistance += edge.length_km || 0;
                  totalElevationGain += edge.elevation_gain || 0;
                }
                
                // For out-and-back routes, double the distance and elevation for the return journey
                const outAndBackDistance = totalDistance * 2;
                const outAndBackElevation = totalElevationGain * 2;
                
                console.log(`  📏 Route metrics: ${totalDistance.toFixed(2)}km → ${outAndBackDistance.toFixed(2)}km (out-and-back), ${totalElevationGain.toFixed(0)}m → ${outAndBackElevation.toFixed(0)}m elevation`);
                
                // Check if route meets tolerance criteria (using full out-and-back distance)
                const distanceOk = outAndBackDistance >= pattern.target_distance_km * (1 - tolerance.distance / 100) && outAndBackDistance <= pattern.target_distance_km * (1 + tolerance.distance / 100);
                const elevationOk = outAndBackElevation >= pattern.target_elevation_gain * (1 - tolerance.elevation / 100) && outAndBackElevation <= pattern.target_elevation_gain * (1 + tolerance.elevation / 100);
                
                if (distanceOk && elevationOk) {
                  // Calculate quality score based on tolerance level
                  const finalScore = tolerance.quality * (1.0 - Math.abs(outAndBackDistance - pattern.target_distance_km) / pattern.target_distance_km);
                  
                  console.log(`  ✅ Route meets criteria! Score: ${finalScore.toFixed(3)}`);
                  
                  // Store the route
                  const recommendation: RouteRecommendation = {
                    route_uuid: `ksp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    route_name: `${pattern.pattern_name} - KSP Route`,
                    route_type: 'custom',
                    route_shape: 'out-and-back',
                    input_distance_km: pattern.target_distance_km,
                    input_elevation_gain: pattern.target_elevation_gain,
                    recommended_distance_km: outAndBackDistance,
                    recommended_elevation_gain: outAndBackElevation,
                    route_path: { path_id: pathId, steps: routeSteps },
                    route_edges: routeEdges.rows,
                    trail_count: routeEdges.rows.length,
                    route_score: Math.floor(finalScore * 100),
                    similarity_score: finalScore,
                    region: 'boulder'
                  };
                  
                  patternRoutes.push(recommendation);
                  
                  // Track this geographic area as used
                  usedAreas.push({
                    lon: startLon,
                    lat: startLat,
                    distance: outAndBackDistance
                  });
                  
                  console.log(`  📍 Added route in area: ${startLon.toFixed(4)}, ${startLat.toFixed(4)}`);
                  
                  if (patternRoutes.length >= targetRoutes) {
                    console.log(`  🎯 Reached ${targetRoutes} routes for this pattern`);
                    break;
                  }
                } else {
                  console.log(`  ❌ Route doesn't meet criteria (distance: ${distanceOk}, elevation: ${elevationOk})`);
                }
              }
            } catch (error: any) {
              console.log(`❌ KSP routing failed: ${error.message}`);
            }
          }
        }
      }
      
      // Sort by score and take top routes
      const bestRoutes = patternRoutes
        .sort((a, b) => b.route_score - a.route_score)
        .slice(0, targetRoutes);
      
      allRecommendations.push(...bestRoutes);
      console.log(`✅ Generated ${bestRoutes.length} out-and-back routes for ${pattern.pattern_name}`);
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
    // Get all unique routes based on route_uuid (not name)
    const uniqueRoutes = allRecommendations.filter((route, index, self) => 
      index === self.findIndex(r => r.route_uuid === route.route_uuid)
    );
    const sampleRoutes = uniqueRoutes; // Show ALL unique routes (40 total)
    
    // Color mapping for different route patterns
    const routeColors: { [key: string]: string } = {
      'Micro Out-and-Back': '#FFD700',    // Yellow
      'Short Out-and-Back': '#FFA500',    // Orange  
      'Medium Out-and-Back': '#FF0000',   // Red
      'Long Out-and-Back': '#FF0000',     // Red
      'Epic Out-and-Back': '#FF0000'      // Red
    };
    
    // Enhanced GeoJSON export with network visualization
    const enhancedGeoJSON = {
      type: 'FeatureCollection',
      features: [
        // Add trails (GREEN)
        ...(await pool.query(`
          SELECT 
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geometry)::json,
              'properties', json_build_object(
                'name', name,
                'length_km', length_km,
                'elevation_gain', elevation_gain,
                'component', 'trail',
                'color', '#00FF00',
                'stroke', '#00FF00',
                'stroke-width', 3,
                'fill-opacity', 0.8
              )
            ) as feature
          FROM ${stagingSchema}.trails
        `)).rows.map(r => r.feature),
        
        // Add edges (MAGENTA)
        ...(await pool.query(`
          SELECT 
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(the_geom)::json,
              'properties', json_build_object(
                'id', id,
                'source', source,
                'target', target,
                'length_km', length_km,
                'elevation_gain', elevation_gain,
                'component', 'edge',
                'color', '#FF00FF',
                'stroke', '#FF00FF',
                'stroke-width', 2,
                'fill-opacity', 0.6
              )
            ) as feature
          FROM ${stagingSchema}.ways_noded
        `)).rows.map(r => r.feature),
        
        // Add nodes (BLACK for intersections, RED for endpoints)
        ...(await pool.query(`
          SELECT 
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(the_geom)::json,
              'properties', json_build_object(
                'id', id,
                'connections', cnt,
                'component', 'node',
                'node_type', CASE 
                  WHEN cnt >= 2 THEN 'intersection'
                  WHEN cnt = 1 THEN 'endpoint'
                  ELSE 'unknown'
                END,
                'color', CASE 
                  WHEN cnt >= 2 THEN '#000000'
                  WHEN cnt = 1 THEN '#FF0000'
                  ELSE '#808080'
                END,
                'stroke', CASE 
                  WHEN cnt >= 2 THEN '#000000'
                  WHEN cnt = 1 THEN '#FF0000'
                  ELSE '#808080'
                END,
                'stroke-width', 2,
                'fill-opacity', 1.0
              )
            ) as feature
          FROM ${stagingSchema}.ways_noded_vertices_pgr
        `)).rows.map(r => r.feature),
        
        // Add sample routes (DOTTED ORANGE)
        ...(await Promise.all(sampleRoutes.map(async (route, index) => {
          // Parse the route_edges JSON to get the actual edge data
          const routeEdges = typeof route.route_edges === 'string' 
            ? JSON.parse(route.route_edges) 
            : route.route_edges;
          
          // Extract edge IDs from the route edges in the correct KSP order
          const edgeIds = routeEdges.map((edge: any) => edge.id).filter((id: number) => id !== null && id !== undefined);
          
          if (edgeIds.length === 0) {
            console.log(`⚠️ No valid edge IDs found for route: ${route.route_name}`);
            return null;
          }
          
          // Build the route geometry by following the exact KSP edge sequence
          let coordinates: number[][] = [];
          
          // Get the route path data to understand the node sequence
          const routePath = route.route_path;
          if (!routePath || !routePath.steps) {
            console.log(`⚠️ No route path data for route: ${route.route_name}`);
            return null;
          }
          
          // Build outbound path by following the KSP route sequence with proper edge direction
          const outboundCoordinates: number[][] = [];
          
          // Get the KSP route steps to understand the exact path
          const routeSteps = routePath.steps;
          
          // Follow the KSP route step by step, respecting edge direction
          for (let i = 0; i < routeSteps.length - 1; i++) {
            const currentStep = routeSteps[i];
            const nextStep = routeSteps[i + 1];
            
            // Skip if no edge between these nodes
            if (currentStep.edge === -1) continue;
            
            const edgeId = currentStep.edge;
            
            // Get the edge geometry and direction
            const edgeGeometry = await pool.query(`
              SELECT ST_AsGeoJSON(the_geom) as geojson, source, target
              FROM ${stagingSchema}.ways_noded 
              WHERE id = $1
            `, [edgeId]);
            
            if (edgeGeometry.rows.length > 0) {
              const edge = edgeGeometry.rows[0];
              try {
                const geojson = JSON.parse(edge.geojson);
                if (geojson.coordinates && geojson.coordinates.length > 0) {
                  // Check if we need to reverse the edge direction
                  // If the edge source doesn't match the current node, we need to reverse
                  const shouldReverse = edge.source !== currentStep.node;
                  
                  let edgeCoordinates = geojson.coordinates;
                  if (shouldReverse) {
                    // Reverse the coordinates to follow the correct direction
                    edgeCoordinates = [...edgeCoordinates].reverse();
                  }
                  
                  // Add coordinates for this edge in the correct direction
                  outboundCoordinates.push(...edgeCoordinates);
                }
              } catch (error) {
                console.log(`⚠️ Failed to parse geometry for edge ${edgeId} in route: ${route.route_name}`);
              }
            }
          }
          
          // For out-and-back routes, create the return path by reversing the outbound path
          if (outboundCoordinates.length > 0) {
            const returnCoordinates = [...outboundCoordinates].reverse();
            
            // Combine outbound and return paths
            coordinates = [...outboundCoordinates, ...returnCoordinates];
            
            console.log(`  📍 Out-and-back route ${route.route_name}: ${edgeIds.length} edges, ${coordinates.length} coordinate points (${outboundCoordinates.length} outbound + ${returnCoordinates.length} return)`);
          }
          
          // The coordinates are already built in the previous block
          // No additional processing needed since we're using PostGIS to merge the geometry
          
          if (coordinates.length === 0) {
            console.log(`⚠️ No coordinates found for route: ${route.route_name}`);
            return null;
          }
          
          console.log(`  📍 Route ${route.route_name}: ${edgeIds.length} edges, ${coordinates.length} coordinate points`);
          
          // Determine color based on route pattern
          const routePattern = route.route_name.replace(' - KSP Route', '');
          const routeColor = routeColors[routePattern] || '#FFA500'; // Default to orange
          
          return {
            type: 'Feature',
            properties: {
              layer: 'routes',
              color: routeColor,
              stroke: routeColor,
              'stroke-width': 13,
              'stroke-dasharray': '10,5',
              route_name: route.route_name,
              route_pattern: route.route_shape,
              distance_km: route.recommended_distance_km,
              elevation_gain: route.recommended_elevation_gain,
              trail_count: route.trail_count,
              route_score: route.route_score,
              component: 'route'
            },
            geometry: {
              type: 'LineString',
              coordinates: coordinates
            }
          };
        }))).filter(route => route !== null)
      ]
    };

    const outputDir = 'test-output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(
      path.join(outputDir, 'ksp-routes-enhanced.geojson'),
      JSON.stringify(enhancedGeoJSON, null, 2)
    );

    console.log('✅ Exported enhanced network visualization to test-output/ksp-routes-enhanced.geojson');
    console.log('🎨 Colors: GREEN=trails, MAGENTA=edges, BLACK=intersections, RED=endpoints, ORANGE=routes');

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