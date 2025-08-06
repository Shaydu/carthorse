import { Pool } from 'pg';

export interface TrailSplitterConfig {
  minTrailLengthMeters: number;
  verbose?: boolean; // Enable verbose logging
}

export interface TrailSplitResult {
  iterations: number;
  finalSegmentCount: number;
  intersectionCount: number;
}

export class TrailSplitter {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config: TrailSplitterConfig
  ) {}

  /**
   * Perform comprehensive trail splitting at intersections
   */
  async splitTrails(sourceQuery: string, params: any[]): Promise<TrailSplitResult> {
    console.log('🔍 DEBUG: Starting comprehensive trail splitting...');
    
    if (this.config.verbose) {
      console.log(`📊 Trail splitting configuration:`);
      console.log(`   - Minimum trail length: ${this.config.minTrailLengthMeters}m`);
      console.log(`   - Staging schema: ${this.stagingSchema}`);
      console.log(`   - Source query: ${sourceQuery}`);
      
      // Show sample of trails being processed
      const sampleTrails = await this.pgClient.query(`
        SELECT name, ST_Length(geometry::geography) as length_m, 
               ST_GeometryType(geometry) as geom_type
        FROM (${sourceQuery}) as source_trails
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        LIMIT 5
      `);
      
      console.log(`📋 Sample trails to be processed:`);
      sampleTrails.rows.forEach((trail, i) => {
        console.log(`   ${i + 1}. "${trail.name}" (${trail.length_m.toFixed(1)}m, ${trail.geom_type})`);
      });
    }
    
    // Step 1: Insert original trails into staging
    console.log('🔄 Step 1: Inserting original trails...');
        const insertOriginalSql = `
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry
      )
      SELECT
        app_uuid, name, region, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation, geometry
      FROM (${sourceQuery}) as source_trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `;
    
    const insertResult = await this.pgClient.query(insertOriginalSql);
    console.log(`✅ Inserted ${insertResult.rowCount} original trails`);
    
    if (this.config.verbose) {
      console.log(`📋 Original trails inserted into ${this.stagingSchema}.trails`);
    }
    
    // Step 1.5: Create spatial index for performance
    console.log('🔧 Creating spatial index for performance...');
    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_geometry 
      ON ${this.stagingSchema}.trails USING GIST (geometry)
    `);
    console.log('✅ Spatial index created');
    
    // Step 2: Perform comprehensive splitting using ST_Node()
    console.log('🔄 Step 2: Performing comprehensive trail splitting...');
    
    if (this.config.verbose) {
      console.log(`🔧 Using ST_Node() to split trails at intersection points...`);
      console.log(`🔧 Using ST_Dump() to extract individual segments...`);
      console.log(`🔧 Filtering segments shorter than ${this.config.minTrailLengthMeters}m...`);
      
      // OPTIMIZED: Use spatial index for intersection detection
      console.log('🔍 Detecting trails with intersections (optimized)...');
      const trailsWithIntersections = await this.pgClient.query(`
        WITH trail_bboxes AS (
          SELECT id, name, geometry, 
                 ST_Envelope(geometry) as bbox
          FROM ${this.stagingSchema}.trails
          WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
        ),
        intersection_pairs AS (
          SELECT DISTINCT t1.id, t1.name as trail_name,
                 COUNT(*) as intersection_count,
                 ST_Length(t1.geometry::geography) as length_m
          FROM trail_bboxes t1
          JOIN trail_bboxes t2 ON t1.id < t2.id
          WHERE ST_Intersects(t1.bbox, t2.bbox)  -- Use bbox first for performance
            AND ST_Intersects(t1.geometry, t2.geometry)  -- Then precise intersection
            AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          GROUP BY t1.id, t1.name, t1.geometry
        )
        SELECT trail_name, intersection_count, length_m
        FROM intersection_pairs
        ORDER BY intersection_count DESC
        LIMIT 10
      `);
      
      if (trailsWithIntersections.rows.length > 0) {
        console.log(`🔗 Trails with intersections (likely to be split):`);
        trailsWithIntersections.rows.forEach((trail, i) => {
          console.log(`   ${i + 1}. "${trail.trail_name}" (${trail.intersection_count} intersections, ${trail.length_m.toFixed(1)}m)`);
        });
      } else {
        console.log(`🔗 No trails with intersections detected`);
      }
    }
    
    const comprehensiveSplitSql = `
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, name, region, trail_type, surface, difficulty,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
        length_km, elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        geometry
      )
      SELECT
        gen_random_uuid() as app_uuid,
        name, region, trail_type, surface, difficulty,
        ST_XMin(dumped.geom) as bbox_min_lng, ST_XMax(dumped.geom) as bbox_max_lng,
        ST_YMin(dumped.geom) as bbox_min_lat, ST_YMax(dumped.geom) as bbox_max_lat,
        ST_Length(dumped.geom::geography) / 1000.0 as length_km,
        elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
        dumped.geom as geometry
      FROM ${this.stagingSchema}.trails t,
      LATERAL ST_Dump(ST_Node(t.geometry)) as dumped
      WHERE ST_IsValid(dumped.geom) 
        AND dumped.geom IS NOT NULL
        AND ST_Length(dumped.geom::geography) > $1
    `;
    
    const splitResult = await this.pgClient.query(comprehensiveSplitSql, [this.config.minTrailLengthMeters]);
    console.log(`✅ Comprehensive splitting complete: ${splitResult.rowCount} segments`);
    
    if (this.config.verbose) {
      const originalCount = insertResult.rowCount || 0;
      const splitCount = splitResult.rowCount || 0;
      console.log(`📊 Splitting statistics:`);
      console.log(`   - Original trails: ${originalCount}`);
      console.log(`   - Split segments: ${splitCount}`);
      console.log(`   - Additional segments: ${splitCount - originalCount}`);
      console.log(`   - Splitting ratio: ${originalCount > 0 ? (splitCount / originalCount).toFixed(2) : '0.00'}x`);
      
      // Show sample of created segments
      const sampleSegments = await this.pgClient.query(`
        SELECT name, ST_Length(geometry::geography) as length_m,
               ST_GeometryType(geometry) as geom_type,
               app_uuid
        FROM ${this.stagingSchema}.trails
        ORDER BY length_m DESC
        LIMIT 10
      `);
      
      if (sampleSegments.rows.length > 0) {
        console.log(`📋 Sample created segments:`);
        sampleSegments.rows.forEach((segment, i) => {
          console.log(`   ${i + 1}. "${segment.name}" (${segment.length_m.toFixed(1)}m, ${segment.geom_type})`);
        });
      }
    }
    
    // Step 3: Delete original trails (now that we have the split segments)
    console.log('🗑️ Deleting original trails...');
    const deleteOriginalSql = `DELETE FROM ${this.stagingSchema}.trails WHERE id IN (SELECT id FROM ${this.stagingSchema}.trails ORDER BY id LIMIT ${insertResult.rowCount})`;
    await this.pgClient.query(deleteOriginalSql);
    console.log('✅ Deleted original trails');
    
    if (this.config.verbose) {
      console.log('🔍 Verifying split results...');
    }
    
    // Step 4: Recreate spatial index for new segments
    console.log('🔧 Recreating spatial index for split segments...');
    await this.pgClient.query(`DROP INDEX IF EXISTS idx_${this.stagingSchema}_trails_geometry`);
    await this.pgClient.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.stagingSchema}_trails_geometry 
      ON ${this.stagingSchema}.trails USING GIST (geometry)
    `);
    console.log('✅ Spatial index recreated');
    
    // Get final statistics
    console.log('📊 Calculating final statistics...');
    const finalCountResult = await this.pgClient.query(`SELECT COUNT(*) FROM ${this.stagingSchema}.trails`);
    const finalSegmentCount = parseInt(finalCountResult.rows[0].count);
    console.log(`✅ Final segment count: ${finalSegmentCount}`);
    
    // OPTIMIZED: Use spatial index and bbox pre-filtering for intersection counting
    console.log('🔗 Counting remaining intersections (optimized)...');
    const intersectionCountResult = await this.pgClient.query(`
      WITH trail_bboxes AS (
        SELECT id, geometry
        FROM ${this.stagingSchema}.trails
        WHERE ST_Length(geometry::geography) > $1
      )
      SELECT COUNT(*) as intersection_count
      FROM trail_bboxes t1
      JOIN trail_bboxes t2 ON t1.id < t2.id
      WHERE ST_Intersects(ST_Envelope(t1.geometry), ST_Envelope(t2.geometry))  -- Bbox pre-filter
        AND ST_Intersects(t1.geometry, t2.geometry)  -- Precise intersection
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
    `, [this.config.minTrailLengthMeters]);
    
    const finalIntersectionCount = parseInt(intersectionCountResult.rows[0].intersection_count);
    console.log(`✅ Remaining intersections: ${finalIntersectionCount}`);
    
    console.log(`✅ Trail splitting complete`);
    console.log(`📊 Final result: ${finalSegmentCount} segments, ${finalIntersectionCount} remaining intersections`);
    
    if (this.config.verbose) {
      // OPTIMIZED: Show remaining intersections with spatial indexing
      const remainingIntersections = await this.pgClient.query(`
        WITH trail_bboxes AS (
          SELECT id, name, geometry, ST_Length(geometry::geography) as length_m
          FROM ${this.stagingSchema}.trails
          WHERE ST_Length(geometry::geography) > $1
        )
        SELECT t1.name as trail1_name, t2.name as trail2_name,
               t1.length_m as length1_m, t2.length_m as length2_m
        FROM trail_bboxes t1
        JOIN trail_bboxes t2 ON t1.id < t2.id
        WHERE ST_Intersects(ST_Envelope(t1.geometry), ST_Envelope(t2.geometry))
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
        LIMIT 5
      `, [this.config.minTrailLengthMeters]);
      
      if (remainingIntersections.rows.length > 0) {
        console.log(`🔗 Remaining intersections after splitting:`);
        remainingIntersections.rows.forEach((intersection, i) => {
          console.log(`   ${i + 1}. "${intersection.trail1_name}" ↔ "${intersection.trail2_name}" (${intersection.length1_m.toFixed(1)}m ↔ ${intersection.length2_m.toFixed(1)}m)`);
        });
      } else {
        console.log(`✅ No remaining intersections detected`);
      }
    }
    
    return {
      iterations: 1, // Single iteration now
      finalSegmentCount,
      intersectionCount: finalIntersectionCount
    };
  }

  /**
   * Check if there are any intersections between trails
   */
  async hasIntersections(): Promise<boolean> {
    const result = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > $1
        AND ST_Length(t2.geometry::geography) > $1
    `, [this.config.minTrailLengthMeters]);
    
    return parseInt(result.rows[0].intersection_count) > 0;
  }

  /**
   * Get statistics about the current trail network
   */
  async getStatistics(): Promise<{
    totalTrails: number;
    intersectionCount: number;
    averageTrailLength: number;
  }> {
    const statsResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        AVG(ST_Length(geometry::geography)) as avg_length,
        COUNT(*) FILTER (WHERE ST_Length(geometry::geography) > 0) as valid_trails
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    
    const intersectionResult = await this.pgClient.query(`
      SELECT COUNT(*) as intersection_count
      FROM ${this.stagingSchema}.trails t1
      JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
      WHERE ST_Intersects(t1.geometry, t2.geometry)
        AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
        AND ST_Length(t1.geometry::geography) > $1
        AND ST_Length(t2.geometry::geography) > $1
    `, [this.config.minTrailLengthMeters]);
    
    return {
      totalTrails: parseInt(statsResult.rows[0].total_trails),
      intersectionCount: parseInt(intersectionResult.rows[0].intersection_count),
      averageTrailLength: parseFloat(statsResult.rows[0].avg_length) || 0
    };
  }
} 