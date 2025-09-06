import { Pool, PoolClient } from 'pg';
import { TrailSplitManager, SplitCoordinate } from '../../utils/TrailSplitManager';
import { CentralizedTrailSplitManager, CentralizedSplitConfig } from '../../utils/services/network-creation/centralized-trail-split-manager';

export interface StandaloneTrailSplittingConfig {
  stagingSchema: string;
  intersectionTolerance: number;
  minSegmentLength: number;
  minTrailLength?: number; // Minimum trail length in meters to process (default: 1000m = 1km)
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
  private splitManager: TrailSplitManager;
  private centralizedManager: CentralizedTrailSplitManager;

  constructor(pgClient: Pool, config: StandaloneTrailSplittingConfig) {
    this.pgClient = pgClient;
    this.config = {
      ...config,
      minTrailLength: config.minTrailLength || 500 // Default to 0.5km if not specified
    };
    this.splitManager = TrailSplitManager.getInstance();
    
    // Initialize centralized split manager
    const centralizedConfig: CentralizedSplitConfig = {
      stagingSchema: config.stagingSchema,
      intersectionToleranceMeters: 3.0,
      minSegmentLengthMeters: 5.0,
      preserveOriginalTrailNames: true,
      validationToleranceMeters: 1.0,
      validationTolerancePercentage: 0.1
    };
    
    this.centralizedManager = CentralizedTrailSplitManager.getInstance(pgClient, centralizedConfig);
  }

