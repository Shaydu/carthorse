#!/usr/bin/env node

import { Client } from 'pg';

async function fixExistingOutAndBackGeometries() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    await client.connect();
    console.log('🔗 Connected to database');

    // Get the most recent carthorse schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);
    
    if (schemaResult.rows.length === 0) {
      console.error('❌ No carthorse schema found');
      return;
    }
    
    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using schema: ${stagingSchema}`);

    // Get out-and-back routes without geometry
    const routesResult = await client.query(`
      SELECT route_uuid, route_edges, recommended_length_km
      FROM ${stagingSchema}.route_recommendations 
      WHERE route_type = 'out-and-back' 
      AND route_geometry IS NULL
    `);

    console.log(`🔍 Found ${routesResult.rows.length} out-and-back routes without geometry`);

    if (routesResult.rows.length === 0) {
      console.log('✅ All out-and-back routes already have geometry');
      return;
    }

    let updatedCount = 0;
    let errorCount = 0;

    for (const route of routesResult.rows) {
      try {
        const routeEdges = JSON.parse(route.route_edges);
        const targetDistanceKm = route.recommended_length_km || 10.0;

        console.log(`🔧 Processing route ${route.route_uuid} with ${routeEdges.length} edges`);

        // Use the same simple geometry generation as loops
        const geometryResult = await client.query(`
          SELECT 
            ST_AsGeoJSON(ST_Union(w.geometry)) as route_geometry,
            ST_Length(ST_Union(w.geometry)) as route_length
          FROM ${stagingSchema}.ways_noded w
          WHERE w.id = ANY($1::integer[])
        `, [routeEdges]);

        if (geometryResult.rows.length > 0 && geometryResult.rows[0].route_geometry) {
          // Update the route with the new geometry
          await client.query(`
            UPDATE ${stagingSchema}.route_recommendations 
            SET route_geometry = ST_GeomFromGeoJSON($1)
            WHERE route_uuid = $2
          `, [geometryResult.rows[0].route_geometry, route.route_uuid]);

          // Also update export_routes table
          await client.query(`
            UPDATE ${stagingSchema}.export_routes 
            SET route_geometry = ST_GeomFromGeoJSON($1)
            WHERE route_uuid = $2
          `, [geometryResult.rows[0].route_geometry, route.route_uuid]);

          updatedCount++;
          console.log(`✅ Updated route ${route.route_uuid}`);
        } else {
          console.log(`⚠️  No geometry generated for route ${route.route_uuid}`);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error processing route ${route.route_uuid}:`, error);
        errorCount++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`✅ Successfully updated: ${updatedCount} routes`);
    console.log(`❌ Errors: ${errorCount} routes`);

    // Verify the results
    const verifyResult = await client.query(`
      SELECT route_type, COUNT(*) as count, COUNT(route_geometry) as with_geometry 
      FROM ${stagingSchema}.route_recommendations 
      WHERE route_type = 'out-and-back'
      GROUP BY route_type
    `);

    console.log(`\n🔍 Verification:`);
    console.log(`Out-and-back routes: ${verifyResult.rows[0]?.count || 0} total, ${verifyResult.rows[0]?.with_geometry || 0} with geometry`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

fixExistingOutAndBackGeometries().catch(console.error);

