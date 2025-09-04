import { Pool } from 'pg';
import { TrailSplitManager } from '../../utils/TrailSplitManager';

export interface YIntersectionSplittingResult {
  trailsProcessed: number;
  segmentsCreated: number;
  originalTrailsDeleted: number;
  intersectionCount: number;
  iterations: number;
}

export class YIntersectionSplittingService {
  private splitManager: TrailSplitManager;

  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config?: any
  ) {
    this.splitManager = TrailSplitManager.getInstance();
  }

  /**
   * Apply Y-intersection splitting using the proven prototype logic
   * This extends visiting trail endpoints to split points instead of creating separate connectors
   */
  async applyYIntersectionSplitting(): Promise<YIntersectionSplittingResult> {
    console.log('🔗 Applying Y-intersection splitting (prototype logic)...');
    
    const client = await this.pgClient.connect();
    const tolerance = this.config?.toleranceMeters || 10; // Use 10m tolerance like our successful prototype
    const minTrailLengthMeters = this.config?.minTrailLengthMeters || 5;
    const minSnapDistanceMeters = this.config?.minSnapDistanceMeters || 1.0; // Skip already-connected trails
    const maxIterations = this.config?.maxIterations || 10;
    
    try {
      let iteration = 1;
      let totalProcessed = 0;
      let hasMoreIntersections = true;
      let totalIntersectionsFound = 0;

      while (hasMoreIntersections && iteration <= maxIterations) {
        console.log(`   🔄 Iteration ${iteration}/${maxIterations}:`);

        // Find all potential Y-intersections
        const intersections = await this.findYIntersections(client, tolerance, minTrailLengthMeters);
        
        if (intersections.length === 0) {
          console.log(`   ✅ No more Y-intersections found after ${iteration} iterations`);
          hasMoreIntersections = false;
          break;
        }

        // Count intersection types
        const yIntersections = intersections.filter(i => i.intersection_type === 'y_intersection').length;
        const trueCrossings = intersections.filter(i => i.intersection_type === 'true_crossing').length;
        
        console.log(`   🔍 Found ${intersections.length} total intersections:`);
        console.log(`      - Y-intersections (endpoints): ${yIntersections}`);
        console.log(`      - True crossings (ST_Crosses): ${trueCrossings}`);
        
        // 🔍 ENHANCED LOGGING: Check if our debug trails are in this iteration
        const debugTrailsInIteration = intersections.filter(row => 
          row.visiting_trail_name.includes('Foothills North Trail') || 
          row.visiting_trail_name.includes('North Sky Trail') ||
          row.visited_trail_name.includes('Foothills North Trail') || 
          row.visited_trail_name.includes('North Sky Trail')
        );
        
        if (debugTrailsInIteration.length > 0) {
          console.log(`   🔍 DEBUG ITERATION ${iteration}: Found ${debugTrailsInIteration.length} debug trail intersections:`);
          debugTrailsInIteration.forEach((trail, i) => {
            console.log(`      ${i + 1}. ${trail.visiting_trail_name} ↔ ${trail.visited_trail_name} (${trail.intersection_type}, ${trail.distance_meters.toFixed(2)}m)`);
          });
        } else {
          console.log(`   🔍 DEBUG ITERATION ${iteration}: ❌ NO debug trail intersections found in this iteration`);
        }
        
        totalIntersectionsFound += intersections.length;

        let iterationProcessed = 0;
        const processedIntersections = new Set(); // Track intersection coordinates processed in this iteration to avoid duplicates

        for (const intersection of intersections) {
          // 🔍 ENHANCED LOGGING: Check if our debug trails are being skipped
          const isDebugTrail = intersection.visited_trail_name.includes('Foothills North Trail') || 
                               intersection.visited_trail_name.includes('North Sky Trail') ||
                               intersection.visiting_trail_name.includes('Foothills North Trail') || 
                               intersection.visiting_trail_name.includes('North Sky Trail');
          
          // 🔧 FIXED LOGIC: Allow multiple splits of the same trail in the same iteration
          // Instead of skipping based on trail ID, we'll track processed intersection coordinates
          // This allows a trail to be split multiple times at different intersection points
          
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
              console.log(`      ⚠️  Warning: Could not extract coordinates from split_point:`, intersection.split_point);
            }
          }
          
          // Check if this intersection point is within 1 meter of any previously processed coordinate
          let isDuplicate = false;
          let duplicateReason = '';
          
          if (intersectionCoords) {
            // Check against previously processed coordinates for this specific trail only
            const isDuplicateSplit = this.splitManager.isDuplicateSplit(
              intersection.visited_trail_uuid, 
              intersectionCoords
            );
            
            if (isDuplicateSplit) {
              isDuplicate = true;
              duplicateReason = `within ${this.splitManager.getTolerance()}m of existing split for this trail`;
            }
            
            if (isDebugTrail) {
              console.log(`      🔍 DEBUG TRAIL-SPECIFIC CHECK: Checking [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}] for trail ${intersection.visited_trail_name}`);
              if (isDuplicate) {
                console.log(`         ❌ DUPLICATE DETECTED: ${duplicateReason}`);
              } else {
                console.log(`         ✅ UNIQUE: No splits within ${this.splitManager.getTolerance()}m for this trail, proceeding with split`);
              }
            }
          }
          
          if (isDuplicate) {
            if (intersectionCoords) {
              console.log(`      ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (${duplicateReason}) at coords: [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}]`);
              
              if (isDebugTrail) {
                console.log(`      🔍 DEBUG SKIP: Debug trail intersection was skipped due to proximity to existing split!`);
                console.log(`         Intersection coordinates: [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}]`);
                console.log(`         ${duplicateReason}`);
                console.log(`         Distance: ${intersection.distance_meters.toFixed(3)}m`);
              }
            }
            continue;
          }

          try {
            const success = await this.processYIntersection(client, intersection, minSnapDistanceMeters);
            if (success) {
              iterationProcessed++;
              totalProcessed++;
              
              // Record this split for this specific trail to avoid duplicates within tolerance
              if (intersectionCoords) {
                this.splitManager.recordSplit(
                  intersection.visited_trail_uuid,
                  intersection.visited_trail_name,
                  intersectionCoords,
                  'YIntersection',
                  iteration
                );
                console.log(`      📍 Recorded split for trail ${intersection.visited_trail_name}: [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}]`);
              }
              
              // 🔍 ENHANCED LOGGING: Show when debug trails are marked as processed
              if (isDebugTrail) {
                console.log(`      🔍 DEBUG PROCESSED: Debug trail intersection was successfully processed and marked as processed!`);
                if (intersectionCoords) {
                  console.log(`         Intersection coordinates: [${intersectionCoords.x.toFixed(6)}, ${intersectionCoords.y.toFixed(6)}] recorded for this trail`);
                }
                console.log(`         Distance: ${intersection.distance_meters.toFixed(3)}m`);
                console.log(`         Note: Trail can still be split at other intersection points as long as they're >1m apart`);
                console.log(`         Split point type: ${intersection.split_point ? typeof intersection.split_point : 'null'}`);
                console.log(`         Split point: ${intersection.split_point}`);
              }
            }
          } catch (error) {
            console.error(`   ❌ Error processing intersection: ${error}`);
          }
        }

        console.log(`   📊 Iteration ${iteration}: processed ${iterationProcessed} Y-intersections`);
        
        // 🔍 ENHANCED LOGGING: Show split manager state for debug trails
        if (this.splitManager.getSplitStats().totalSplits > 0) {
          console.log(`   🔍 DEBUG SPLIT MANAGER: ${this.splitManager.getSplitStats().totalSplits} total splits recorded across ${this.splitManager.getSplitStats().totalTrails} trails`);
          console.log(`      Note: New intersections within ${this.splitManager.getTolerance()}m of existing splits for the same trail will be skipped as duplicates`);
        }
        
        if (iterationProcessed === 0) {
          hasMoreIntersections = false;
        }
        
        iteration++;
      }

      console.log(`📊 Total successfully processed: ${totalProcessed} Y-intersections`);

      return {
        trailsProcessed: totalProcessed,
        segmentsCreated: totalProcessed, // Each Y-intersection creates one extended trail
        originalTrailsDeleted: 0, // We extend trails, not delete them
        intersectionCount: totalIntersectionsFound,
        iterations: iteration - 1
      };

    } finally {
      client.release();
    }
  }

  /**
   * Find ALL types of intersections: Y-intersections (endpoints) AND true crossings (ST_Crosses)
   * This ensures we detect both shared endpoints and mid-trail crossings in each iteration
   */
  private async findYIntersections(client: any, toleranceMeters: number, minTrailLengthMeters: number): Promise<any[]> {
    console.log(`   🔍 Finding ALL intersections with ${toleranceMeters}m tolerance...`);
    
    // Log specific trails we're looking for
    console.log(`   🔍 Looking for specific trails: "North Sky Trail", "Foothills North Trail"`);
    
    // 🔍 ENHANCED LOGGING: Check if our debug trails exist in the staging schema
    const debugTrailsCheck = await client.query(`
      SELECT app_uuid, name, ST_Length(geometry::geography) as length_m
      FROM ${this.stagingSchema}.trails
      WHERE name LIKE '%Foothills North Trail%' OR name LIKE '%North Sky Trail%'
      ORDER BY name
    `);
    
    if (debugTrailsCheck.rows.length > 0) {
      console.log(`   🔍 DEBUG TRAILS: Found ${debugTrailsCheck.rows.length} debug trails in staging schema:`);
      debugTrailsCheck.rows.forEach(trail => {
        console.log(`      - ${trail.name} (${trail.app_uuid}): ${(trail.length_m / 1000).toFixed(3)}km`);
      });
    } else {
      console.log(`   🔍 DEBUG TRAILS: ❌ NO debug trails found in staging schema!`);
    }

    const result = await client.query(`
      WITH trail_endpoints AS (
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          geometry as trail_geom,
          ST_StartPoint(geometry) as end_point,
          'start' as endpoint_type
        FROM ${this.stagingSchema}.trails
        WHERE ST_Length(geometry::geography) > $1
        
        UNION ALL
        
        SELECT 
          app_uuid as trail_id,
          name as trail_name,
          geometry as trail_geom,
          ST_EndPoint(geometry) as end_point,
          'end' as endpoint_type
        FROM ${this.stagingSchema}.trails
        WHERE ST_Length(geometry::geography) > $1
      ),
      y_intersections AS (
        -- Y-intersections: trail endpoints close to other trails
        SELECT DISTINCT
          e1.trail_id as visiting_trail_id,
          e1.trail_name as visiting_trail_name,
          e1.end_point as visiting_endpoint,
          e1.endpoint_type,
          e2.trail_id as visited_trail_id,
          e2.trail_name as visited_trail_name,
          e2.trail_geom as visited_trail_geom,
          ST_Distance(e1.end_point::geography, e2.trail_geom::geography) as distance_meters,
          ST_ClosestPoint(e2.trail_geom, e1.end_point) as split_point,
          ST_LineLocatePoint(e2.trail_geom, e1.end_point) as split_ratio,
          'y_intersection' as intersection_type
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.trail_id != e2.trail_id
          AND ST_Distance(e1.end_point::geography, e2.trail_geom::geography) <= $2
          AND ST_Distance(e1.end_point::geography, e2.trail_geom::geography) > $3
      ),
      true_crossings AS (
        -- True crossings: trails that cross through each other (ST_Crosses)
        SELECT DISTINCT
          t1.app_uuid as visiting_trail_id,
          t1.name as visiting_trail_name,
          ST_Intersection(t1.geometry, t2.geometry) as visiting_endpoint,
          'crossing' as endpoint_type,
          t2.app_uuid as visited_trail_id,
          t2.name as visited_trail_name,
          t2.geometry as visited_trail_geom,
          0.0 as distance_meters,
          ST_Intersection(t1.geometry, t2.geometry) as split_point,
          0.5 as split_ratio, -- Split at the middle of the crossing
          'true_crossing' as intersection_type
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_Crosses(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) IN ('ST_Point', 'ST_MultiPoint')
          AND ST_Length(t1.geometry::geography) > $1
          AND ST_Length(t2.geometry::geography) > $1
      ),
      all_intersections AS (
        SELECT * FROM y_intersections
        UNION ALL
        SELECT * FROM true_crossings
      ),
      best_matches AS (
        SELECT DISTINCT ON (visiting_trail_id, visited_trail_id)
          visiting_trail_id,
          visiting_trail_name,
          visiting_endpoint,
          endpoint_type,
          visited_trail_id,
          visited_trail_name,
          visited_trail_geom as visited_geometry,
          distance_meters,
          split_point,
          split_ratio,
          intersection_type
        FROM all_intersections
        ORDER BY visiting_trail_id, visited_trail_id, distance_meters
      )
      SELECT * FROM best_matches
      ORDER BY distance_meters, intersection_type
      LIMIT 50
    `, [minTrailLengthMeters, toleranceMeters, 1.0]); // minSnapDistanceMeters = 1.0 to avoid already-connected trails

    console.log(`   🔍 Found ${result.rows.length} total intersections (Y-intersections + true crossings)`);
    
    // 🔍 ENHANCED LOGGING: Check if our debug trails are in the intersection list
    const debugTrails = result.rows.filter(row => 
      row.visiting_trail_name.includes('Foothills North Trail') || 
      row.visiting_trail_name.includes('North Sky Trail') ||
      row.visited_trail_name.includes('Foothills North Trail') || 
      row.visited_trail_name.includes('North Sky Trail')
    );
    
    if (debugTrails.length > 0) {
      console.log(`\n🔍 DEBUG INTERSECTIONS: Found ${debugTrails.length} intersections involving debug trails:`);
      debugTrails.forEach((trail, i) => {
        let coords = 'unknown';
        if (trail.split_point) {
          try {
            if (trail.split_point.coordinates) {
              coords = `[${trail.split_point.coordinates[0].toFixed(6)}, ${trail.split_point.coordinates[1].toFixed(6)}]`;
            } else if (trail.split_point.x !== undefined && trail.split_point.y !== undefined) {
              coords = `[${trail.split_point.x.toFixed(6)}, ${trail.split_point.y.toFixed(6)}]`;
            } else {
              coords = 'PostGIS geometry object';
            }
          } catch (e) {
            coords = 'error extracting coordinates';
          }
        }
        
        console.log(`   ${i + 1}. ${trail.visiting_trail_name} ↔ ${trail.visited_trail_name}`);
        console.log(`      Type: ${trail.intersection_type}, Distance: ${trail.distance_meters.toFixed(3)}m`);
        console.log(`      Coordinates: ${coords}`);
        console.log(`      Split point: ${trail.split_point ? 'Available' : 'Missing'}`);
      });
    } else {
      console.log(`\n🔍 DEBUG INTERSECTIONS: ❌ NO intersections found for Foothills North Trail or North Sky Trail!`);
      console.log(`   This suggests they're not being detected by our intersection logic.`);
      console.log(`   Checking if these trails exist in staging schema...`);
      
      // Let's check if these trails exist at all
      try {
        const trailCheck = await client.query(`
          SELECT app_uuid, name, ST_Length(geometry::geography) as length_m
          FROM ${this.stagingSchema}.trails
          WHERE name LIKE '%Foothills North Trail%' OR name LIKE '%North Sky Trail%'
          ORDER BY name
        `);
        
        if (trailCheck.rows.length > 0) {
          console.log(`   🔍 Found ${trailCheck.rows.length} debug trails in staging schema:`);
          trailCheck.rows.forEach(trail => {
            console.log(`      - ${trail.name} (${trail.length_m.toFixed(2)}m)`);
          });
        } else {
          console.log(`   ❌ No debug trails found in staging schema!`);
        }
      } catch (e) {
        console.log(`   ⚠️  Error checking for debug trails: ${e.message}`);
      }
    }
    
    return result.rows;
  }

  /**
   * Process a single Y-intersection with transaction safety
   * Pattern: extend visitor → split visited → delete parent → insert children
   */
  private async processYIntersection(client: any, intersection: any, minSnapDistanceMeters: number): Promise<boolean> {
    // Start transaction for atomic operation
    const transaction = await client.query('BEGIN');
    
    try {
      console.log(`      🔧 Processing: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`);

      // Skip if distance is too small (already connected)
      if (intersection.distance_meters < minSnapDistanceMeters) {
        console.log(`      ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (distance: ${intersection.distance_meters.toFixed(2)}m < ${minSnapDistanceMeters}m)`);
        await client.query('ROLLBACK');
        return false;
      }

      // Step 1: Detect - Verify both trails still exist
      const detectResult = await this.detectBothTrails(client, intersection);
      if (!detectResult.bothExist) {
        console.log(`      ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (trails no longer exist)`);
        await client.query('ROLLBACK');
        return false;
      }

      // Step 2: Handle different intersection types
      if (intersection.intersection_type === 'true_crossing') {
        // For true crossings, we can split anywhere along the trail
        console.log(`      ✂️  Processing true crossing: ${intersection.visiting_trail_name} ↔ ${intersection.visited_trail_name}`);
      } else {
        // For Y-intersections, validate split point using 1-meter fixed distance from endpoints
        const trailLengthResult = await client.query(`
          SELECT ST_Length(geometry::geography) as trail_length
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = $1
        `, [intersection.visited_trail_id]);

        if (trailLengthResult.rows.length === 0) {
          console.log(`      ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (visited trail not found)`);
          await client.query('ROLLBACK');
          return false;
        }

        const trailLength = trailLengthResult.rows[0].trail_length;
        const minDistanceFromEnd = 1.0; // 1 meter from each endpoint
        const minRatio = minDistanceFromEnd / trailLength;
        const maxRatio = 1.0 - minRatio;

        if (intersection.split_ratio <= minRatio || intersection.split_ratio >= maxRatio) {
          const minDistanceM = (minRatio * trailLength).toFixed(2);
          const maxDistanceM = (maxRatio * trailLength).toFixed(2);
          console.log(`      ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (split point ${(intersection.split_ratio * trailLength).toFixed(2)}m from start, must be between ${minDistanceM}m and ${maxDistanceM}m)`);
          await client.query('ROLLBACK');
          return false;
        }
      }

      // Step 3: Extend visiting trail to intersection point
      const extendResult = await this.extendVisitingTrail(
        client,
        intersection.visiting_trail_id,
        intersection.visiting_endpoint,
        intersection.split_point,
        intersection.visiting_trail_name
      );

      if (!extendResult.success) {
        console.log(`      ❌ Failed: Could not extend visiting trail ${intersection.visiting_trail_name}`);
        await client.query('ROLLBACK');
        return false;
      }

      // Step 4: Split visited trail at intersection point(s) and create children
      // Handle both single Point and MultiPoint intersections
      let splitResult;
      
      // 🔍 ENHANCED LOGGING: Track specific trails we're debugging
      const isDebugTrail = intersection.visited_trail_name.includes('Foothills North Trail') || 
                           intersection.visited_trail_name.includes('North Sky Trail') ||
                           intersection.visiting_trail_name.includes('Foothills North Trail') || 
                           intersection.visiting_trail_name.includes('North Sky Trail');
      
      if (isDebugTrail) {
        console.log(`\n🔍 DEBUG SPLITTING: Processing intersection for debug trails:`);
        console.log(`   Visiting: ${intersection.visiting_trail_name} (${intersection.visiting_trail_id})`);
        console.log(`   Visited: ${intersection.visited_trail_name} (${intersection.visited_trail_id})`);
        console.log(`   Type: ${intersection.intersection_type}`);
        console.log(`   Distance: ${intersection.distance_meters}m`);
      }
      
      // Check if this is a MultiPoint intersection by examining the geometry type
      const geometryTypeResult = await client.query(`
        SELECT ST_GeometryType($1) as geom_type
      `, [intersection.split_point]);
      
      const geometryType = geometryTypeResult.rows[0]?.geom_type;
      console.log(`         🔍 DEBUG: Intersection geometry type: ${geometryType}`);
      
      if (isDebugTrail) {
        console.log(`   Split point type: ${geometryType}`);
      }
      
      if (intersection.intersection_type === 'true_crossing' && 
          geometryType === 'ST_MultiPoint') {
        // MultiPoint intersection - split at each point
        if (isDebugTrail) {
          console.log(`   🔍 DEBUG: Using MultiPoint splitting for ${intersection.visited_trail_name}`);
        }
        console.log(`         🔍 DEBUG: Processing MultiPoint intersection`);
        splitResult = await this.splitTrailAtMultiPointIntersection(
          client,
          intersection.visited_trail_id,
          intersection.split_point,
          intersection.visited_trail_name
        );
      } else {
        // Single Point intersection - use existing logic
        if (isDebugTrail) {
          console.log(`   🔍 DEBUG: Using single point splitting for ${intersection.visited_trail_name}`);
        }
        console.log(`         🔍 DEBUG: Processing single Point intersection`);
        splitResult = await this.splitVisitedTrailAtIntersection(
          client,
          intersection.visited_trail_id,
          intersection.split_point,
          intersection.split_ratio,
          intersection.visited_trail_name
        );
      }

      if (!splitResult.success) {
        console.log(`      ❌ Failed: Could not split visited trail ${intersection.visited_trail_name}`);
        await client.query('ROLLBACK');
        return false;
      }

      // Step 5: Create connector trail (like fern-canyon script)
      const connectorResult = await this.createConnector(
        client,
        intersection.visiting_trail_id,
        intersection.visiting_endpoint,
        intersection.split_point,
        `${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`
      );

      if (!connectorResult.success) {
        console.log(`      ❌ Failed: Could not create connector for ${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`);
        await client.query('ROLLBACK');
        return false;
      }

      // Step 6: Delete parent visited trail
      const deleteResult = await this.deleteOriginalTrail(client, intersection.visited_trail_id);
      if (!deleteResult.success) {
        console.log(`      ❌ Failed: Could not delete original visited trail ${intersection.visited_trail_name}`);
        await client.query('ROLLBACK');
        return false;
      }

      // Commit transaction
      await client.query('COMMIT');
      
      console.log(`      ✅ Fixed: Extended ${intersection.visiting_trail_name} and split ${intersection.visited_trail_name} (${intersection.distance_meters.toFixed(2)}m) - created ${splitResult.segmentsCreated} children + connector`);
      return true;

    } catch (error) {
      console.error(`      ❌ Error processing intersection: ${error}`);
      await client.query('ROLLBACK');
      return false;
    }
  }

  /**
   * Step 1: Detect - Verify both trails still exist
   */
  private async detectBothTrails(client: any, intersection: any): Promise<{ bothExist: boolean }> {
    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE app_uuid = $1) as visiting_exists,
          COUNT(*) FILTER (WHERE app_uuid = $2) as visited_exists
        FROM ${this.stagingSchema}.trails
        WHERE app_uuid IN ($1, $2)
      `, [intersection.visiting_trail_id, intersection.visited_trail_id]);

      const visitingExists = parseInt(result.rows[0].visiting_exists) > 0;
      const visitedExists = parseInt(result.rows[0].visited_exists) > 0;
      const bothExist = visitingExists && visitedExists;

      console.log(`         🔍 DEBUG: Visiting trail ${intersection.visiting_trail_id} exists: ${visitingExists}`);
      console.log(`         🔍 DEBUG: Visited trail ${intersection.visited_trail_id} exists: ${visitedExists}`);
      console.log(`         🔍 DEBUG: Both trails exist: ${bothExist}`);

      return { bothExist };
    } catch (error) {
      console.error(`         🔍 DEBUG: Error detecting trails: ${error}`);
      return { bothExist: false };
    }
  }

  /**
   * Step 2: Extend visiting trail to intersection point
   */
  private async extendVisitingTrail(
    client: any,
    trailId: string,
    currentEndpoint: any,
    splitPoint: any,
    trailName: string
  ): Promise<{ success: boolean }> {
    try {
      // Get the current trail geometry
      const trailResult = await client.query(`
        SELECT geometry, ST_Length(geometry::geography) as length_m
        FROM ${this.stagingSchema}.trails
        WHERE app_uuid = $1
      `, [trailId]);

      if (trailResult.rows.length === 0) {
        console.log(`         🔍 DEBUG: Visiting trail ${trailId} not found`);
        return { success: false };
      }

      const currentGeometry = trailResult.rows[0].geometry;
      const currentLength = parseFloat(trailResult.rows[0].length_m);

      // Check if trail is too short
      if (currentLength < 5) {
        console.log(`         🔍 DEBUG: Visiting trail length: too short (${currentLength.toFixed(2)}m)`);
        return { success: false };
      }

      console.log(`         🔍 DEBUG: Visiting trail length: valid (${currentLength.toFixed(2)}m)`);
      console.log(`         🔍 DEBUG: Extending to split point: ${JSON.stringify(splitPoint)}`);

      // Create a new line that extends from the original trail to the split point
      const extendedResult = await client.query(`
        SELECT ST_MakeLine(geometry, $1) as extended_geom
        FROM ${this.stagingSchema}.trails
        WHERE app_uuid = $2
      `, [splitPoint, trailId]);

      if (extendedResult.rows.length > 0) {
        const extendedGeometry = extendedResult.rows[0].extended_geom;
        
        // Update the visiting trail's geometry with the extended geometry
        await client.query(`
          UPDATE ${this.stagingSchema}.trails 
          SET geometry = $1 
          WHERE app_uuid = $2
        `, [extendedGeometry, trailId]);
      }

      console.log(`         🔍 DEBUG: Successfully extended visiting trail geometry`);
      return { success: true };

    } catch (error) {
      console.error(`         🔍 DEBUG: Error in extendVisitingTrail: ${error}`);
      return { success: false };
    }
  }

  /**
   * Step 3: Split visited trail at intersection point and create children
   * Enhanced with split ratio validation like fern-canyon script
   */
  private async splitVisitedTrailAtIntersection(
    client: any,
    trailId: string,
    splitPoint: any,
    splitRatio: number,
    trailName: string
  ): Promise<{ success: boolean; segmentsCreated: number }> {
    try {
      // Get the current trail geometry
      const trailResult = await client.query(`
        SELECT geometry, ST_Length(geometry::geography) as length_m, name, trail_type, surface, difficulty, source
        FROM ${this.stagingSchema}.trails
        WHERE app_uuid = $1
      `, [trailId]);

      if (trailResult.rows.length === 0) {
        console.log(`         🔍 DEBUG: Trail ${trailId} not found`);
        return { success: false, segmentsCreated: 0 };
      }

      const trail = trailResult.rows[0];
      const currentLength = parseFloat(trail.length_m);

      // Check if trail is too short
      if (currentLength < 5) {
        console.log(`         🔍 DEBUG: Trail length: too short (${currentLength.toFixed(2)}m)`);
        return { success: false, segmentsCreated: 0 };
      }

      console.log(`         🔍 DEBUG: Trail length: valid (${currentLength.toFixed(2)}m)`);
      console.log(`         🔍 DEBUG: Split point: ${JSON.stringify(splitPoint)}`);
      console.log(`         🔍 DEBUG: Split ratio: ${splitRatio.toFixed(6)}`);

      // Validate split ratio (like fern-canyon script)
      if (splitRatio <= 0.001 || splitRatio >= 0.999) {
        console.log(`         🔍 DEBUG: Split ratio ${splitRatio.toFixed(6)} too close to endpoint`);
        return { success: false, segmentsCreated: 0 };
      }

      // Use ST_LineSubstring for robust splitting (like fern-canyon script)
      let splitSegments: any[] = [];

      try {
        const splitResult = await client.query(`
          SELECT 
            ST_LineSubstring(geometry, 0.0, $2) as segment1,
            ST_LineSubstring(geometry, $2, 1.0) as segment2
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = $1
        `, [trailId, splitRatio]);

        if (splitResult.rows.length > 0) {
          const row = splitResult.rows[0];
          
          // Validate segments have sufficient length (like fern-canyon script)
          const segment1Length = await client.query(`SELECT ST_Length($1::geography) as length`, [row.segment1]);
          const segment2Length = await client.query(`SELECT ST_Length($1::geography) as length`, [row.segment2]);
          
          console.log(`         🔍 DEBUG: Segment 1 length: ${segment1Length.rows[0].length.toFixed(2)}m`);
          console.log(`         🔍 DEBUG: Segment 2 length: ${segment2Length.rows[0].length.toFixed(2)}m`);
          
          if (segment1Length.rows[0].length >= 1.0 && segment2Length.rows[0].length >= 1.0) {
            splitSegments = [row.segment1, row.segment2];
            console.log(`         🔍 DEBUG: Successfully split trail into ${splitSegments.length} segments`);
          } else {
            console.log(`         🔍 DEBUG: Split segments too short (minimum 1m each)`);
            return { success: false, segmentsCreated: 0 };
          }
        }
      } catch (error) {
        console.log(`         🔍 DEBUG: Split failed: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, segmentsCreated: 0 };
      }

      if (splitSegments.length === 0) {
        console.log(`         🔍 DEBUG: All splitting methods failed`);
        return { success: false, segmentsCreated: 0 };
      }

      // Insert split segments (children)
      let segmentsCreated = 0;
      for (let i = 0; i < splitSegments.length; i++) {
        const segment = splitSegments[i];
        const segmentLength = await client.query(`
          SELECT ST_Length($1::geography) as length_m
        `, [segment]);

        const lengthM = parseFloat(segmentLength.rows[0].length_m);
        
        // Only insert segments that are long enough
        if (lengthM > 5) {
          await client.query(`
            INSERT INTO ${this.stagingSchema}.trails (
              app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
            )
          `, [
            `${trail.name} (Split ${i + 1})`,
            trail.trail_type,
            trail.surface,
            trail.difficulty,
            trail.source,
            segment,
            lengthM / 1000.0
          ]);
          segmentsCreated++;
        }
      }

      console.log(`         🔍 DEBUG: Successfully created ${segmentsCreated} child segments`);
      
      // Validate that split segments preserve original trail length
      if (segmentsCreated > 0) {
        try {
          const { validateTrailSplitAndThrow } = await import('../../utils/validation/trail-split-validation-helpers');
          const { strictTrailSplitValidation } = await import('../../utils/validation/trail-split-validation');
          
          // Get the UUIDs of the newly created split segments
          const splitUuidsResult = await client.query(`
            SELECT app_uuid FROM ${this.stagingSchema}.trails
            WHERE name = $1 AND app_uuid != $2
            ORDER BY created_at DESC
            LIMIT $3
          `, [`${trail.name} (Split 1)`, trail.app_uuid, segmentsCreated]);
          
          const splitUuids = splitUuidsResult.rows.map(row => row.app_uuid);
          
          // Validate the split
          await validateTrailSplitAndThrow(
            client,
            this.stagingSchema,
            trail.app_uuid,
            splitUuids,
            trail.name,
            strictTrailSplitValidation
          );
          
          console.log(`         ✅ Split validation passed for ${trail.name}`);
        } catch (validationError) {
          console.error(`         ❌ Split validation failed for ${trail.name}:`, validationError);
          throw new Error(`Trail split validation failed: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
        }
      }
      
      return { success: true, segmentsCreated };

    } catch (error) {
      console.error(`         🔍 DEBUG: Error in splitTrailAtIntersection: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, segmentsCreated: 0 };
    }
  }

  /**
   * Step 4: Create connector trail (like fern-canyon script)
   */
  private async createConnector(
    client: any,
    visitingTrailId: string,
    startPoint: any,
    endPoint: any,
    caseName: string
  ): Promise<{ success: boolean }> {
    try {
      // Generate a proper UUID for the connector using PostgreSQL's gen_random_uuid()
      const connectorResult = await client.query(`
        SELECT gen_random_uuid() as connector_id, ST_MakeLine($1, $2) as connector_geom
      `, [startPoint, endPoint]);

      if (connectorResult.rows.length > 0) {
        const connectorId = connectorResult.rows[0].connector_id;
        const connectorGeometry = connectorResult.rows[0].connector_geom;
        
        const connectorLength = await client.query(`
          SELECT ST_Length($1::geography) as length_m
        `, [connectorGeometry]);

        const lengthM = parseFloat(connectorLength.rows[0].length_m);
        
        // Only create connector if it has meaningful length
        if (lengthM > 0.1) {
          await client.query(`
            INSERT INTO ${this.stagingSchema}.trails (
              app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km
            ) VALUES (
              $1, $2, 'connector', 'unknown', 'yes', 'y_intersection_fix', $3, $4
            )
          `, [
            connectorId,
            `Connector: ${caseName}`,
            connectorGeometry,
            lengthM / 1000.0
          ]);
          
          console.log(`         🔍 DEBUG: Created connector: ${caseName} (${lengthM.toFixed(2)}m)`);
          return { success: true };
        } else {
          console.log(`         🔍 DEBUG: Connector too short: ${caseName} (${lengthM.toFixed(2)}m)`);
          return { success: false };
        }
      }

      console.log(`         🔍 DEBUG: Failed to create connector geometry: ${caseName}`);
      return { success: false };
    } catch (error) {
      console.error(`         🔍 DEBUG: Error creating connector: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false };
    }
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
        FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trailId]);

      if (trailResult.rows.length === 0) {
        console.log(`         🔍 DEBUG: Trail ${trailName} not found`);
        return { success: false, segmentsCreated: 0 };
      }

      const trail = trailResult.rows[0];
      const currentLength = parseFloat(trail.length_km) * 1000; // Convert to meters

      // Check if trail is too short
      if (currentLength < 5) {
        console.log(`         🔍 DEBUG: Trail length: too short (${currentLength.toFixed(2)}m)`);
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
        pointsResult.rows.map(async (row) => {
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
        if (currentRatio > lastRatio + 0.001 && currentRatio < 0.999) {
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
            if (lengthM > 5) {
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
          
          if (lengthM > 5) {
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
          
          if (lengthM > 5) {
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
          INSERT INTO ${this.stagingSchema}.trails (
            app_uuid, name, trail_type, surface, difficulty, source, geometry, length_km
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7
          )
        `, [
          `${trail.name} (Split ${i + 1})`,
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

  /**
   * Step 5: Delete parent - Remove the original trail
   */
  private async deleteOriginalTrail(client: any, trailId: string): Promise<{ success: boolean }> {
    try {
      const result = await client.query(`
        DELETE FROM ${this.stagingSchema}.trails
        WHERE app_uuid = $1
      `, [trailId]);

      const success = result.rowCount > 0;
      console.log(`         🔍 DEBUG: Deleted original trail ${trailId}: ${success}`);
      return { success };
    } catch (error) {
      console.error(`         🔍 DEBUG: Error deleting original trail: ${error}`);
      return { success: false };
    }
  }
}
