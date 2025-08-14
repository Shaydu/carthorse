#!/usr/bin/env ts-node

import { Pool } from 'pg';
import { getDatabaseConfig } from '../src/utils/config-loader';

async function debugGeometryMismatch() {
  const dbConfig = getDatabaseConfig();
  const pgClient = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    statement_timeout: 30000, // 30 second timeout
    query_timeout: 30000,     // 30 second timeout
  });

  try {
    await pgClient.connect();
    console.log('🔍 Connected to database, analyzing geometry issues...');

    // Find the most recent staging schema
    const schemaResult = await pgClient.query(`
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
    console.log(`📊 Using staging schema: ${stagingSchema}`);

    // Check for trails with problematic geometries
    console.log('\n🔍 Analyzing trail geometries...');
    const trailGeometryIssues = await pgClient.query(`
      SELECT 
        id,
        name,
        app_uuid,
        ST_GeometryType(geometry) as geometry_type,
        ST_NumGeometries(geometry) as num_geometries,
        ST_IsValid(geometry) as is_valid,
        ST_IsSimple(geometry) as is_simple,
        ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails
      WHERE geometry IS NOT NULL
        AND (
          ST_GeometryType(geometry) != 'ST_LineString'
          OR NOT ST_IsValid(geometry)
          OR NOT ST_IsSimple(geometry)
          OR ST_NumGeometries(geometry) > 1
        )
      ORDER BY length_meters DESC
    `);

    console.log(`\n📊 Found ${trailGeometryIssues.rows.length} trails with geometry issues:`);
    trailGeometryIssues.rows.forEach((row, index) => {
      console.log(`${index + 1}. Trail ID: ${row.id}, Name: "${row.name}", Type: ${row.geometry_type}, Valid: ${row.is_valid}, Simple: ${row.is_simple}, Length: ${row.length_meters?.toFixed(1)}m`);
    });

    // Check ways_noded table for problematic edges
    console.log('\n🔍 Analyzing ways_noded edges...');
    const edgeGeometryIssues = await pgClient.query(`
      SELECT 
        id,
        old_id,
        name,
        app_uuid,
        ST_GeometryType(the_geom) as geometry_type,
        ST_NumGeometries(the_geom) as num_geometries,
        ST_IsValid(the_geom) as is_valid,
        ST_IsSimple(the_geom) as is_simple,
        ST_Length(the_geom::geography) as length_meters,
        source,
        target
      FROM ${stagingSchema}.ways_noded
      WHERE the_geom IS NOT NULL
        AND (
          ST_GeometryType(the_geom) != 'ST_LineString'
          OR NOT ST_IsValid(the_geom)
          OR NOT ST_IsSimple(the_geom)
          OR ST_NumGeometries(the_geom) > 1
        )
      ORDER BY length_meters DESC
    `);

    console.log(`\n📊 Found ${edgeGeometryIssues.rows.length} edges with geometry issues:`);
    edgeGeometryIssues.rows.forEach((row, index) => {
      console.log(`${index + 1}. Edge ID: ${row.id}, Trail ID: ${row.old_id}, Name: "${row.name}", Type: ${row.geometry_type}, Valid: ${row.is_valid}, Simple: ${row.is_simple}, Length: ${row.length_meters?.toFixed(1)}m, Source: ${row.source}, Target: ${row.target}`);
    });

    // Check for degree-2 chains that might cause issues
    console.log('\n🔍 Analyzing degree-2 chains...');
    const degree2Chains = await pgClient.query(`
      WITH deg AS (
        SELECT id, cnt FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      simple_chains AS (
        SELECT 
          e1.id as edge1_id,
          e2.id as edge2_id,
          e1.name as name1,
          e2.name as name2,
          e1.old_id as trail1_id,
          e2.old_id as trail2_id,
          ST_GeometryType(e1.the_geom) as geom1_type,
          ST_GeometryType(e2.the_geom) as geom2_type,
          ST_IsValid(e1.the_geom) as geom1_valid,
          ST_IsValid(e2.the_geom) as geom2_valid,
          ST_Length(e1.the_geom::geography) as length1_m,
          ST_Length(e2.the_geom::geography) as length2_m
        FROM ${stagingSchema}.ways_noded e1
        JOIN ${stagingSchema}.ways_noded e2 ON (
          e1.target = e2.source
        )
        JOIN deg d ON d.id = e1.target
        WHERE d.cnt = 2 
          AND e1.id < e2.id
      )
      SELECT * FROM simple_chains
      WHERE geom1_type != 'ST_LineString' 
         OR geom2_type != 'ST_LineString'
         OR NOT geom1_valid 
         OR NOT geom2_valid
      ORDER BY length1_m + length2_m DESC
    `);

    console.log(`\n📊 Found ${degree2Chains.rows.length} degree-2 chains with geometry issues:`);
    degree2Chains.rows.forEach((row, index) => {
      console.log(`${index + 1}. Edge1: ${row.edge1_id} (Trail: ${row.trail1_id}, "${row.name1}", Type: ${row.geom1_type}, Valid: ${row.geom1_valid}, Length: ${row.length1_m?.toFixed(1)}m)`);
      console.log(`   Edge2: ${row.edge2_id} (Trail: ${row.trail2_id}, "${row.name2}", Type: ${row.geom2_type}, Valid: ${row.geom2_valid}, Length: ${row.length2_m?.toFixed(1)}m)`);
    });

    // Test the problematic union operation (limited to prevent hanging)
    console.log('\n🔍 Testing problematic union operations...');
    const unionTest = await pgClient.query(`
      WITH deg AS (
        SELECT id, cnt FROM ${stagingSchema}.ways_noded_vertices_pgr
      ),
      simple_chains AS (
        SELECT 
          e1.id as edge1_id,
          e2.id as edge2_id,
          e1.the_geom as geom1,
          e2.the_geom as geom2,
          e1.name as name1,
          e2.name as name2,
          e1.old_id as trail1_id,
          e2.old_id as trail2_id
        FROM ${stagingSchema}.ways_noded e1
        JOIN ${stagingSchema}.ways_noded e2 ON (
          e1.target = e2.source
        )
        JOIN deg d ON d.id = e1.target
        WHERE d.cnt = 2 
          AND e1.id < e2.id
        LIMIT 5
      ),
      union_results AS (
        SELECT 
          edge1_id,
          edge2_id,
          name1,
          name2,
          trail1_id,
          trail2_id,
          ST_GeometryType(geom1) as geom1_type,
          ST_GeometryType(geom2) as geom2_type,
          ST_GeometryType(ST_Union(ST_SnapToGrid(geom1, 1e-7), ST_SnapToGrid(geom2, 1e-7))) as union_type,
          ST_GeometryType(ST_LineMerge(ST_Union(ST_SnapToGrid(geom1, 1e-7), ST_SnapToGrid(geom2, 1e-7)))) as merged_type,
          ST_IsValid(ST_Union(ST_SnapToGrid(geom1, 1e-7), ST_SnapToGrid(geom2, 1e-7))) as union_valid,
          ST_IsValid(ST_LineMerge(ST_Union(ST_SnapToGrid(geom1, 1e-7), ST_SnapToGrid(geom2, 1e-7)))) as merged_valid
        FROM simple_chains
      )
      SELECT * FROM union_results
      WHERE union_type != 'ST_LineString' 
         OR merged_type != 'ST_LineString'
         OR NOT union_valid 
         OR NOT merged_valid
      ORDER BY edge1_id, edge2_id
      LIMIT 10
    `);

    console.log(`\n📊 Found ${unionTest.rows.length} problematic union operations:`);
    unionTest.rows.forEach((row, index) => {
      console.log(`${index + 1}. Edges: ${row.edge1_id} + ${row.edge2_id}`);
      console.log(`   Trails: ${row.trail1_id} ("${row.name1}") + ${row.trail2_id} ("${row.name2}")`);
      console.log(`   Geom1 Type: ${row.geom1_type}, Geom2 Type: ${row.geom2_type}`);
      console.log(`   Union Type: ${row.union_type}, Merged Type: ${row.merged_type}`);
      console.log(`   Union Valid: ${row.union_valid}, Merged Valid: ${row.merged_valid}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  debugGeometryMismatch().catch(console.error);
}
