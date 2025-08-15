import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Custom T-intersection detection that finds the closest/best point
 * This avoids the multiple point issue from pgr_separateTouching
 */
async function customTIntersectionDetection() {
  console.log('🔧 Custom T-intersection detection with closest point selection...\n');

  console.log('📋 Problem with pgr_separateTouching:');
  console.log('   - Returns multiple points when tolerance is too large');
  console.log('   - No built-in way to specify "closest" or "best" point');
  console.log('   - We need to manually find the optimal intersection point');
  console.log('');

  console.log('🔧 Custom solution:\n');
  
  const customTIntersectionLogic = `
  /**
   * Custom T-intersection detection that finds the closest/best point
   */
  async splitTrailsWithCustomTIntersectionDetection(): Promise<PgRoutingSplittingResult> {
    console.log('🔗 PGROUTING SPLITTING: Using custom T-intersection detection...');
    
    const result: PgRoutingSplittingResult = {
      originalTrailCount: 0,
      splitSegmentCount: 0,
      intersectionPointsFound: 0,
      segmentsRemoved: 0,
      success: false
    };

    try {
      // Step 1: Get initial trail count
      const initialCountResult = await this.pgClient.query(\`
        SELECT COUNT(*) as count FROM \${this.stagingSchema}.trails
      \`);
      result.originalTrailCount = parseInt(initialCountResult.rows[0].count);
      
      console.log(\`   📊 Initial trails: \${result.originalTrailCount}\`);

      // Step 2: Create temporary table with required columns
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.trails_for_pgrouting AS
        SELECT 
          id,
          ST_Force2D(geometry) as geom
        FROM \${this.stagingSchema}.trails
        WHERE ST_IsValid(geometry) 
          AND ST_GeometryType(geometry) = 'ST_LineString'
      \`);

      // Step 3: Use pgr_separateCrossing for crossing intersections
      console.log('   🔗 Step 1: Using pgr_separateCrossing for crossing intersections...');
      
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.trails_crossing_split AS
        SELECT id, sub_id, geom FROM pgr_separateCrossing(
          'SELECT id, geom FROM \${this.stagingSchema}.trails_for_pgrouting', 
          \${this.config.toleranceMeters}
        )
      \`);

      // Step 4: CUSTOM T-intersection detection with closest point selection
      console.log('   🔗 Step 2: Using custom T-intersection detection with closest point...');
      
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.custom_t_intersections AS
        WITH trail_pairs AS (
          -- Find all trail pairs that are within tolerance but don't cross
          SELECT 
            t1.id as trail1_id,
            t1.geom as trail1_geom,
            t1.name as trail1_name,
            t2.id as trail2_id,
            t2.geom as trail2_geom,
            t2.name as trail2_name
          FROM \${this.stagingSchema}.trails_for_pgrouting t1
          JOIN \${this.stagingSchema}.trails_for_pgrouting t2 ON t1.id < t2.id
          WHERE ST_DWithin(t1.geom, t2.geom, \${(this.config.tIntersectionToleranceMeters || 2) / 111000.0})
            AND NOT ST_Crosses(t1.geom, t2.geom)  -- Not a crossing intersection
            AND ST_Distance(t1.geom::geography, t2.geom::geography) <= \${this.config.tIntersectionToleranceMeters || 2}
        ),
        intersection_candidates AS (
          -- Find all possible intersection points for each trail pair
          SELECT 
            trail1_id,
            trail2_id,
            trail1_name,
            trail2_name,
            trail1_geom,
            trail2_geom,
            -- Find the closest point on trail1 to trail2
            ST_ClosestPoint(trail1_geom, trail2_geom) as intersection_point,
            -- Calculate distance from trail1 to trail2
            ST_Distance(trail1_geom::geography, trail2_geom::geography) as distance_meters,
            -- Calculate where on trail1 this point is (0-1 ratio)
            ST_LineLocatePoint(trail1_geom, ST_ClosestPoint(trail1_geom, trail2_geom)) as location_ratio
          FROM trail_pairs
        ),
        best_intersections AS (
          -- Select the best intersection point for each trail
          -- Prefer points that are not at the very start or end of trails
          SELECT DISTINCT ON (trail1_id)
            trail1_id,
            trail2_id,
            trail1_name,
            trail2_name,
            trail1_geom,
            intersection_point,
            distance_meters,
            location_ratio,
            -- Score based on distance and location (prefer middle of trail)
            (1.0 / distance_meters) * 
            CASE 
              WHEN location_ratio BETWEEN 0.1 AND 0.9 THEN 2.0  -- Prefer middle of trail
              WHEN location_ratio BETWEEN 0.05 AND 0.95 THEN 1.5  -- Accept near endpoints
              ELSE 1.0  -- Endpoints are least preferred
            END as intersection_score
          FROM intersection_candidates
          ORDER BY trail1_id, intersection_score DESC
        )
        SELECT 
          trail1_id as id,
          trail1_name,
          trail2_name,
          trail1_geom as original_geom,
          intersection_point,
          distance_meters,
          location_ratio,
          intersection_score
        FROM best_intersections
        WHERE distance_meters <= \${this.config.tIntersectionToleranceMeters || 2}
        ORDER BY trail1_id
      \`);

      // Step 5: Split trails at the best intersection points
      console.log('   🔗 Step 3: Splitting trails at best intersection points...');
      
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.trails_touching_split AS
        WITH split_segments AS (
          SELECT 
            t.id,
            CASE 
              WHEN i.intersection_point IS NOT NULL THEN 1
              ELSE 1
            END as sub_id,
            CASE 
              WHEN i.intersection_point IS NOT NULL THEN 
                ST_LineSubstring(t.geom, 0, i.location_ratio)
              ELSE t.geom
            END as geom
          FROM \${this.stagingSchema}.trails_for_pgrouting t
          LEFT JOIN \${this.stagingSchema}.custom_t_intersections i ON t.id = i.id
          WHERE i.intersection_point IS NOT NULL
          
          UNION ALL
          
          SELECT 
            t.id,
            2 as sub_id,
            ST_LineSubstring(t.geom, i.location_ratio, 1) as geom
          FROM \${this.stagingSchema}.trails_for_pgrouting t
          JOIN \${this.stagingSchema}.custom_t_intersections i ON t.id = i.id
          WHERE i.intersection_point IS NOT NULL
            AND i.location_ratio > 0.01  -- Only split if not at very start
            AND i.location_ratio < 0.99  -- Only split if not at very end
        )
        SELECT 
          id,
          sub_id,
          geom
        FROM split_segments
        WHERE ST_Length(geom::geography) >= \${this.config.minSegmentLengthMeters}
          AND ST_NumPoints(geom) >= 2
      \`);

      // Step 6: Add trails that weren't split by T-intersections
      await this.pgClient.query(\`
        INSERT INTO \${this.stagingSchema}.trails_touching_split (id, sub_id, geom)
        SELECT 
          t.id,
          1 as sub_id,
          t.geom
        FROM \${this.stagingSchema}.trails_for_pgrouting t
        WHERE t.id NOT IN (
          SELECT DISTINCT id FROM \${this.stagingSchema}.trails_touching_split
        )
      \`);

      // Step 7: Combine crossing and touching splits
      console.log('   🔗 Step 4: Combining crossing and touching splits...');
      
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.trails_combined_split AS
        SELECT id, sub_id, geom FROM \${this.stagingSchema}.trails_crossing_split
        UNION
        SELECT id, sub_id, geom FROM \${this.stagingSchema}.trails_touching_split
        WHERE (id, sub_id) NOT IN (
          SELECT id, sub_id FROM \${this.stagingSchema}.trails_crossing_split
        )
      \`);

      // Step 8: Add original trails that weren't split by either method
      await this.pgClient.query(\`
        INSERT INTO \${this.stagingSchema}.trails_combined_split (id, sub_id, geom)
        SELECT 
          t.id,
          1 as sub_id,
          t.geom
        FROM \${this.stagingSchema}.trails_for_pgrouting t
        WHERE t.id NOT IN (
          SELECT DISTINCT id FROM \${this.stagingSchema}.trails_combined_split
        )
      \`);

      // Step 9: Create final trails table with metadata
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.trails_custom_split AS
        SELECT 
          gen_random_uuid() as app_uuid,
          cs.id,
          t.app_uuid as original_app_uuid,
          t.osm_id,
          t.name,
          t.region,
          t.trail_type,
          t.surface,
          t.difficulty,
          ST_Length(cs.geom::geography) / 1000.0 as length_km,
          t.elevation_gain,
          t.elevation_loss,
          t.max_elevation,
          t.min_elevation,
          t.avg_elevation,
          ST_XMin(cs.geom) as bbox_min_lng,
          ST_XMax(cs.geom) as bbox_max_lng,
          ST_YMin(cs.geom) as bbox_min_lat,
          ST_YMax(cs.geom) as bbox_max_lat,
          t.source,
          t.source_tags,
          ST_Force3D(cs.geom) as geometry
        FROM \${this.stagingSchema}.trails_combined_split cs
        JOIN \${this.stagingSchema}.trails t ON cs.id = t.id
        WHERE ST_Length(cs.geom::geography) >= \${this.config.minSegmentLengthMeters}
      \`);

      // Step 10: Replace original trails table
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails\`);
      await this.pgClient.query(\`
        ALTER TABLE \${this.stagingSchema}.trails_custom_split 
        RENAME TO trails
      \`);

      // Step 11: Clean up temporary tables
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_for_pgrouting\`);
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_crossing_split\`);
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_touching_split\`);
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_combined_split\`);
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.custom_t_intersections\`);

      // Step 12: Get final statistics
      const finalCountResult = await this.pgClient.query(\`
        SELECT COUNT(*) as count FROM \${this.stagingSchema}.trails
      \`);
      result.splitSegmentCount = parseInt(finalCountResult.rows[0].count);
      result.segmentsRemoved = result.originalTrailCount - result.splitSegmentCount;

      // Step 13: Create spatial index
      await this.pgClient.query(\`
        CREATE INDEX IF NOT EXISTS idx_trails_geometry_custom 
        ON \${this.stagingSchema}.trails USING GIST(geometry)
      \`);

      result.success = true;
      
      console.log(\`   ✅ Custom T-intersection splitting complete:\`);
      console.log(\`      📊 Original trails: \${result.originalTrailCount}\`);
      console.log(\`      🔗 Split segments: \${result.splitSegmentCount}\`);
      console.log(\`      🗑️ Segments removed: \${result.segmentsRemoved}\`);

      return result;

    } catch (error) {
      console.error('   ❌ Error during custom T-intersection splitting:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }
  `;

  console.log(customTIntersectionLogic);
  
  console.log('🎯 Key advantages of this approach:');
  console.log('1. ✅ Finds the CLOSEST point between trails (no multiple points)');
  console.log('2. ✅ Scores intersection points based on distance and location');
  console.log('3. ✅ Prefers middle of trails over endpoints for splitting');
  console.log('4. ✅ Only splits when the intersection point is meaningful');
  console.log('5. ✅ Avoids the multiple point issue from pgr_separateTouching');
  console.log('');
  
  console.log('🔧 Scoring algorithm:');
  console.log('   - Distance: Closer trails get higher scores');
  console.log('   - Location: Middle of trail (0.1-0.9) gets 2x score');
  console.log('   - Location: Near endpoints (0.05-0.95) gets 1.5x score');
  console.log('   - Location: At endpoints gets 1x score');
  console.log('');
  
  console.log('📋 Next steps:');
  console.log('1. Implement this custom T-intersection detection');
  console.log('2. Test with Mesa Trail and Kohler Mesa Trail');
  console.log('3. Compare results with the previous pgRouting approach');
  console.log('4. Add logging to see which trails are being split and why');
}

customTIntersectionDetection().catch(console.error);
