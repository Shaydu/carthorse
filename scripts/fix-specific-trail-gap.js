#!/usr/bin/env node

const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'trail_master_db',
  user: process.env.PGUSER || 'shaydu',
  password: process.env.PGPASSWORD || 'shaydu'
});

const STAGING_SCHEMA = 'carthorse_1754994218132';

async function fixSpecificTrailGap() {
  try {
    await client.connect();
    console.log('🔧 Fixing specific gap between trail endpoints...');

    // Start transaction
    await client.query('BEGIN');

    // Step 1: Get the current trail geometries by coordinates
    console.log('\n📊 Step 1: Analyzing current trail geometries...');
    
    const trailGeometries = await client.query(`
      SELECT 
        app_uuid,
        name,
        geometry,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_Length(geometry::geography) as length_meters
      FROM ${STAGING_SCHEMA}.trails 
      WHERE ST_DWithin(ST_EndPoint(geometry), ST_GeomFromText('POINT(-105.284509 39.979646)', 4326), 0.001)
         OR ST_DWithin(ST_StartPoint(geometry), ST_GeomFromText('POINT(-105.284692 39.979528)', 4326), 0.001)
      ORDER BY app_uuid
    `);

    const trail1 = trailGeometries.rows.find(t => 
      t.end_point.includes('-105.284509') && t.end_point.includes('39.979646')
    );
    const trail2 = trailGeometries.rows.find(t => 
      t.start_point.includes('-105.284692') && t.start_point.includes('39.979528')
    );

    const trail1Id = trail1.app_uuid;
    const trail2Id = trail2.app_uuid;

    console.log(`Trail 1: ${trail1.name} - Length: ${trail1.length_meters.toFixed(2)}m`);
    console.log(`  Start: ${trail1.start_point}`);
    console.log(`  End: ${trail1.end_point}`);
    
    console.log(`Trail 2: ${trail2.name} - Length: ${trail2.length_meters.toFixed(2)}m`);
    console.log(`  Start: ${trail2.start_point}`);
    console.log(`  End: ${trail2.end_point}`);

    // Step 2: Create a connector line from Trail 2's start to Trail 1's end
    console.log('\n🔗 Step 2: Creating connector geometry...');
    
    const connectorGeometry = await client.query(`
      SELECT 
        ST_MakeLine(
          ST_StartPoint($1::geometry),
          ST_EndPoint($2::geometry)
        ) as connector_geom,
        ST_Length(
          ST_MakeLine(
            ST_StartPoint($1::geometry),
            ST_EndPoint($2::geometry)
          )::geography
        ) as connector_length
    `, [trail2.geometry, trail1.geometry]);

    const connector = connectorGeometry.rows[0];
    console.log(`Connector length: ${connector.connector_length.toFixed(2)}m`);

    // Step 3: Extend Trail 2 by prepending the connector
    console.log('\n🔗 Step 3: Extending Trail 2 to meet Trail 1...');
    
    const extendedTrail2 = await client.query(`
      SELECT 
        ST_LineMerge(
          ST_Union(
            $1::geometry,
            $2::geometry
          )
        ) as extended_geom,
        ST_Length(
          ST_LineMerge(
            ST_Union(
              $1::geometry,
              $2::geometry
            )
          )::geography
        ) as extended_length
    `, [connector.connector_geom, trail2.geometry]);

    const extended = extendedTrail2.rows[0];
    console.log(`Extended Trail 2 length: ${extended.extended_length.toFixed(2)}m`);
    console.log(`Length increase: ${(extended.extended_length - trail2.length_meters).toFixed(2)}m`);

    // Step 4: Update Trail 2's geometry in the trails table
    console.log('\n📝 Step 4: Updating Trail 2 geometry...');
    
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.trails 
      SET 
        geometry = $1::geometry,
        length_km = ST_Length($1::geometry::geography) / 1000.0,
        updated_at = NOW()
      WHERE app_uuid = $2
    `, [extended.extended_geom, trail2Id]);

    console.log('✅ Trail 2 geometry updated');

    // Step 5: Update the routing edge for Trail 2
    console.log('\n🔗 Step 5: Updating routing edge...');
    
    // First, get the current edge details
    const currentEdge = await client.query(`
      SELECT 
        id,
        source,
        target,
        the_geom,
        length_km
      FROM ${STAGING_SCHEMA}.ways_noded
      WHERE app_uuid = $1
    `, [trail2Id]);

    if (currentEdge.rows.length > 0) {
      const edge = currentEdge.rows[0];
      
      // Update the edge geometry
      await client.query(`
        UPDATE ${STAGING_SCHEMA}.ways_noded
        SET 
          the_geom = ST_Force2D($1::geometry),
          length_km = ST_Length(ST_Force2D($1::geometry)::geography) / 1000.0
        WHERE id = $2
      `, [extended.extended_geom, edge.id]);
      
      console.log(`✅ Routing edge ${edge.id} updated`);
    }

    // Step 6: Recompute vertex degrees
    console.log('\n🔄 Step 6: Recomputing vertex degrees...');
    await client.query(`
      UPDATE ${STAGING_SCHEMA}.ways_noded_vertices_pgr v
      SET cnt = (
        SELECT COUNT(*) FROM ${STAGING_SCHEMA}.ways_noded e
        WHERE e.source = v.id OR e.target = v.id
      )
    `);

    // Step 7: Check if the trails now connect
    console.log('\n🔍 Step 7: Verifying connection...');
    
    const connectionCheck = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid,
          ST_StartPoint(geometry) as start_pt,
          ST_EndPoint(geometry) as end_pt
        FROM ${STAGING_SCHEMA}.trails 
        WHERE app_uuid IN ($1, $2)
      )
      SELECT 
        ST_Distance(t1.end_pt, t2.start_pt) as gap_distance
      FROM trail_endpoints t1, trail_endpoints t2
      WHERE t1.app_uuid = $1 AND t2.app_uuid = $2
    `, [trail1Id, trail2Id]);

    const gapDistance = connectionCheck.rows[0].gap_distance;
    console.log(`Final gap distance: ${gapDistance.toFixed(6)}m`);
    
    if (gapDistance < 0.001) {
      console.log('✅ Trails are now connected!');
    } else {
      console.log(`⚠️ Small gap remains: ${gapDistance.toFixed(6)}m`);
    }

    // Commit transaction
    await client.query('COMMIT');

    // Step 8: Final statistics
    console.log('\n📊 Final Statistics:');
    
    const finalStats = await client.query(`
      SELECT 
        app_uuid,
        name,
        ST_Length(geometry::geography) as length_meters,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point
      FROM ${STAGING_SCHEMA}.trails 
      WHERE app_uuid IN ($1, $2)
      ORDER BY app_uuid
    `, [trail1Id, trail2Id]);

    finalStats.rows.forEach(trail => {
      console.log(`\n${trail.name} (${trail.app_uuid}):`);
      console.log(`  Length: ${trail.length_meters.toFixed(2)}m`);
      console.log(`  Start: ${trail.start_point}`);
      console.log(`  End: ${trail.end_point}`);
    });

    console.log('\n✅ Specific trail gap fix completed!');

  } catch (error) {
    console.error('❌ Error fixing specific trail gap:', error);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

fixSpecificTrailGap();
