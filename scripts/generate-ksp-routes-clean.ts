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
    // Step 1: Load route patterns
    console.log('📋 Loading route patterns...');
    const patternsResult = await pool.query(`
      SELECT * FROM public.route_patterns 
      WHERE route_shape = 'out-and-back'
      ORDER BY target_distance_km
    `);
    
    const patterns: RoutePattern[] = patternsResult.rows;
    console.log(`✅ Loaded ${patterns.length} out-and-back route patterns`);

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
      AND ST_Intersects(geometry, ST_MakeEnvelope(-105.35184737563483, 40.10010564946518, -105.31343938074664, 40.1281541323425, 4326))
    `;
    console.log('🗺️ Using specific bbox filter...');
    
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

    // Step 7: Generate out-and-back routes using the helper
    const allRecommendations: RouteRecommendation[] = [];
    const routeGenerator = new KspRouteGenerator(pool, stagingSchema);
    
    for (const pattern of patterns) {
      const patternRoutes = await routeGenerator.generateOutAndBackRoutes(pattern, 5);
      allRecommendations.push(...patternRoutes);
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
    const sampleRoutes = allRecommendations.slice(0, 15); // Show top 15 routes
    
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
          
          // Extract edge IDs from the route edges
          const edgeIds = routeEdges.map((edge: any) => edge.id).filter((id: number) => id !== null && id !== undefined);
          
          if (edgeIds.length === 0) {
            console.log(`⚠️ No valid edge IDs found for route: ${route.route_name}`);
            return null;
          }
          
          // Get the actual coordinates for this route's edges
          const routeCoordinates = await pool.query(`
            SELECT ST_AsGeoJSON(the_geom) as geojson
            FROM ${stagingSchema}.ways_noded 
            WHERE id = ANY($1::integer[])
            ORDER BY id
          `, [edgeIds]);
          
          // Extract coordinates from the GeoJSON and flatten them
          const coordinates = routeCoordinates.rows.map(row => {
            try {
              const geojson = JSON.parse(row.geojson);
              return geojson.coordinates;
            } catch (error) {
              console.log(`⚠️ Failed to parse GeoJSON for route: ${route.route_name}`, error);
              return [];
            }
          }).flat();
          
          if (coordinates.length === 0) {
            console.log(`⚠️ No coordinates found for route: ${route.route_name}`);
            return null;
          }
          
          return {
            type: 'Feature',
            properties: {
              layer: 'routes',
              color: '#FFA500',
              stroke: '#FFA500',
              'stroke-width': 4,
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