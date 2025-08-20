#!/usr/bin/env node

import { Client } from 'pg';

async function fixOutAndBackGeometries() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'trail_master_db',
    user: 'carthorse',
    password: 'carthorse'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Get the most recent staging schema
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'carthorse_%' 
      ORDER BY schema_name DESC 
      LIMIT 1
    `);

    if (schemaResult.rows.length === 0) {
      console.error('❌ No staging schema found');
      return;
    }

    const stagingSchema = schemaResult.rows[0].schema_name;
    console.log(`📋 Using staging schema: ${stagingSchema}`);

    // Get all out-and-back routes without geometry
    const routesResult = await client.query(`
      SELECT route_uuid, route_edges, input_length_km
      FROM ${stagingSchema}.route_recommendations 
      WHERE route_type = 'out-and-back' 
      AND route_geometry IS NULL
      ORDER BY created_at DESC
    `);

    console.log(`🔍 Found ${routesResult.rows.length} out-and-back routes without geometry`);

    let fixedCount = 0;
    let errorCount = 0;

    for (const route of routesResult.rows) {
      try {
        const edgeIds = route.route_edges;
        const targetDistance = route.input_length_km || 10.0; // Default to 10km if not specified

        if (!edgeIds || edgeIds.length === 0) {
          console.log(`⚠️ Route ${route.route_uuid} has no edge IDs, skipping`);
          continue;
        }

        // Generate geometry using the same logic as the service
        const geometryResult = await client.query(`
          WITH path(edge_id, ord) AS (
            SELECT edge_id::bigint, ord::int
            FROM unnest($1::bigint[]) WITH ORDINALITY AS u(edge_id, ord)
          ),
          ordered_edges AS (
            SELECT w.the_geom, w.length_km, p.ord
            FROM path p
            JOIN ${stagingSchema}.ways_noded w ON w.id = p.edge_id
            WHERE w.the_geom IS NOT NULL AND ST_IsValid(w.the_geom)
            ORDER BY p.ord
          ),
          cumulative_distances AS (
            SELECT 
              the_geom,
              length_km,
              ord,
              SUM(length_km) OVER (ORDER BY ord) AS cumulative_km
            FROM ordered_edges
          ),
          midpoint_edges AS (
            SELECT the_geom, length_km, ord
            FROM cumulative_distances
            WHERE cumulative_km <= $2
          ),
          outbound_to_midpoint AS (
            SELECT ST_LineMerge(ST_Collect(the_geom ORDER BY ord)) AS outbound_geom
            FROM midpoint_edges
          ),
          complete_route AS (
            SELECT ST_Force3D(
              ST_LineMerge(
                ST_Collect(
                  o.outbound_geom,
                  ST_Reverse(o.outbound_geom)
                )
              )
            ) AS route_geometry
            FROM outbound_to_midpoint o
            WHERE o.outbound_geom IS NOT NULL AND NOT ST_IsEmpty(o.outbound_geom)
          )
          SELECT route_geometry FROM complete_route
          WHERE route_geometry IS NOT NULL AND NOT ST_IsEmpty(route_geometry) AND ST_IsValid(route_geometry)
        `, [edgeIds, targetDistance / 2]);

        if (geometryResult.rows.length > 0 && geometryResult.rows[0].route_geometry) {
          // Update the route with the generated geometry
          await client.query(`
            UPDATE ${stagingSchema}.route_recommendations 
            SET route_geometry = $1
            WHERE route_uuid = $2
          `, [geometryResult.rows[0].route_geometry, route.route_uuid]);

          fixedCount++;
          if (fixedCount % 10 === 0) {
            console.log(`✅ Fixed ${fixedCount} routes so far...`);
          }
        } else {
          console.log(`⚠️ Could not generate geometry for route ${route.route_uuid}`);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error fixing route ${route.route_uuid}:`, error);
        errorCount++;
      }
    }

    console.log(`\n🎉 Geometry fix complete!`);
    console.log(`✅ Fixed: ${fixedCount} routes`);
    console.log(`❌ Errors: ${errorCount} routes`);

    // Also update the export_routes table
    console.log(`\n🔄 Updating export_routes table...`);
    await client.query(`
      UPDATE ${stagingSchema}.export_routes 
      SET route_geometry = rr.route_geometry
      FROM ${stagingSchema}.route_recommendations rr
      WHERE ${stagingSchema}.export_routes.route_uuid = rr.route_uuid
      AND rr.route_geometry IS NOT NULL
    `);

    console.log(`✅ Export routes table updated`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

fixOutAndBackGeometries().catch(console.error);

