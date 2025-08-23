import { Pool, PoolClient } from 'pg';

export interface StandaloneTrailSplittingConfig {
  stagingSchema: string;
  intersectionTolerance: number;
  minSegmentLength: number;
  verbose?: boolean;
}

export interface StandaloneTrailSplittingResult {
  success: boolean;
  originalTrailCount: number;
  finalTrailCount: number;
  segmentsCreated: number;
  originalTrailsDeleted: number;
  intersectionCount: number;
  processingTimeMs: number;
  errors?: string[];
}

export interface ValidationResult {
  isValid: boolean;
  trailCount: number;
  errors: string[];
}

/**
 * Standalone Trail Splitting Service - Follows the EXACT logic from the prototype script
 * /Users/shaydu/dev/carthorse/scripts/fern-canyon-mesa-y-intersection-snap-split-fix.js
 * 
 * This service:
 * 1. Iteratively finds Y-intersections (up to 5 iterations)
 * 2. Snaps trail endpoints to intersection points
 * 3. Splits trails at intersection points
 * 4. Creates connector trails
 * 5. Finds and fixes true geometric intersections
 * 6. Replaces the staging trails table with processed trails
 */
export class StandaloneTrailSplittingService {
  private pgClient: Pool;
  private config: StandaloneTrailSplittingConfig;