  async splitTrailsAndReplace(): Promise<StandaloneTrailSplittingResult> {
    const startTime = Date.now();
    console.log('🔗 Starting standalone trail splitting service...');
    console.log(`   📍 Staging schema: ${this.config.stagingSchema}`);
    console.log(`   📏 Intersection tolerance: ${this.config.intersectionTolerance}m`);
    console.log(`   📏 Minimum segment length: ${this.config.minSegmentLength}m`);
    console.log(`   📏 Minimum trail length: ${this.config.minTrailLength}m`);

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

        for (const intersection of allIntersections) {
          // 🔧 FIXED LOGIC: Allow multiple splits of the same trail at different intersection points
          // Instead of skipping based on trail ID, we'll track processed intersection coordinates
          // This allows a trail to be split multiple times as long as the intersection points are >1m apart
          
          // Extract coordinates from the intersection point
          let intersectionCoords = null;
          if (intersection.split_point) {
            // Handle PostGIS geometry objects - extract coordinates safely
            try {
              if (intersection.split_point.coordinates) {
                // Direct coordinates property
                intersectionCoords = {
                  x: intersection.split_point.coordinates[0],
                  y: intersection.split_point.coordinates[1]
                };
              } else if (intersection.split_point.x !== undefined && intersection.split_point.y !== undefined) {
                // PostGIS point with x,y properties
                intersectionCoords = {
                  x: intersection.split_point.x,
                  y: intersection.split_point.y
                };
              } else {
                // Try to extract from PostGIS geometry string representation
                const geomStr = intersection.split_point.toString();
                const match = geomStr.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
                if (match) {
                  intersectionCoords = {
                    x: parseFloat(match[1]),
                    y: parseFloat(match[2])
                  };
                }
              }
            } catch (e) {
              if (this.config.verbose) {
                console.log(`         ⚠️  Warning: Could not extract coordinates from split_point:`, intersection.split_point);
              }
            }
          }
          
          // Check if this intersection point is within tolerance of any previously processed coordinate
          let isDuplicate = false;
          let duplicateReason = '';
          
          if (intersectionCoords) {
            // Check against all previously processed coordinates using TrailSplitManager
            const isDuplicateSplit = this.splitManager.isDuplicateSplit(
              intersection.visited_trail_uuid, 
              intersectionCoords
            );
            
            if (isDuplicateSplit) {
              isDuplicate = true;
              duplicateReason = `within ${this.splitManager.getTolerance()}m of existing split`;
            }
          }
          
          if (isDuplicate && intersectionCoords) {
            if (this.config.verbose) {
              console.log(`         ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (${duplicateReason}) at coords: [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}]`);
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
            
            // Store this intersection coordinate using TrailSplitManager
            if (intersectionCoords) {
              this.splitManager.recordSplit(
                intersection.visited_trail_uuid,
                intersection.visited_trail_name,
                intersectionCoords,
                'YIntersection',
                iteration
              );
              if (this.config.verbose) {
                console.log(`            📍 Stored intersection coordinate: [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}]`);
              }
            }
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
        // Use the same coordinate-based deduplication for true intersections

        for (const intersection of trueIntersections) {
          // Extract coordinates from the intersection point
          let intersectionCoords = null;
          if (intersection.split_point) {
            // Handle PostGIS geometry objects - extract coordinates safely
            try {
              if (intersection.split_point.coordinates) {
                // Direct coordinates property
                intersectionCoords = {
                  x: intersection.split_point.coordinates[0],
                  y: intersection.split_point.coordinates[1]
                };
              } else if (intersection.split_point.x !== undefined && intersection.split_point.y !== undefined) {
                // PostGIS point with x,y properties
                intersectionCoords = {
                  x: intersection.split_point.x,
                  y: intersection.split_point.y
                };
              } else {
                // Try to extract from PostGIS geometry string representation
                const geomStr = intersection.split_point.toString();
                const match = geomStr.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
                if (match) {
                  intersectionCoords = {
                    x: parseFloat(match[1]),
                    y: parseFloat(match[2])
                  };
                }
              }
            } catch (e) {
              if (this.config.verbose) {
                console.log(`      ⚠️  Warning: Could not extract coordinates from split_point:`, intersection.split_point);
              }
            }
          }
          
          // Check if this intersection point is within tolerance of any previously processed coordinate
          let isDuplicate = false;
          let duplicateReason = '';
          
          if (intersectionCoords) {
            // Check against all previously processed coordinates using TrailSplitManager
            const isDuplicateSplit = this.splitManager.isDuplicateSplit(
              intersection.trail1_uuid, 
              intersectionCoords
            );
            
            if (isDuplicateSplit) {
              isDuplicate = true;
              duplicateReason = `within ${this.splitManager.getTolerance()}m of existing split`;
            }
          }
          
          if (isDuplicate && intersectionCoords) {
            if (this.config.verbose) {
              console.log(`      ⏭️  Skipping intersection: ${intersection.trail1_name} × ${intersection.trail2_name} (${duplicateReason}) at coords: [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}]`);
            }
            continue;
          }

          const result = await this.performTrueIntersectionFix(intersection);

          if (result.success) {
            if (this.config.verbose) {
              console.log(`      ✅ Fixed intersection: ${result.message}`);
            }
            intersectionProcessed++;
            
            // Store this intersection coordinate using TrailSplitManager
            if (intersectionCoords) {
              this.splitManager.recordSplit(
                intersection.trail1_uuid,
                intersection.trail1_name,
                intersectionCoords,
                'TrueIntersection',
                iteration
              );
              if (this.config.verbose) {
                console.log(`      📍 Stored intersection coordinate: [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}]`);
              }
            }
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
        
        // Log TrailSplitManager state
        console.log('   📍 TrailSplitManager State:');
        this.splitManager.logState();

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
          AND ST_Length(geometry::geography) >= $3
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
        WHERE (distance_from_start >= 1.0 AND distance_from_end >= 1.0)  -- True crossings (middle of trail)
           OR (distance_from_start < 1.0 OR distance_from_end < 1.0)    -- Touching intersections (endpoints)
        ORDER BY visiting_trail_id, visited_trail_id, distance_meters
      )
      SELECT * FROM best_matches
      ORDER BY distance_meters
      -- No limit - process all intersections
    `;

    const result = await this.pgClient.query(query, [
      this.config.minSegmentLength,
      this.config.intersectionTolerance,
      this.config.minTrailLength || 500
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
          AND ST_Length(t1.geometry::geography) >= $2
          AND ST_Length(t2.geometry::geography) >= $2
          AND ST_IsValid(t1.geometry)
          AND ST_IsValid(t2.geometry)
          AND ST_Intersects(t1.geometry, t2.geometry)  -- Only trails that actually intersect
          AND ST_Crosses(t1.geometry, t2.geometry)     -- Only true crossings (X-intersections)
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
        WHERE ST_GeometryType(dump.geom) IN ('ST_Point', 'ST_MultiPoint')
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
          -- For MultiPoint intersections, we'll handle validation in the application logic
          -- since ST_LineLocatePoint doesn't work well with MultiPoint geometries
          CASE 
            WHEN ST_GeometryType(intersection_point) = 'ST_Point' THEN
              ST_LineLocatePoint(trail1_geom, intersection_point)
            ELSE NULL
          END as trail1_split_ratio,
          CASE 
            WHEN ST_GeometryType(intersection_point) = 'ST_Point' THEN
              ST_LineLocatePoint(trail2_geom, intersection_point)
            ELSE NULL
          END as trail2_split_ratio,
          -- Calculate distances from endpoints to ensure we're not too close
          CASE 
            WHEN ST_GeometryType(intersection_point) = 'ST_Point' THEN
              ST_Length(ST_LineSubstring(trail1_geom, 0.0, ST_LineLocatePoint(trail1_geom, intersection_point)))
            ELSE NULL
          END as trail1_distance_from_start,
          CASE 
            WHEN ST_GeometryType(intersection_point) = 'ST_Point' THEN
              ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point)))
            ELSE NULL
          END as trail2_distance_from_start,
          -- Check if this is a T-intersection (one trail ends at the intersection point)
          CASE 
            WHEN ST_GeometryType(intersection_point) = 'ST_Point' THEN
              (ST_LineLocatePoint(trail1_geom, intersection_point) = 0.0 OR ST_LineLocatePoint(trail1_geom, intersection_point) = 1.0 OR
               ST_LineLocatePoint(trail2_geom, intersection_point) = 0.0 OR ST_LineLocatePoint(trail2_geom, intersection_point) = 1.0)
            ELSE false
          END as is_t_intersection
        FROM intersection_points
        WHERE 
          -- For Point intersections, validate split ratios
          -- For MultiPoint intersections, we'll validate in the application logic
          (ST_GeometryType(intersection_point) = 'ST_Point' AND
           ST_LineLocatePoint(trail1_geom, intersection_point) > 0.0 
           AND ST_LineLocatePoint(trail1_geom, intersection_point) < 1.0
           AND ST_LineLocatePoint(trail2_geom, intersection_point) > 0.0 
           AND ST_LineLocatePoint(trail2_geom, intersection_point) < 1.0)
          OR
          -- Accept all MultiPoint intersections for now - we'll validate individual points in the app
          ST_GeometryType(intersection_point) = 'ST_MultiPoint'
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

    const result = await this.pgClient.query(query, [this.config.minSegmentLength, this.config.minTrailLength || 500]);
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

      return { 
        success: true, 
        message: `Extended ${intersection.visiting_trail_name} to meet ${intersection.visited_trail_name} and split visited trail (${intersection.distance_meters.toFixed(2)}m)`
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

      // Check if this is a MultiPoint intersection
      const isMultiPoint = intersection.intersection_point_json && 
                          intersection.intersection_point_json.type === 'MultiPoint';

      if (isMultiPoint) {
        if (this.config.verbose) {
          console.log(`            🔍 DEBUG: Using MultiPoint splitting for ${intersection.trail1_name} and ${intersection.trail2_name}`);
        }

        // Use MultiPoint splitting for both trails
        const splitResult1 = await this.splitTrailAtMultiPointIntersection(
          this.pgClient, 
          intersection.trail1_id, 
          intersection.intersection_point_json, 
          intersection.trail1_name
        );
        
        if (!splitResult1.success) {
          return { success: false, error: `Trail1 MultiPoint split failed` };
        }

        const splitResult2 = await this.splitTrailAtMultiPointIntersection(
          this.pgClient, 
          intersection.trail2_id, 
          intersection.intersection_point_json, 
          intersection.trail2_name
        );
        
        if (!splitResult2.success) {
          return { success: false, error: `Trail2 MultiPoint split failed` };
        }

        return { 
          success: true, 
          message: `Split both trails at MultiPoint intersection (${splitResult1.segmentsCreated} + ${splitResult2.segmentsCreated} segments created)`
        };
      } else {
        // Single point intersection - use regular splitting
        const splitResult1 = await this.splitTrail(intersection.trail1_id, intersection.intersection_point_json);
        
        if (!splitResult1.success) {
          return { success: false, error: `Trail1 split failed: ${splitResult1.error}` };
        }

        const splitResult2 = await this.splitTrail(intersection.trail2_id, intersection.intersection_point_json);
        
        if (!splitResult2.success) {
          return { success: false, error: `Trail2 split failed: ${splitResult2.error}` };
        }

        return { 
          success: true, 
          message: `Split both trails at intersection point (${intersection.trail1_distance_from_start.toFixed(2)}m, ${intersection.trail2_distance_from_start.toFixed(2)}m)`
        };
      }

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Snap a trail endpoint to a specific point - IMPROVED coordinate-based approach
   */
  private async snapTrailEndpoint(trailId: string, endpoint: any, snapPoint: any): Promise<{ success: boolean; message?: string; error?: string }> {
    const client = await this.pgClient.connect();
    
    try {
      // Start transaction
      await client.query('BEGIN');

      // 🔧 IMPROVED LOGIC: Find the actual trail at the endpoint coordinates
      // Instead of relying on UUID, use geometry intersection to find the trail
      const actualTrail = await this.findTrailAtCoordinates(endpoint, 5.0);
      
      if (!actualTrail) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Trail not found at endpoint coordinates' };
      }

      // Use the found trail instead of the original UUID
      const trail = actualTrail;
      
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
      `, [trail.app_uuid]);
      
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
      
      // Update the trail geometry using the found trail's UUID
      await client.query(`
        UPDATE ${this.config.stagingSchema}.trails 
        SET geometry = ${newGeometry}
        WHERE app_uuid = $1
      `, [trail.app_uuid]);
      
      await client.query('COMMIT');
      return { 
        success: true, 
        message: `Snapped ${isStartPoint ? 'start' : 'end'} point of trail ${trail.name} (${trail.app_uuid})`
      };
      
    } catch (error: any) {
      await client.query('ROLLBACK');
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Find a trail at specific coordinates using geometry intersection
   * Handles both PostGIS geometry objects and coordinate arrays
   */
  private async findTrailAtCoordinates(coordinates: any, toleranceMeters: number = 1.0): Promise<any | null> {
    try {
      // Determine if coordinates is already a PostGIS geometry or needs conversion
      let geometryParam: string;
      let geometryValue: any;
      
      if (typeof coordinates === 'string' && coordinates.startsWith('0101')) {
        // Already a PostGIS geometry (WKB hex string)
        geometryParam = '$1::geometry';
        geometryValue = coordinates;
      } else if (typeof coordinates === 'object' && coordinates.type === 'Point') {
        // GeoJSON Point object
        geometryParam = 'ST_GeomFromGeoJSON($1)';
        geometryValue = JSON.stringify(coordinates);
      } else if (Array.isArray(coordinates) && coordinates.length === 2) {
        // Simple [lng, lat] array
        geometryParam = 'ST_GeomFromText($1, 4326)';
        geometryValue = `POINT(${coordinates[0]} ${coordinates[1]})`;
      } else {
        // Try as GeoJSON string
        geometryParam = 'ST_GeomFromGeoJSON($1)';
        geometryValue = JSON.stringify(coordinates);
      }
      
      // First try exact intersection
      const exactQuery = `
        SELECT * FROM ${this.config.stagingSchema}.trails 
        WHERE ST_Intersects(geometry, ${geometryParam})
        AND geometry IS NOT NULL
        LIMIT 1
      `;
      
      const exactResult = await this.pgClient.query(exactQuery, [geometryValue]);
      
      if (exactResult.rows.length > 0) {
        return exactResult.rows[0];
      }
      
      // If no exact intersection, try with buffer tolerance
      const bufferedQuery = `
        SELECT * FROM ${this.config.stagingSchema}.trails 
        WHERE ST_DWithin(geometry, ${geometryParam}, $2)
        AND geometry IS NOT NULL
        ORDER BY ST_Distance(geometry, ${geometryParam})
        LIMIT 1
      `;
      
      const bufferedResult = await this.pgClient.query(bufferedQuery, [geometryValue, toleranceMeters]);
      
      if (bufferedResult.rows.length > 0) {
        return bufferedResult.rows[0];
      }
      
      return null;
         } catch (error: any) {
       if (this.config.verbose) {
         console.log(`         ⚠️  Warning: Error finding trail at coordinates: ${error.message}`);
         console.log(`         📍 Coordinates type: ${typeof coordinates}, value: ${JSON.stringify(coordinates)}`);
       }
       return null;
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

      // 🔧 IMPROVED LOGIC: Find the actual trail at the split coordinates
      // Instead of relying on potentially stale UUID, use geometry intersection to find the trail
      const actualTrail = await this.findTrailAtCoordinates(splitPoint, 5.0);

      if (!actualTrail) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Trail not found at split coordinates' };
      }

      // Use the found trail instead of the original UUID
      const trail = actualTrail;
      
      // Debug: Log trail info
      if (this.config.verbose) {
        console.log(`            🔍 DEBUG: Splitting trail ${trail.app_uuid} (${trail.name}) at coordinates [${splitPoint.x?.toFixed(6) || 'unknown'}, ${splitPoint.y?.toFixed(6) || 'unknown'}]`);
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
        
        const ratioResult = await client.query(ratioQuery, [trail.app_uuid]);
        
        if (ratioResult.rows.length === 0) {
          throw new Error('Trail not found for ratio calculation');
        }
        
        const splitRatio = ratioResult.rows[0].split_ratio;
        const trailLength = ratioResult.rows[0].trail_length;
        
        if (this.config.verbose) {
          console.log(`            🔍 DEBUG: Split ratio: ${splitRatio.toFixed(6)}, Trail length: ${trailLength.toFixed(2)}m`);
        }
        
        // Allow all split points - endpoint distance validation removed
        const distanceFromStart = splitRatio * trailLength;
        const distanceFromEnd = (1.0 - splitRatio) * trailLength;
        
        if (this.config.verbose) {
          console.log(`            🔍 DEBUG: Distance from start: ${distanceFromStart.toFixed(2)}m, Distance from end: ${distanceFromEnd.toFixed(2)}m`);
        }
        
        // Split the trail into two segments using ST_LineSubstring
        const splitQuery = `
          SELECT 
            ST_LineSubstring(geometry, 0.0, $2) as segment1,
            ST_LineSubstring(geometry, $2, 1.0) as segment2
          FROM ${this.config.stagingSchema}.trails 
          WHERE app_uuid = $1
        `;
        
        const splitResult = await client.query(splitQuery, [trail.app_uuid, splitRatio]);
        
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
        
        // Allow all segment lengths - minimum length validation removed
        // if (segment1Length.rows[0].length < 1.0 || segment2Length.rows[0].length < 1.0) {
        //   throw new Error('Split segments too short (minimum 1m each)');
        // }
        
        // Create split segments array, filtering out 0-length segments
        splitSegments = [];
        
        // Only add segments that have length > 0 (avoid Point geometries)
        if (segment1Length.rows[0].length > 0) {
          splitSegments.push({ segment_geom: row.segment1, segment_path: [1] });
        }
        if (segment2Length.rows[0].length > 0) {
          splitSegments.push({ segment_geom: row.segment2, segment_path: [2] });
        }
        
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

      if (!splitSegments || splitSegments.length < 1) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Could not create valid segments from split' };
      }

      // Delete original trail
      await client.query(`DELETE FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1`, [trail.app_uuid]);

      // Insert split segments
      for (let i = 0; i < splitSegments.length; i++) {
        const segment = splitSegments[i];
        const newName = `${trail.name} (Split ${i + 1})`;

        // Calculate length_km for the segment
        const lengthResult = await client.query(`
          SELECT ST_Length($1::geography) / 1000.0 as length_km
        `, [segment.segment_geom]);
        
        const lengthKm = lengthResult.rows[0].length_km;

        // Use centralized manager to insert trail with proper original_trail_uuid
        await this.centralizedManager.insertTrail(
          {
            name: newName,
            trail_type: trail.trail_type,
            geometry: segment.segment_geom,
            length_km: lengthKm
          },
          'StandaloneTrailSplittingService',
          true, // isReplacementTrail
          trail.app_uuid // originalTrailId
        );
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

  /**
   * Enhanced splitting for MultiPoint intersections - splits trail at multiple intersection points
   * This handles cases where trails cross at multiple locations (like Foothills North ↔ North Sky)
   */
  private async splitTrailAtMultiPointIntersection(
    client: any,
    trailId: string,
    multiPointIntersection: any,
    trailName: string
  ): Promise<{ success: boolean; segmentsCreated: number }> {
    try {
      console.log(`         🔍 DEBUG: Processing MultiPoint intersection for ${trailName}`);
      
      // Get the original trail
      const trailResult = await client.query(`
        SELECT app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km
        FROM ${this.config.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trailId]);

      if (trailResult.rows.length === 0) {
        console.log(`         🔍 DEBUG: Trail ${trailName} not found`);
        return { success: false, segmentsCreated: 0 };
      }

      const trail = trailResult.rows[0];
      const currentLength = parseFloat(trail.length_km) * 1000; // Convert to meters

      // Check if trail is too short
      if (this.config.minTrailLength && currentLength < this.config.minTrailLength) {
        console.log(`         🔍 DEBUG: Trail length: too short (${currentLength.toFixed(2)}m < ${this.config.minTrailLength}m)`);
        return { success: false, segmentsCreated: 0 };
      }

      console.log(`         🔍 DEBUG: Trail length: valid (${currentLength.toFixed(2)}m)`);
      console.log(`         🔍 DEBUG: MultiPoint intersection: ${JSON.stringify(multiPointIntersection)}`);

      // Extract individual points from MultiPoint intersection
      const pointsResult = await client.query(`
        SELECT (ST_Dump($1)).geom as point, (ST_Dump($1)).path[1] as point_index
        FROM (SELECT $1 as geom) as dump_table
        ORDER BY point_index
      `, [multiPointIntersection]);

      if (pointsResult.rows.length === 0) {
        console.log(`         🔍 DEBUG: No intersection points found in MultiPoint`);
        return { success: false, segmentsCreated: 0 };
      }

      console.log(`         🔍 DEBUG: Found ${pointsResult.rows.length} intersection points`);

      // Sort intersection points by their position along the trail
      const intersectionPoints = await Promise.all(
        pointsResult.rows.map(async (row: any) => {
          const point = row.point;
          const pointIndex = row.point_index;
          
          // Find the closest point on the trail to this intersection point
          const closestPointResult = await client.query(`
            SELECT ST_LineLocatePoint($1, $2) as ratio
          `, [trail.geometry, point]);
          
          const ratio = parseFloat(closestPointResult.rows[0].ratio);
          
          return {
            point,
            pointIndex,
            ratio,
            distance: Math.abs(ratio - 0.5) // Distance from center (for sorting)
          };
        })
      );

      // Sort by position along trail (start to end)
      intersectionPoints.sort((a, b) => a.ratio - b.ratio);

      console.log(`         🔍 DEBUG: Sorted intersection points: ${intersectionPoints.map(p => `${p.ratio.toFixed(4)}`).join(', ')}`);

      // Split trail at each intersection point
      let splitSegments: any[] = [];
      let lastRatio = 0.0;

      for (let i = 0; i < intersectionPoints.length; i++) {
        const intersection = intersectionPoints[i];
        const currentRatio = intersection.ratio;

        // Validate split ratio (must be between last split and current position)
        // Also ensure we're not at the very endpoints (0.0 or 1.0)
        if (currentRatio > lastRatio + 0.001 && currentRatio > 0.001 && currentRatio < 0.999) {
          // Create segment from last split point to current intersection
          const segmentResult = await client.query(`
            SELECT ST_LineSubstring($1, $2, $3) as segment
          `, [trail.geometry, lastRatio, currentRatio]);

          if (segmentResult.rows.length > 0) {
            const segment = segmentResult.rows[0].segment;
            const segmentLength = await client.query(`
              SELECT ST_Length($1::geography) as length_m
            `, [segment]);

            const lengthM = parseFloat(segmentLength.rows[0].length_m);
            
            // Only keep segments that are long enough
            if (lengthM > this.config.minSegmentLength) {
              splitSegments.push({
                geometry: segment,
                length: lengthM,
                startRatio: lastRatio,
                endRatio: currentRatio
              });
            }
          }
        }

        lastRatio = currentRatio;
      }

      // Add final segment from last intersection to end of trail
      if (lastRatio < 0.999) {
        const finalSegmentResult = await client.query(`
          SELECT ST_LineSubstring($1, $2, 1.0) as segment
        `, [trail.geometry, lastRatio]);

        if (finalSegmentResult.rows.length > 0) {
          const segment = finalSegmentResult.rows[0].segment;
          const segmentLength = await client.query(`
            SELECT ST_Length($1::geography) as length_m
          `, [segment]);

          const lengthM = parseFloat(segmentLength.rows[0].length_m);
          
          if (lengthM > this.config.minSegmentLength) {
            splitSegments.push({
              geometry: segment,
              length: lengthM,
              startRatio: lastRatio,
              endRatio: 1.0
            });
          }
        }
      }

      // Add initial segment from start to first intersection if it exists
      if (intersectionPoints.length > 0 && intersectionPoints[0].ratio > 0.001) {
        const firstRatio = intersectionPoints[0].ratio;
        const initialSegmentResult = await client.query(`
          SELECT ST_LineSubstring($1, 0.0, $2) as segment
        `, [trail.geometry, firstRatio]);

        if (initialSegmentResult.rows.length > 0) {
          const segment = initialSegmentResult.rows[0].segment;
          const segmentLength = await client.query(`
            SELECT ST_Length($1::geography) as length_m
          `, [segment]);

          const lengthM = parseFloat(segmentLength.rows[0].length_m);
          
          if (lengthM > this.config.minSegmentLength) {
            splitSegments.unshift({
              geometry: segment,
              length: lengthM,
              startRatio: 0.0,
              endRatio: firstRatio
            });
          }
        }
      }

      console.log(`         🔍 DEBUG: Created ${splitSegments.length} split segments`);

      // Insert split segments (children)
      let segmentsCreated = 0;
      for (let i = 0; i < splitSegments.length; i++) {
        const segment = splitSegments[i];
        
        await client.query(`
          INSERT INTO ${this.config.stagingSchema}.trails (
            app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
          )
        `, [
          trail.name, // Keep original name as requested
          trail.trail_type,
          trail.surface,
          trail.difficulty,
          trail.source,
          segment.geometry,
          segment.length / 1000.0
        ]);
        segmentsCreated++;
        
        console.log(`         🔍 DEBUG: Created segment ${i + 1}: ${(segment.length / 1000.0).toFixed(3)}km (${segment.startRatio.toFixed(4)} to ${segment.endRatio.toFixed(4)})`);
      }

      console.log(`         🔍 DEBUG: Successfully created ${segmentsCreated} child segments from MultiPoint intersection`);
      return { success: true, segmentsCreated };

    } catch (error) {
      console.error(`         🔍 DEBUG: Error in splitTrailAtMultiPointIntersection: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, segmentsCreated: 0 };
    }
  }
}
