import { Pool } from 'pg';
import { createLoopSplittingHelpers } from '../src/utils/loop-splitting-helpers';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trail_master_db',
  user: process.env.DB_USER || 'carthorse',
  password: process.env.DB_PASSWORD || 'carthorse'
});

async function analyzeSegmentOverlap() {
  const stagingSchema = `overlap_test_${Date.now()}`;
  const client = await pool.connect();
  
  try {
    console.log(`🔍 Analyzing segment overlap for Hogback Ridge in ${stagingSchema}...`);
    
    // Create test schema
    await client.query(`CREATE SCHEMA ${stagingSchema}`);
    
    // Create trails table
    await client.query(`
      CREATE TABLE ${stagingSchema}.trails (
        id SERIAL PRIMARY KEY,
        app_uuid TEXT UNIQUE NOT NULL,
        original_trail_uuid TEXT,
        osm_id TEXT,
        name TEXT NOT NULL,
        region TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        source_tags JSONB,
        bbox_min_lng DOUBLE PRECISION,
        bbox_max_lng DOUBLE PRECISION,
        bbox_min_lat DOUBLE PRECISION,
        bbox_max_lat DOUBLE PRECISION,
        length_km DOUBLE PRECISION,
        elevation_gain DOUBLE PRECISION,
        elevation_loss DOUBLE PRECISION,
        max_elevation DOUBLE PRECISION,
        min_elevation DOUBLE PRECISION,
        avg_elevation DOUBLE PRECISION,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        geometry GEOMETRY(LINESTRINGZ, 4326)
      )
    `);
    
    // Copy real Hogback Ridge trail from public.trails
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, geometry
      )
      SELECT 
        app_uuid, osm_id, name, region, trail_type, surface, difficulty, source_tags,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat, length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        source, geometry
      FROM public.trails 
      WHERE name ILIKE '%hogback ridge%'
      LIMIT 1
    `);
    
    // Store the original geometry before splitting
    const originalTrail = await client.query(`
      SELECT app_uuid, name, geometry, ST_Length(geometry::geography) as length_meters
      FROM ${stagingSchema}.trails 
      WHERE name ILIKE '%hogback%'
    `);
    
    const originalUuid = originalTrail.rows[0].app_uuid;
    const originalLength = parseFloat(originalTrail.rows[0].length_meters);
    
    console.log(`📏 Original trail: ${originalUuid}`);
    console.log(`📏 Original length: ${originalLength.toFixed(2)} meters`);
    
    // Add intersecting trail
    await client.query(`
      INSERT INTO ${stagingSchema}.trails (
        app_uuid, name, geometry, length_km, region
      ) VALUES (
        'intersecting-trail-001',
        'Test Intersecting Trail',
        ST_GeomFromText('LINESTRING Z (-105.295 40.069 1750, -105.295 40.070 1800, -105.300 40.075 1850)', 4326),
        2.0,
        'boulder'
      )
    `);
    
    // Store original geometry in a temp table for comparison
    await client.query(`
      CREATE TEMP TABLE original_hogback AS
      SELECT geometry as original_geometry FROM ${stagingSchema}.trails 
      WHERE app_uuid = $1
    `, [originalUuid]);
    
    // Run loop splitting
    const loopSplittingHelpers = createLoopSplittingHelpers(stagingSchema, pool);
    const result = await loopSplittingHelpers.splitLoopTrails();
    
    if (result.success) {
      console.log('✅ Loop splitting completed successfully');
      
      // Analyze the split segments
      const segments = await client.query(`
        SELECT app_uuid, name, original_trail_uuid, 
               ST_Length(geometry::geography) as length_meters,
               ST_AsText(ST_StartPoint(geometry)) as start_point,
               ST_AsText(ST_EndPoint(geometry)) as end_point
        FROM ${stagingSchema}.trails 
        WHERE name ILIKE '%hogback%' AND name ILIKE '%segment%'
        ORDER BY name, app_uuid
      `);
      
      console.log(`\n📊 Found ${segments.rows.length} split segments:`);
      
      let totalSegmentLength = 0;
      segments.rows.forEach((segment, index) => {
        const length = parseFloat(segment.length_meters);
        totalSegmentLength += length;
        console.log(`  ${index + 1}. ${segment.name}`);
        console.log(`     UUID: ${segment.app_uuid}`);
        console.log(`     Length: ${length.toFixed(2)} meters`);
        console.log(`     Start: ${segment.start_point}`);
        console.log(`     End: ${segment.end_point}`);
      });
      
      console.log(`\n📏 Length comparison:`);
      console.log(`   Original: ${originalLength.toFixed(2)} meters`);
      console.log(`   Segments total: ${totalSegmentLength.toFixed(2)} meters`);
      console.log(`   Difference: ${Math.abs(originalLength - totalSegmentLength).toFixed(2)} meters`);
      
      if (Math.abs(originalLength - totalSegmentLength) < 10) {
        console.log(`✅ Lengths match - segments are non-overlapping subsets`);
      } else {
        console.log(`❌ Lengths don't match - segments may overlap or miss parts`);
      }
      
      // Check for overlaps between segments
      console.log(`\n🔍 Checking for overlaps between segments:`);
      
      for (let i = 0; i < segments.rows.length; i++) {
        for (let j = i + 1; j < segments.rows.length; j++) {
          const seg1 = segments.rows[i];
          const seg2 = segments.rows[j];
          
          const overlapCheck = await client.query(`
            SELECT 
              ST_Intersects(s1.geometry, s2.geometry) as intersects,
              ST_Length(ST_Intersection(s1.geometry, s2.geometry)::geography) as overlap_length
            FROM 
              (SELECT geometry FROM ${stagingSchema}.trails WHERE app_uuid = $1) s1,
              (SELECT geometry FROM ${stagingSchema}.trails WHERE app_uuid = $2) s2
          `, [seg1.app_uuid, seg2.app_uuid]);
          
          const intersects = overlapCheck.rows[0].intersects;
          const overlapLength = parseFloat(overlapCheck.rows[0].overlap_length || 0);
          
          console.log(`   ${seg1.name} vs ${seg2.name}:`);
          console.log(`     Intersects: ${intersects}`);
          console.log(`     Overlap length: ${overlapLength.toFixed(2)} meters`);
          
          if (overlapLength > 1) {
            console.log(`     ⚠️  Significant overlap detected!`);
          } else {
            console.log(`     ✅ No significant overlap`);
          }
        }
      }
      
      // Check if segments together recreate the original
      console.log(`\n🔍 Checking if segments cover the original trail:`);
      
      const coverageCheck = await client.query(`
        WITH segment_union AS (
          SELECT ST_Union(geometry) as combined_geometry
          FROM ${stagingSchema}.trails 
          WHERE name ILIKE '%hogback%' AND name ILIKE '%segment%'
        )
        SELECT 
          ST_Length(ST_Intersection(og.original_geometry, su.combined_geometry)::geography) as covered_length,
          ST_Length(og.original_geometry::geography) as original_length
        FROM original_hogback og, segment_union su
      `);
      
      const coveredLength = parseFloat(coverageCheck.rows[0].covered_length);
      const origLength = parseFloat(coverageCheck.rows[0].original_length);
      const coveragePercent = (coveredLength / origLength) * 100;
      
      console.log(`   Coverage: ${coveragePercent.toFixed(1)}% of original trail`);
      console.log(`   Covered: ${coveredLength.toFixed(2)} meters`);
      console.log(`   Original: ${origLength.toFixed(2)} meters`);
      
      if (coveragePercent > 95) {
        console.log(`   ✅ Segments adequately cover the original trail`);
      } else {
        console.log(`   ❌ Segments do not adequately cover the original trail`);
      }
      
    } else {
      console.error('❌ Loop splitting failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    // Clean up test schema
    await client.query(`DROP SCHEMA IF EXISTS ${stagingSchema} CASCADE`);
    client.release();
    await pool.end();
  }
}

analyzeSegmentOverlap();