  constructor(pgClient: Pool, config: StandaloneTrailSplittingConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  async splitTrailsAndReplace(): Promise<StandaloneTrailSplittingResult> {
    const startTime = Date.now();
    console.log('🔗 Starting standalone trail splitting service...');
    console.log(`   📍 Staging schema: ${this.config.stagingSchema}`);
    console.log(`   📏 Intersection tolerance: ${this.config.intersectionTolerance}m`);
    console.log(`   📏 Minimum segment length: ${this.config.minSegmentLength}m`);

    const client = this.pgClient;

    try {
      await client.query('BEGIN');

      // Get original trail count
      const originalCountResult = await client.query(`SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.trails`);
      const originalTrailCount = parseInt(originalCountResult.rows[0].count);
      console.log(`   📊 Original trails: ${originalTrailCount}`);

      // Step 1: Iteratively find and fix all Y-intersections (max 5 iterations)
      console.log('   🔄 Step 1: Iteratively fixing all Y-intersections (max 5 iterations)...');

      let iteration = 1;
      let totalProcessed = 0;
      let hasMoreIntersections = true;
      const maxIterations = 5;

      while (hasMoreIntersections && iteration <= maxIterations) {
        console.log(`      🔄 Iteration ${iteration}/${maxIterations}:`);

        // Find all potential Y-intersections
        const allIntersections = await this.findAllYIntersections();

        if (allIntersections.length === 0) {
          console.log(`         ✅ No more Y-intersections found`);
          hasMoreIntersections = false;
          break;
        }

        console.log(`         Found ${allIntersections.length} potential Y-intersections`);
        
        // Show first few intersections for debugging
        if (this.config.verbose) {
          console.log(`         First 5 intersections:`);
          allIntersections.slice(0, 5).forEach((intersection, index) => {
            console.log(`           ${index + 1}. ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (${intersection.distance_meters.toFixed(6)}m)`);
          });
        }

        let iterationProcessed = 0;
        const processedTrails = new Set(); // Track trails processed in this iteration

        for (const intersection of allIntersections) {
          // Skip if either trail has already been processed in this iteration
          if (processedTrails.has(intersection.visited_trail_id) || processedTrails.has(intersection.visiting_trail_id)) {
            if (this.config.verbose) {
              console.log(`         ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (trail already processed)`);
            }
            continue;
          }

          if (this.config.verbose) {
            console.log(`         🔧 Processing: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`);
          }

          const result = await this.performYIntersectionFix(intersection);

          if (result.success) {
            if (this.config.verbose) {
              console.log(`            ✅ Fixed: ${result.message}`);
            }
            iterationProcessed++;
            totalProcessed++;
            // Mark both trails as processed to avoid conflicts
            processedTrails.add(intersection.visited_trail_id);
            processedTrails.add(intersection.visiting_trail_id);
          } else {
            if (this.config.verbose) {
              console.log(`            ❌ Failed: ${result.error}`);
            }
          }
        }

        console.log(`         📊 Iteration ${iteration}: processed ${iterationProcessed} Y-intersections`);

        if (iterationProcessed === 0) {
          console.log(`         ⚠️  No Y-intersections were successfully processed in this iteration`);
          hasMoreIntersections = false;
        }

        iteration++;
      }

      console.log(`      📊 Total successfully processed: ${totalProcessed} Y-intersections`);

      // Step 2: Find and fix true geometric intersections
      console.log('   🔄 Step 2: Finding and fixing true geometric intersections...');
      
      const trueIntersections = await this.findTrueIntersections();
      
      if (trueIntersections.length === 0) {
        console.log('      ✅ No true intersections found');
      } else {
        console.log(`      Found ${trueIntersections.length} true intersections`);
        
        // Show first few intersections for debugging
        if (this.config.verbose) {
          console.log(`      First 5 true intersections:`);
          trueIntersections.slice(0, 5).forEach((intersection, index) => {
            console.log(`        ${index + 1}. ${intersection.trail1_name} × ${intersection.trail2_name}`);
          });
        }

        let intersectionProcessed = 0;
        const processedIntersectionTrails = new Set(); // Track trails processed in intersection phase

        for (const intersection of trueIntersections) {
          // Skip if either trail has already been processed
          if (processedIntersectionTrails.has(intersection.trail1_id) || processedIntersectionTrails.has(intersection.trail2_id)) {
            if (this.config.verbose) {
              console.log(`      ⏭️  Skipping intersection: ${intersection.trail1_name} × ${intersection.trail2_name} (trail already processed)`);
            }
            continue;
          }

          const result = await this.performTrueIntersectionFix(intersection);

          if (result.success) {
            if (this.config.verbose) {
              console.log(`      ✅ Fixed intersection: ${result.message}`);
            }
            intersectionProcessed++;
            // Mark both trails as processed to avoid conflicts
            processedIntersectionTrails.add(intersection.trail1_id);
            processedIntersectionTrails.add(intersection.trail2_id);
          } else {
            if (this.config.verbose) {
              console.log(`      ❌ Failed intersection: ${result.error}`);
            }
          }
        }

        console.log(`      📊 Total true intersections processed: ${intersectionProcessed}`);
      }

      await client.query('COMMIT');

      // Get final trail count
      const finalCountResult = await client.query(`SELECT COUNT(*) as count FROM ${this.config.stagingSchema}.trails`);
      const finalTrailCount = parseInt(finalCountResult.rows[0].count);

      const processingTimeMs = Date.now() - startTime;

      console.log('   ✅ Trail splitting completed successfully!');
      console.log('   📊 Results:');
      console.log(`      📈 Original trails: ${originalTrailCount}`);
      console.log(`      📈 Final trails: ${finalTrailCount}`);
      console.log(`      ✂️ Segments created: ${finalTrailCount - originalTrailCount}`);
      console.log(`      🗑️ Original trails deleted: ${totalProcessed > 0 ? 'some' : 'none'}`);
      console.log(`      📍 Intersection count: ${totalProcessed}`);
      console.log(`      ⏱️ Processing time: ${processingTimeMs}ms`);

      return {
        success: true,
        originalTrailCount,
        finalTrailCount,
        segmentsCreated: finalTrailCount - originalTrailCount,
        originalTrailsDeleted: 0, // We don't track this precisely in the prototype logic
        intersectionCount: totalProcessed,
        processingTimeMs
      };

    } catch (error: any) {
      await client.query('ROLLBACK');
      console.log(`   ❌ Database error during trail splitting: ${error.message}`);
      return {
        success: false,
        originalTrailCount: 0,
        finalTrailCount: 0,
        segmentsCreated: 0,
        originalTrailsDeleted: 0,
        intersectionCount: 0,
        processingTimeMs: Date.now() - startTime,
        errors: [`Database error during trail splitting: ${error.message}`]
      };
    }
  }

  /**
   * Find all potential Y-intersections - EXACT logic from prototype
   */
  private async findAllYIntersections(): Promise<any[]> {
    const query = `
      WITH trail_endpoints AS (
        SELECT
          app_uuid as trail_id,
          name as trail_name,
          ST_AsGeoJSON(ST_StartPoint(geometry))::json as start_point,
          ST_AsGeoJSON(ST_EndPoint(geometry))::json as end_point,
          geometry as trail_geom
        FROM ${this.config.stagingSchema}.trails
        WHERE ST_Length(geometry::geography) >= $1
          AND ST_IsValid(geometry)
      ),
      y_intersections AS (
        -- Find start points near other trails (Y-intersections)
        SELECT
          e1.trail_id as visiting_trail_id,
          e1.trail_name as visiting_trail_name,
          e1.start_point as visiting_endpoint,
          e2.trail_id as visited_trail_id,
          e2.trail_name as visited_trail_name,
          e2.trail_geom as visited_trail_geom,
          ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) as distance_meters,
          ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)))::json as split_point,
          ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)) as split_ratio,
          ST_Length(ST_LineSubstring(e2.trail_geom, 0, ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)))::geography) as distance_from_start,
          ST_Length(ST_LineSubstring(e2.trail_geom, ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.start_point)), 1)::geography) as distance_from_end
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.trail_id != e2.trail_id
          AND (ST_Distance(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography) <= $2
               OR ST_DWithin(ST_GeomFromGeoJSON(e1.start_point)::geography, e2.trail_geom::geography, 0.1))  -- Include shared endpoints
        UNION ALL
        -- Find end points near other trails (Y-intersections)
        SELECT
          e1.trail_id as visiting_trail_id,
          e1.trail_name as visiting_trail_name,
          e1.end_point as visiting_endpoint,
          e2.trail_id as visited_trail_id,
          e2.trail_name as visited_trail_name,
          e2.trail_geom as visited_trail_geom,
          ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) as distance_meters,
          ST_AsGeoJSON(ST_ClosestPoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)))::json as split_point,
          ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)) as split_ratio,
          ST_Length(ST_LineSubstring(e2.trail_geom, 0, ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)))::geography) as distance_from_start,
          ST_Length(ST_LineSubstring(e2.trail_geom, ST_LineLocatePoint(e2.trail_geom, ST_GeomFromGeoJSON(e1.end_point)), 1)::geography) as distance_from_end
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.trail_id != e2.trail_id
          AND (ST_Distance(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography) <= $2
               OR ST_DWithin(ST_GeomFromGeoJSON(e1.end_point)::geography, e2.trail_geom::geography, 0.1))  -- Include shared endpoints
      ),
      best_matches AS (
        SELECT DISTINCT ON (visiting_trail_id, visited_trail_id)
          visiting_trail_id,
          visiting_trail_name,
          visiting_endpoint,
          visited_trail_id,
          visited_trail_name,
          visited_trail_geom,
          distance_meters,
          split_point,
          split_ratio,
          distance_from_start,
          distance_from_end
        FROM y_intersections
        WHERE distance_from_start >= 1.0 AND distance_from_end >= 1.0  -- Only consider splits that are at least 1m from each endpoint
        ORDER BY visiting_trail_id, visited_trail_id, distance_meters
      )
      SELECT * FROM best_matches
      ORDER BY distance_meters
      -- No limit - process all intersections
    `;

    const result = await this.pgClient.query(query, [
      this.config.minSegmentLength,
      this.config.intersectionTolerance
    ]);

    return result.rows;
  }

  /**
   * Find true geometric intersections - EXACT logic from prototype
   */
  private async findTrueIntersections(): Promise<any[]> {
    const query = `
      WITH trail_pairs AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${this.config.stagingSchema}.trails t1
        CROSS JOIN ${this.config.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
          AND ST_Length(t1.geometry::geography) >= $1
          AND ST_Length(t2.geometry::geography) >= $1
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Intersects(t1.geometry, t2.geometry)  -- Only trails that actually intersect
      ),
      intersection_points AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail1_geom,
          trail2_id,
          trail2_name,
          trail2_geom,
          dump.geom as intersection_point
        FROM trail_pairs,
        LATERAL ST_Dump(ST_Intersection(trail1_geom, trail2_geom)) dump
        WHERE ST_GeometryType(dump.geom) = 'ST_Point'
      ),
      validated_intersections AS (
        SELECT 
          trail1_id,
          trail1_name,
          trail1_geom,
          trail2_id,
          trail2_name,
          trail2_geom,
          ST_AsGeoJSON(intersection_point)::json as intersection_point_json,
          -- Calculate split ratios for both trails
          ST_LineLocatePoint(trail1_geom, intersection_point) as trail1_split_ratio,
          ST_LineLocatePoint(trail2_geom, intersection_point) as trail2_split_ratio,
          -- Calculate distances from endpoints to ensure we're not too close
          ST_Length(ST_LineSubstring(trail1_geom, 0.0, ST_LineLocatePoint(trail1_geom, intersection_point))) as trail1_distance_from_start,
          ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point))) as trail2_distance_from_start,
          -- Check if this is a T-intersection (one trail ends at the intersection point)
          (ST_LineLocatePoint(trail1_geom, intersection_point) = 0.0 OR ST_LineLocatePoint(trail1_geom, intersection_point) = 1.0 OR
           ST_LineLocatePoint(trail2_geom, intersection_point) = 0.0 OR ST_LineLocatePoint(trail2_geom, intersection_point) = 1.0) as is_t_intersection
        FROM intersection_points
        WHERE 
          -- Only question: Do trails intersect at X and is intersection point > 1m from either end?
          ST_Length(ST_LineSubstring(trail1_geom, 0.0, ST_LineLocatePoint(trail1_geom, intersection_point))) > 1.0
          AND ST_Length(ST_LineSubstring(trail1_geom, ST_LineLocatePoint(trail1_geom, intersection_point), 1.0)) > 1.0
          AND ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point))) > 1.0
          AND ST_Length(ST_LineSubstring(trail2_geom, ST_LineLocatePoint(trail2_geom, intersection_point), 1.0)) > 1.0
      )
      SELECT 
        trail1_id,
        trail1_name,
        trail1_geom,
        trail2_id,
        trail2_name,
        trail2_geom,
        intersection_point_json,
        trail1_split_ratio,
        trail2_split_ratio,
        trail1_distance_from_start,
        trail2_distance_from_start
      FROM validated_intersections
      ORDER BY trail1_name, trail2_name
    `;

    const result = await this.pgClient.query(query, [this.config.minSegmentLength]);
    return result.rows;
  }

  /**
   * Perform Y-intersection fix - EXACT logic from prototype
   */
  private async performYIntersectionFix(intersection: any): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      // Step 1: Snap the visiting trail endpoint to the visited trail
      const snapResult = await this.snapTrailEndpoint(intersection.visiting_trail_id, intersection.visiting_endpoint, intersection.split_point);
      
      if (!snapResult.success) {
        return { success: false, error: `Snap failed: ${snapResult.error}` };
      }
      
      // Step 2: Split the visited trail at the snapped point
      const splitResult = await this.splitTrail(intersection.visited_trail_id, intersection.split_point);
      
      if (!splitResult.success) {
        return { success: false, error: `Split failed: ${splitResult.error}` };
      }

      // Step 3: Create connector
      const connectorResult = await this.createConnector(
        intersection.visiting_trail_id,
        intersection.visiting_endpoint, 
        intersection.split_point,
        `${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`
      );

      if (!connectorResult.success) {
        return { success: false, error: `Connector failed: ${connectorResult.error}` };
      }

      return { 
        success: true, 
        message: `Split ${intersection.visited_trail_name} and created connector (${intersection.distance_meters.toFixed(2)}m)`
      };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Perform true intersection fix - EXACT logic from prototype
   */
  private async performTrueIntersectionFix(intersection: any): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      if (this.config.verbose) {
        console.log(`            🔧 Processing true intersection: ${intersection.trail1_name} × ${intersection.trail2_name}`);
      }

      // Step 1: Split trail1 at the intersection point
      const splitResult1 = await this.splitTrail(intersection.trail1_id, intersection.intersection_point_json);
      
      if (!splitResult1.success) {
        return { success: false, error: `Trail1 split failed: ${splitResult1.error}` };
      }

      // Step 2: Split trail2 at the intersection point
      const splitResult2 = await this.splitTrail(intersection.trail2_id, intersection.intersection_point_json);
      
      if (!splitResult2.success) {
        return { success: false, error: `Trail2 split failed: ${splitResult2.error}` };
      }

      // Step 3: Create a connector at the intersection point
      const connectorResult = await this.createConnector(
        intersection.trail1_id,
        intersection.intersection_point_json, 
        intersection.intersection_point_json,
        `${intersection.trail1_name} × ${intersection.trail2_name}`
      );

      if (!connectorResult.success) {
        return { success: false, error: `Connector failed: ${connectorResult.error}` };
      }

      return { 
        success: true, 
        message: `Split both trails at intersection point (${intersection.trail1_distance_from_start.toFixed(2)}m, ${intersection.trail2_distance_from_start.toFixed(2)}m)`
      };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Snap a trail endpoint to a specific point - EXACT logic from prototype
   */
  private async snapTrailEndpoint(trailId: string, endpoint: any, snapPoint: any): Promise<{ success: boolean; message?: string; error?: string }> {
    const client = await this.pgClient.connect();
    
    try {
      // Start transaction
      await client.query('BEGIN');

      // Get original trail
      const originalTrail = await client.query(`
        SELECT * FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1
      `, [trailId]);

      if (originalTrail.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Trail not found' };
      }

      const trail = originalTrail.rows[0];
      
      // Determine if the endpoint is the start or end point
      const startPoint = `ST_GeomFromGeoJSON('${JSON.stringify(endpoint)}')`;
      const endPoint = `ST_GeomFromGeoJSON('${JSON.stringify(endpoint)}')`;
      const snapPointGeom = `ST_GeomFromGeoJSON('${JSON.stringify(snapPoint)}')`;
      
      // Check which endpoint matches (with small tolerance for floating point precision)
      const endpointCheck = await client.query(`
        SELECT 
          ST_Distance(ST_StartPoint(geometry), ${startPoint}) as start_dist,
          ST_Distance(ST_EndPoint(geometry), ${endPoint}) as end_dist
        FROM ${this.config.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trailId]);
      
      if (endpointCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Trail not found for endpoint check' };
      }
      
      const distances = endpointCheck.rows[0];
      const isStartPoint = distances.start_dist < distances.end_dist;
      
      // Create new geometry with snapped endpoint
      let newGeometry;
      if (isStartPoint) {
        // Snap start point
        newGeometry = `ST_SetPoint(geometry, 0, ${snapPointGeom})`;
      } else {
        // Snap end point
        newGeometry = `ST_SetPoint(geometry, ST_NPoints(geometry) - 1, ${snapPointGeom})`;
      }
      
      // Update the trail geometry
      await client.query(`
        UPDATE ${this.config.stagingSchema}.trails 
        SET geometry = ${newGeometry}
        WHERE app_uuid = $1
      `, [trailId]);
      
      await client.query('COMMIT');
      return { 
        success: true, 
        message: `Snapped ${isStartPoint ? 'start' : 'end'} point of trail ${trailId}`
      };
      
    } catch (error: any) {
      await client.query('ROLLBACK');
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Split a trail at a specific point - EXACT logic from prototype
   */
  private async splitTrail(trailId: string, splitPoint: any): Promise<{ success: boolean; message?: string; error?: string; segments?: any[] }> {
    const client = await this.pgClient.connect();
    
    try {
      // Start transaction
      await client.query('BEGIN');

      // Get original trail
      const originalTrail = await client.query(`
        SELECT * FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1
      `, [trailId]);

      if (originalTrail.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Trail not found' };
      }

      const trail = originalTrail.rows[0];
      
      // Debug: Log trail info
      if (this.config.verbose) {
        console.log(`            🔍 DEBUG: Splitting trail ${trailId} (${trail.name})`);
        console.log(`            🔍 DEBUG: Trail length: ${trail.geometry ? 'valid' : 'invalid'}`);
        console.log(`            🔍 DEBUG: Split point: ${JSON.stringify(splitPoint)}`);
      }

      // Single robust splitting method using ST_LineSubstring
      let splitSegments = null;

      try {
        // Calculate the split ratio using ST_LineLocatePoint
        const ratioQuery = `
          SELECT 
            ST_LineLocatePoint(geometry, ST_GeomFromGeoJSON('${JSON.stringify(splitPoint)}')) as split_ratio,
            ST_Length(geometry::geography) as trail_length
          FROM ${this.config.stagingSchema}.trails 
          WHERE app_uuid = $1
        `;
        
        const ratioResult = await client.query(ratioQuery, [trailId]);
        
        if (ratioResult.rows.length === 0) {
          throw new Error('Trail not found for ratio calculation');
        }
        
        const splitRatio = ratioResult.rows[0].split_ratio;
        const trailLength = ratioResult.rows[0].trail_length;
        
        if (this.config.verbose) {
          console.log(`            🔍 DEBUG: Split ratio: ${splitRatio.toFixed(6)}, Trail length: ${trailLength.toFixed(2)}m`);
        }
        
        // Validate split point is at least 1 meter from either endpoint (fixed distance, not percentage)
        const distanceFromStart = splitRatio * trailLength;
        const distanceFromEnd = (1.0 - splitRatio) * trailLength;
        const minDistanceFromEnd = 1.0; // 1 meter from each endpoint
        
        if (distanceFromStart < minDistanceFromEnd || distanceFromEnd < minDistanceFromEnd) {
          throw new Error(`Split point too close to endpoint: ${distanceFromStart.toFixed(2)}m from start, ${distanceFromEnd.toFixed(2)}m from end (must be at least ${minDistanceFromEnd}m from each endpoint)`);
        }
        
        // Split the trail into two segments using ST_LineSubstring
        const splitQuery = `
          SELECT 
            ST_LineSubstring(geometry, 0.0, $2) as segment1,
            ST_LineSubstring(geometry, $2, 1.0) as segment2
          FROM ${this.config.stagingSchema}.trails 
          WHERE app_uuid = $1
        `;
        
        const splitResult = await client.query(splitQuery, [trailId, splitRatio]);
        
        if (splitResult.rows.length === 0) {
          throw new Error('Failed to split trail geometry');
        }
        
        const row = splitResult.rows[0];
        
        // Validate segments have sufficient length
        const segment1Length = await client.query(`SELECT ST_Length($1::geography) as length`, [row.segment1]);
        const segment2Length = await client.query(`SELECT ST_Length($1::geography) as length`, [row.segment2]);
        
        if (this.config.verbose) {
          console.log(`            🔍 DEBUG: Segment 1 length: ${segment1Length.rows[0].length.toFixed(2)}m`);
          console.log(`            🔍 DEBUG: Segment 2 length: ${segment2Length.rows[0].length.toFixed(2)}m`);
        }
        
        if (segment1Length.rows[0].length < 1.0 || segment2Length.rows[0].length < 1.0) {
          throw new Error('Split segments too short (minimum 1m each)');
        }
        
        // Create split segments array
        splitSegments = [
          { segment_geom: row.segment1, segment_path: [1] },
          { segment_geom: row.segment2, segment_path: [2] }
        ];
        
        if (this.config.verbose) {
          console.log(`            🔍 DEBUG: Successfully split trail into ${splitSegments.length} segments`);
        }
        
      } catch (error: any) {
        if (this.config.verbose) {
          console.log(`            🔍 DEBUG: Split failed: ${error.message}`);
        }
        await client.query('ROLLBACK');
        return { success: false, error: `Split failed: ${error.message}` };
      }

      if (!splitSegments || splitSegments.length < 2) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Could not split trail into multiple segments' };
      }

      // Delete original trail
      await client.query(`DELETE FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1`, [trailId]);

      // Insert split segments
      for (let i = 0; i < splitSegments.length; i++) {
        const segment = splitSegments[i];
        const newName = `${trail.name} (Split ${i + 1})`;

        // Calculate length_km for the segment
        const lengthResult = await client.query(`
          SELECT ST_Length($1::geography) / 1000.0 as length_km
        `, [segment.segment_geom]);
        
        const lengthKm = lengthResult.rows[0].length_km;

        await client.query(`
          INSERT INTO ${this.config.stagingSchema}.trails (app_uuid, name, trail_type, geometry, length_km)
          VALUES (gen_random_uuid(), $1, $2, $3, $4)
        `, [newName, trail.trail_type, segment.segment_geom, lengthKm]);
      }

      // Commit transaction
      await client.query('COMMIT');

      return { 
        success: true, 
        message: `Split into ${splitSegments.length} segments`,
        segments: splitSegments
      };

    } catch (error: any) {
      // Rollback on any error
      await client.query('ROLLBACK');
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Create a connector trail - EXACT logic from prototype
   */
  private async createConnector(visitingTrailId: string, startPoint: any, endPoint: any, caseName: string): Promise<{ success: boolean; connectorId?: string; error?: string }> {
    const client = await this.pgClient.connect();
    
    try {
      // Start transaction
      await client.query('BEGIN');

      const connectorName = `Y-Connector: ${caseName}`;
      
      // Calculate length_km for the connector
      const lengthResult = await client.query(`
        SELECT ST_Length(ST_MakeLine($1, $2)::geography) / 1000.0 as length_km
      `, [startPoint, endPoint]);
      
      const lengthKm = lengthResult.rows[0].length_km;
      
      const result = await client.query(`
        INSERT INTO ${this.config.stagingSchema}.trails (app_uuid, name, trail_type, geometry, length_km)
        VALUES (gen_random_uuid(), $1, $2, ST_MakeLine($3, $4), $5)
        RETURNING app_uuid
      `, [
        connectorName,
        'connector',
        startPoint,
        endPoint,
        lengthKm
      ]);
      
      const connectorId = result.rows[0].app_uuid;

      // Commit transaction
      await client.query('COMMIT');

      return { success: true, connectorId };

    } catch (error: any) {
      // Rollback on any error
      await client.query('ROLLBACK');
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Validate the splitting operation
   */
  async validateSplitting(): Promise<ValidationResult> {
    try {
      const result = await this.pgClient.query(`
        SELECT COUNT(*) as count 
        FROM ${this.config.stagingSchema}.trails 
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) > 0
      `);

      const trailCount = parseInt(result.rows[0].count);

      return {
        isValid: trailCount > 0,
        trailCount,
        errors: []
      };
    } catch (error: any) {
      return {
        isValid: false,
        trailCount: 0,
        errors: [`Validation failed: ${error.message}`]
      };
    }
  }

  /**
   * Export trails as GeoJSON for debugging - same as prototype
   */
  async exportTrailsAsGeoJSON(description: string = 'Processed trails'): Promise<any> {
    const result = await this.pgClient.query(`
      SELECT 
        app_uuid,
        name,
        trail_type,
        ST_AsGeoJSON(ST_Transform(geometry, 4326))::json as geometry,
        ST_Length(geometry::geography) as length_meters
      FROM ${this.config.stagingSchema}.trails
      ORDER BY name
    `);

    const features = result.rows.map(row => ({
      type: "Feature",
      properties: {
        id: row.app_uuid,
        name: row.name || 'Unnamed Trail',
        trail_type: row.trail_type,
        length_meters: Math.round(row.length_meters * 100) / 100
      },
      geometry: row.geometry
    }));

    return {
      type: "FeatureCollection",
      description: description,
      features: features
    };
  }
}
