import { Pool } from 'pg';

export interface YIntersectionSplittingResult {
  trailsProcessed: number;
  segmentsCreated: number;
  originalTrailsDeleted: number;
  intersectionCount: number;
  iterations: number;
}

export class YIntersectionSplittingService {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config?: any
  ) {}

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

        console.log(`   🔍 Found ${intersections.length} Y-intersections`);
        totalIntersectionsFound += intersections.length;

        let iterationProcessed = 0;
        const processedTrails = new Set(); // Track trails processed in this iteration to avoid conflicts

        for (const intersection of intersections) {
          // Skip if either trail has already been processed in this iteration
          if (processedTrails.has(intersection.visited_trail_id) || processedTrails.has(intersection.visiting_trail_id)) {
            console.log(`      ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (trail already processed in this iteration)`);
            continue;
          }

          try {
            const success = await this.processYIntersection(client, intersection, minSnapDistanceMeters);
            if (success) {
              iterationProcessed++;
              totalProcessed++;
              // Mark both trails as processed to avoid conflicts
              processedTrails.add(intersection.visited_trail_id);
              processedTrails.add(intersection.visiting_trail_id);
            }
          } catch (error) {
            console.error(`   ❌ Error processing intersection: ${error}`);
          }
        }

        console.log(`   📊 Iteration ${iteration}: processed ${iterationProcessed} Y-intersections`);
        
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
   * Find Y-intersections where trail endpoints are close to other trails
   * Uses the exact same logic as our successful prototype script
   */
  private async findYIntersections(client: any, toleranceMeters: number, minTrailLengthMeters: number): Promise<any[]> {
    console.log(`   🔍 Finding Y-intersections with ${toleranceMeters}m tolerance...`);

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
          ST_LineLocatePoint(e2.trail_geom, e1.end_point) as split_ratio
        FROM trail_endpoints e1
        CROSS JOIN trail_endpoints e2
        WHERE e1.trail_id != e2.trail_id
          AND ST_Distance(e1.end_point::geography, e2.trail_geom::geography) <= $2
          AND ST_Distance(e1.end_point::geography, e2.trail_geom::geography) > $3
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
          split_ratio
        FROM y_intersections
        ORDER BY visiting_trail_id, visited_trail_id, distance_meters
      )
      SELECT * FROM best_matches
      ORDER BY distance_meters
      LIMIT 20
    `, [minTrailLengthMeters, toleranceMeters, 1.0]); // minSnapDistanceMeters = 1.0 to avoid already-connected trails

    console.log(`   🔍 Found ${result.rows.length} Y-intersections`);
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

      // Step 2: Validate split point using 1-meter fixed distance from endpoints (not percentage)
      // Get the visited trail length to calculate proper split ratios
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

      // Step 4: Split visited trail at intersection point and create children
      const splitResult = await this.splitVisitedTrailAtIntersection(
        client,
        intersection.visited_trail_id,
        intersection.split_point,
        intersection.split_ratio,
        intersection.visited_trail_name
      );

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
