import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Test script to handle multiple intersection points from large tolerance
 * This addresses the issue where 2m tolerance might return multiple points on the same trail
 */
async function testTIntersectionMultiplePoints() {
  console.log('🔧 Testing T-intersection handling with multiple points...\n');

  console.log('📋 Problem Analysis:\n');
  
  console.log('1. Issue: 2m tolerance might return multiple points on the same trail');
  console.log('   - This happens when trails run parallel for a distance');
  console.log('   - Or when there are multiple valid intersection candidates');
  console.log('   - We need to select the "best" intersection point');
  console.log('');
  
  console.log('2. Solutions to implement:\n');
  
  console.log('A. Point Selection Strategy:');
  console.log('   - Use the point closest to the trail endpoint');
  console.log('   - Use the point with the most perpendicular intersection');
  console.log('   - Use the point that creates the most balanced segments');
  console.log('   - Use the point that maintains the original trail direction');
  console.log('');
  
  console.log('B. Adaptive Tolerance:');
  console.log('   - Start with 2m tolerance');
  console.log('   - If multiple points found, reduce tolerance to 1m');
  console.log('   - If still multiple points, use manual selection');
  console.log('');
  
  console.log('C. Manual T-Intersection Detection:');
  console.log('   - Fallback to manual ST_Touches detection');
  console.log('   - Use ST_ClosestPoint to find the best intersection');
  console.log('   - Split trails manually at the selected point');
  console.log('');

  // Create the improved T-intersection handling logic
  console.log('🔧 Proposed improved T-intersection handling:\n');
  
  const improvedTIntersectionLogic = `
  /**
   * IMPROVED T-intersection detection with multiple point handling
   */
  async splitTrailsWithImprovedTIntersectionHandling(): Promise<PgRoutingSplittingResult> {
    console.log('🔗 PGROUTING SPLITTING: Using improved T-intersection handling...');
    
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

      // Step 2: Create temporary table with required columns for pgRouting
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

      // Step 4: IMPROVED T-intersection detection with multiple point handling
      console.log('   🔗 Step 2: Using improved T-intersection detection...');
      
      // First try with 2m tolerance
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.trails_touching_split_2m AS
        SELECT id, sub_id, geom FROM pgr_separateTouching(
          'SELECT id, geom FROM \${this.stagingSchema}.trails_for_pgrouting', 
          \${(this.config.tIntersectionToleranceMeters || 2) / 111000.0}
        )
      \`);

      // Check for trails with multiple split points
      const multiplePointsResult = await this.pgClient.query(\`
        SELECT id, COUNT(*) as split_count
        FROM \${this.stagingSchema}.trails_touching_split_2m
        GROUP BY id
        HAVING COUNT(*) > 2
      \`);

      if (multiplePointsResult.rows.length > 0) {
        console.log(\`   ⚠️ Found \${multiplePointsResult.rows.length} trails with multiple split points, using 1m tolerance...\`);
        
        // Try with 1m tolerance for problematic trails
        const problematicTrailIds = multiplePointsResult.rows.map(r => r.id).join(',');
        
        await this.pgClient.query(\`
          CREATE TABLE \${this.stagingSchema}.trails_touching_split_1m AS
          SELECT id, sub_id, geom FROM pgr_separateTouching(
            'SELECT id, geom FROM \${this.stagingSchema}.trails_for_pgrouting WHERE id IN (\${problematicTrailIds})', 
            \${1.0 / 111000.0}
          )
        \`);

        // Combine results: use 1m for problematic trails, 2m for others
        await this.pgClient.query(\`
          CREATE TABLE \${this.stagingSchema}.trails_touching_split AS
          SELECT id, sub_id, geom FROM \${this.stagingSchema}.trails_touching_split_1m
          UNION
          SELECT id, sub_id, geom FROM \${this.stagingSchema}.trails_touching_split_2m
          WHERE id NOT IN (\${problematicTrailIds})
        \`);
        
        // Clean up intermediate tables
        await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_touching_split_2m\`);
        await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_touching_split_1m\`);
      } else {
        // No multiple points, use the 2m results directly
        await this.pgClient.query(\`
          ALTER TABLE \${this.stagingSchema}.trails_touching_split_2m 
          RENAME TO trails_touching_split
        \`);
      }

      // Step 5: Combine both splitting results with proper deduplication
      console.log('   🔗 Step 3: Combining crossing and touching splits...');
      
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.trails_combined_split AS
        SELECT id, sub_id, geom FROM \${this.stagingSchema}.trails_crossing_split
        UNION
        SELECT id, sub_id, geom FROM \${this.stagingSchema}.trails_touching_split
        WHERE (id, sub_id) NOT IN (
          SELECT id, sub_id FROM \${this.stagingSchema}.trails_crossing_split
        )
      \`);

      // Step 6: Add original trails that weren't split by either method
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

      // Step 7: Create final trails table with metadata
      await this.pgClient.query(\`
        CREATE TABLE \${this.stagingSchema}.trails_pgrouting_split AS
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

      // Step 8: Replace original trails table
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails\`);
      await this.pgClient.query(\`
        ALTER TABLE \${this.stagingSchema}.trails_pgrouting_split 
        RENAME TO trails
      \`);

      // Step 9: Clean up temporary tables
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_for_pgrouting\`);
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_crossing_split\`);
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_touching_split\`);
      await this.pgClient.query(\`DROP TABLE \${this.stagingSchema}.trails_combined_split\`);

      // Step 10: Get final statistics
      const finalCountResult = await this.pgClient.query(\`
        SELECT COUNT(*) as count FROM \${this.stagingSchema}.trails
      \`);
      result.splitSegmentCount = parseInt(finalCountResult.rows[0].count);
      result.segmentsRemoved = result.originalTrailCount - result.splitSegmentCount;

      // Step 11: Create spatial index
      await this.pgClient.query(\`
        CREATE INDEX IF NOT EXISTS idx_trails_geometry_pgrouting 
        ON \${this.stagingSchema}.trails USING GIST(geometry)
      \`);

      result.success = true;
      
      console.log(\`   ✅ Improved T-intersection splitting complete:\`);
      console.log(\`      📊 Original trails: \${result.originalTrailCount}\`);
      console.log(\`      🔗 Split segments: \${result.splitSegmentCount}\`);
      console.log(\`      🗑️ Segments removed: \${result.segmentsRemoved}\`);

      return result;

    } catch (error) {
      console.error('   ❌ Error during improved T-intersection splitting:', error);
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }
  `;

  console.log(improvedTIntersectionLogic);
  
  console.log('🔧 Alternative manual T-intersection detection:\n');
  
  const manualTIntersectionLogic = `
  /**
   * Manual T-intersection detection as fallback
   */
  async detectManualTIntersections(): Promise<void> {
    console.log('   🔗 Step 2.5: Manual T-intersection detection...');
    
    await this.pgClient.query(\`
      CREATE TABLE \${this.stagingSchema}.manual_t_intersections AS
      WITH trail_pairs AS (
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
      ),
      touching_points AS (
        SELECT 
          trail1_id,
          trail2_id,
          trail1_name,
          trail2_name,
          ST_ClosestPoint(trail1_geom, trail2_geom) as intersection_point,
          ST_Distance(trail1_geom::geography, trail2_geom::geography) as distance_meters
        FROM trail_pairs
        WHERE ST_Distance(trail1_geom::geography, trail2_geom::geography) <= \${this.config.tIntersectionToleranceMeters || 2}
      )
      SELECT 
        trail1_id as id,
        trail1_name,
        trail2_name,
        intersection_point,
        distance_meters
      FROM touching_points
      ORDER BY trail1_id, distance_meters
    \`);
  }
  `;

  console.log(manualTIntersectionLogic);
  
  console.log('🎯 Recommended approach:');
  console.log('1. Start with 2m tolerance for T-intersection detection');
  console.log('2. If multiple points found on same trail, reduce to 1m tolerance');
  console.log('3. If still multiple points, use manual selection (closest point)');
  console.log('4. Add logging to track which trails have multiple intersection points');
  console.log('5. Consider trail geometry characteristics when selecting best point');
}

testTIntersectionMultiplePoints().catch(console.error);
