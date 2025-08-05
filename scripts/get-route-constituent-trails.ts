import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'trail_master_db',
  user: 'shaydu',
  password: 'password'
});

async function getRouteConstituentTrails() {
  try {
    // Get latest routes from public schema (10 of each type)
    const routesResult = await pool.query(`
      WITH latest_routes AS (
        SELECT 
          route_uuid, route_name, input_distance_km, input_elevation_gain,
          recommended_distance_km, recommended_elevation_gain, route_edges,
          created_at,
          ROW_NUMBER() OVER (PARTITION BY route_name ORDER BY created_at DESC) as rn
        FROM public.route_recommendations
        WHERE route_edges IS NOT NULL
      )
      SELECT 
        route_uuid, route_name, input_distance_km, input_elevation_gain,
        recommended_distance_km, recommended_elevation_gain, route_edges
      FROM latest_routes
      WHERE rn <= 10
      ORDER BY route_name, created_at DESC
    `);

    console.log(`Found ${routesResult.rows.length} routes to analyze`);

    const allTrailData: any[] = [];

    for (const routeInfo of routesResult.rows) {
      console.log(`\n🏃 ROUTE: ${routeInfo.route_name}`);
      console.log(`   Target: ${routeInfo.input_distance_km}km, ${routeInfo.input_elevation_gain}m`);
      console.log(`   Actual: ${routeInfo.recommended_distance_km}km, ${routeInfo.recommended_elevation_gain}m`);

      const routeEdges = typeof routeInfo.route_edges === 'string' 
        ? JSON.parse(routeInfo.route_edges) 
        : routeInfo.route_edges;
      const edgeIds = routeEdges
        .map((edge: any) => parseInt(edge.id))
        .filter((id: number) => !isNaN(id) && id > 0);

      console.log(`   Uses: ${edgeIds.length} edges`);

      if (edgeIds.length === 0) {
        console.log(`   ⚠️  No valid edge IDs found`);
        continue;
      }

      // Get app_uuid from staging schema's edge_mapping table
      const stagingSchema = 'ksp_routes_1754354162722'; // Most recent ksp_routes schema
      
      const edgesResult = await pool.query(`
        SELECT DISTINCT em.pg_id, em.app_uuid, em.trail_name
        FROM ${stagingSchema}.edge_mapping em
        WHERE em.pg_id = ANY($1::integer[])
      `, [edgeIds]);

      const appUuids = edgesResult.rows.map(row => row.app_uuid).filter(uuid => uuid);

      console.log(`   Found ${appUuids.length} unique app_uuids`);

      if (appUuids.length === 0) {
        console.log(`   ⚠️  No app_uuids found for edges`);
        continue;
      }

      // Get trail metadata from public.trails using app_uuids
      const trailsResult = await pool.query(`
        SELECT app_uuid, name, length_km, elevation_gain, trail_type, surface, difficulty
        FROM public.trails
        WHERE app_uuid = ANY($1::uuid[])
        ORDER BY name
      `, [appUuids]);

      const trails = trailsResult.rows;
      const uniqueTrailCount = trails.length;

      console.log(`   Constituent trails: ${uniqueTrailCount} unique trails`);

      let totalTrailDistance = 0;
      let totalTrailElevation = 0;

      console.log(`   Constituent trails:`);
      trails.forEach((trail, index) => {
        const distance = trail.length_km || 0;
        const elevation = trail.elevation_gain || 0;
        totalTrailDistance += distance;
        totalTrailElevation += elevation;

        console.log(`      ${index + 1}. ${trail.name}`);
        console.log(`         Distance: ${distance.toFixed(2)}km`);
        console.log(`         Elevation Gain: ${elevation.toFixed(0)}m`);
        console.log(`         Type: ${trail.trail_type || 'N/A'}`);
        console.log(`         Surface: ${trail.surface || 'N/A'}`);
        console.log(`         Difficulty: ${trail.difficulty || 'N/A'}`);
      });

      const outAndBackDistance = totalTrailDistance * 2;
      const outAndBackElevation = totalTrailElevation * 2;

      console.log(`   One-way trail total: ${totalTrailDistance.toFixed(2)}km, ${totalTrailElevation.toFixed(0)}m`);
      console.log(`   Out-and-back total: ${outAndBackDistance.toFixed(2)}km, ${outAndBackElevation.toFixed(0)}m`);

      allTrailData.push({
        route_uuid: routeInfo.route_uuid,
        route_name: routeInfo.route_name,
        target_distance_km: routeInfo.input_distance_km,
        target_elevation_gain: routeInfo.input_elevation_gain,
        actual_distance_km: routeInfo.recommended_distance_km,
        actual_elevation_gain: routeInfo.recommended_elevation_gain,
        edge_count: edgeIds.length,
        unique_trail_count: uniqueTrailCount,
        one_way_distance_km: totalTrailDistance,
        one_way_elevation_m: totalTrailElevation,
        out_and_back_distance_km: outAndBackDistance,
        out_and_back_elevation_m: outAndBackElevation,
        constituent_trails: trails
      });
    }

    // Write detailed data to JSON file
    const outputPath = path.join(__dirname, '../test-output/route-constituent-trails.json');
    fs.writeFileSync(outputPath, JSON.stringify(allTrailData, null, 2));
    console.log(`\n📄 Detailed data written to: ${outputPath}`);

    // Summary
    console.log(`\n📊 SUMMARY:`);
    console.log(`Total routes analyzed: ${allTrailData.length}`);
    const avgTrailsPerRoute = allTrailData.reduce((sum, route) => sum + route.unique_trail_count, 0) / allTrailData.length;
    console.log(`Average trails per route: ${avgTrailsPerRoute.toFixed(1)}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

getRouteConstituentTrails();