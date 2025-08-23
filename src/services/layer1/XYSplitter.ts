import { Pool } from 'pg';

export interface XYSplitterConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  toleranceMeters?: number;
  minTrailLengthMeters?: number;
  minSnapDistanceMeters?: number;
  maxIterations?: number;
}

export interface XYSplitterResult {
  success: boolean;
  error?: string;
  yIntersectionsProcessed: number;
  trueIntersectionsProcessed: number;
  totalSegmentsCreated: number;
  iterations: number;
}

export class XYSplitter {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: XYSplitterConfig;

  constructor(config: XYSplitterConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = {
      toleranceMeters: 10,
      minTrailLengthMeters: 5,
      minSnapDistanceMeters: 0,
      maxIterations: 5,
      ...config
    };
  }

  /**
   * Apply enhanced X/Y intersection splitting based on fern-canyon-mesa logic
   */
  async applyXYSplitting(): Promise<XYSplitterResult> {
    console.log('🔄 XYSplitter: Starting enhanced X/Y intersection splitting...');
    
    const result: XYSplitterResult = {
      success: false,
      yIntersectionsProcessed: 0,
      trueIntersectionsProcessed: 0,
      totalSegmentsCreated: 0,
      iterations: 0
    };

    try {
      // Step 1: Iteratively find and fix all Y-intersections
      console.log('🔄 Step 1: Iteratively fixing all Y-intersections...');
      
      let iteration = 1;
      let totalYProcessed = 0;
      let hasMoreIntersections = true;

      while (hasMoreIntersections && iteration <= this.config.maxIterations!) {
        console.log(`   🔄 Iteration ${iteration}/${this.config.maxIterations}:`);

        // Find all potential Y-intersections
        const allIntersections = await this.findAllYIntersections();

        if (allIntersections.length === 0) {
          console.log(`      ✅ No more Y-intersections found`);
          hasMoreIntersections = false;
          break;
        }

        console.log(`      Found ${allIntersections.length} potential Y-intersections`);
        
        let iterationProcessed = 0;
        const processedTrails = new Set(); // Track trails processed in this iteration

        for (const intersection of allIntersections) {
          // Skip if either trail has already been processed in this iteration
          if (processedTrails.has(intersection.visited_trail_id) || processedTrails.has(intersection.visiting_trail_id)) {
            console.log(`      ⏭️  Skipping: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name} (trail already processed)`);
            continue;
          }

          console.log(`      🔧 Processing: ${intersection.visiting_trail_name} → ${intersection.visited_trail_name}`);

          const fixResult = await this.performYIntersectionFix(intersection);

          if (fixResult.success) {
            console.log(`         ✅ Fixed: ${fixResult.message}`);
            iterationProcessed++;
            totalYProcessed++;
            // Mark both trails as processed to avoid conflicts
            processedTrails.add(intersection.visited_trail_id);
            processedTrails.add(intersection.visiting_trail_id);
          } else {
            console.log(`         ❌ Failed: ${fixResult.error}`);
          }
        }

        console.log(`      📊 Iteration ${iteration}: processed ${iterationProcessed} Y-intersections`);

        if (iterationProcessed === 0) {
          console.log(`      ⚠️  No Y-intersections were successfully processed in this iteration`);
          hasMoreIntersections = false;
        }

        iteration++;
      }

      result.yIntersectionsProcessed = totalYProcessed;
      result.iterations = iteration - 1;

      // Step 2: Find and fix true geometric intersections
      console.log('🔄 Step 2: Finding and fixing true geometric intersections...');
      
      const trueIntersections = await this.findTrueIntersections();
      
      if (trueIntersections.length === 0) {
        console.log('   ✅ No true intersections found');
      } else {
        console.log(`   Found ${trueIntersections.length} true intersections`);
        
        let intersectionProcessed = 0;
        const processedIntersectionTrails = new Set(); // Track trails processed in intersection phase

        for (const intersection of trueIntersections) {
          // Skip if either trail has already been processed
          if (processedIntersectionTrails.has(intersection.trail1_id) || processedIntersectionTrails.has(intersection.trail2_id)) {
            console.log(`   ⏭️  Skipping intersection: ${intersection.trail1_name} × ${intersection.trail2_name} (trail already processed)`);
            continue;
          }

          const fixResult = await this.performTrueIntersectionFix(intersection);

          if (fixResult.success) {
            console.log(`   ✅ Fixed intersection: ${fixResult.message}`);
            intersectionProcessed++;
            // Mark both trails as processed to avoid conflicts
            processedIntersectionTrails.add(intersection.trail1_id);
            processedIntersectionTrails.add(intersection.trail2_id);
          } else {
            console.log(`   ❌ Failed intersection: ${fixResult.error}`);
          }
        }

        result.trueIntersectionsProcessed = intersectionProcessed;
      }

      // Calculate total segments created (rough estimate)
      result.totalSegmentsCreated = result.yIntersectionsProcessed + result.trueIntersectionsProcessed;
      result.success = true;

      console.log(`✅ XYSplitter completed successfully:`);
      console.log(`   📊 Y-intersections processed: ${result.yIntersectionsProcessed}`);
      console.log(`   📊 True intersections processed: ${result.trueIntersectionsProcessed}`);
      console.log(`   📊 Total segments created: ${result.totalSegmentsCreated}`);
      console.log(`   🔄 Iterations: ${result.iterations}`);

      return result;

    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      console.error('❌ XYSplitter error:', error);
      return result;
    }
  }

  /**
   * Find all potential Y-intersections with dynamic split point calculation
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
        FROM ${this.stagingSchema}.trails
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
    `;

    const result = await this.pgClient.query(query, [
      this.config.minTrailLengthMeters,
      this.config.toleranceMeters
    ]);

    return result.rows;
  }

  /**
   * Find true geometric intersections where trails actually cross each other
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
        FROM ${this.stagingSchema}.trails t1
        CROSS JOIN ${this.stagingSchema}.trails t2
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
          ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point))) as trail2_distance_from_start
        FROM intersection_points
        WHERE 
          -- Use relaxed threshold: 0.1m instead of 1.0m for true intersections
          ST_Length(ST_LineSubstring(trail1_geom, 0.0, ST_LineLocatePoint(trail1_geom, intersection_point))) > 0.1
          AND ST_Length(ST_LineSubstring(trail1_geom, ST_LineLocatePoint(trail1_geom, intersection_point), 1.0)) > 0.1
          AND ST_Length(ST_LineSubstring(trail2_geom, 0.0, ST_LineLocatePoint(trail2_geom, intersection_point))) > 0.1
          AND ST_Length(ST_LineSubstring(trail2_geom, ST_LineLocatePoint(trail2_geom, intersection_point), 1.0)) > 0.1
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

    const result = await this.pgClient.query(query, [this.config.minTrailLengthMeters]);
    return result.rows;
  }

  /**
   * Perform Y-intersection fix for a specific intersection
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

      // Create connector
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

    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Perform true intersection fix for a specific intersection
   */
  private async performTrueIntersectionFix(intersection: any): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      console.log(`         🔧 Processing true intersection: ${intersection.trail1_name} × ${intersection.trail2_name}`);

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

    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Snap a trail endpoint to a specific point on another trail
   */
  private async snapTrailEndpoint(trailId: string, endpoint: any, snapPoint: any): Promise<{ success: boolean; message?: string; error?: string }> {
    const client = await this.pgClient.connect();
    
    try {
      // Start transaction
      await client.query('BEGIN');

      // Get original trail
      const originalTrail = await client.query(`
        SELECT * FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
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
        FROM ${this.stagingSchema}.trails 
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
        UPDATE ${this.stagingSchema}.trails 
        SET geometry = ${newGeometry}
        WHERE app_uuid = $1
      `, [trailId]);
      
      await client.query('COMMIT');
      return { 
        success: true, 
        message: `Snapped ${isStartPoint ? 'start' : 'end'} point of trail ${trailId}`
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      client.release();
    }
  }

  /**
   * Split a trail at a specific point
   */
  private async splitTrail(trailId: string, splitPoint: any): Promise<{ success: boolean; message?: string; error?: string }> {
    const client = await this.pgClient.connect();
    
    try {
      // Start transaction
      await client.query('BEGIN');

      // Get original trail
      const originalTrail = await client.query(`
        SELECT * FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
      `, [trailId]);

      if (originalTrail.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Trail not found' };
      }

      const trail = originalTrail.rows[0];

      // Calculate the split ratio using ST_LineLocatePoint
      const ratioQuery = `
        SELECT 
          ST_LineLocatePoint(geometry, ST_GeomFromGeoJSON('${JSON.stringify(splitPoint)}')) as split_ratio,
          ST_Length(geometry::geography) as trail_length
        FROM ${this.stagingSchema}.trails 
        WHERE app_uuid = $1
      `;
      
      const ratioResult = await client.query(ratioQuery, [trailId]);
      
      if (ratioResult.rows.length === 0) {
        throw new Error('Trail not found for ratio calculation');
      }
      
      const splitRatio = ratioResult.rows[0].split_ratio;
      const trailLength = ratioResult.rows[0].trail_length;
      
      // Validate split point is at least 0.1 meter from either endpoint (relaxed threshold)
      const distanceFromStart = splitRatio * trailLength;
      const distanceFromEnd = (1.0 - splitRatio) * trailLength;
      const minDistanceFromEnd = 0.1; // 0.1 meter from each endpoint (relaxed)
      
      if (distanceFromStart < minDistanceFromEnd || distanceFromEnd < minDistanceFromEnd) {
        throw new Error(`Split point too close to endpoint: ${distanceFromStart.toFixed(2)}m from start, ${distanceFromEnd.toFixed(2)}m from end (must be at least ${minDistanceFromEnd}m from each endpoint)`);
      }
      
      // Split the trail into two segments using ST_LineSubstring
      const splitQuery = `
        SELECT 
          ST_LineSubstring(geometry, 0.0, $2) as segment1,
          ST_LineSubstring(geometry, $2, 1.0) as segment2
        FROM ${this.stagingSchema}.trails 
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
      
      if (segment1Length.rows[0].length < 0.1 || segment2Length.rows[0].length < 0.1) {
        throw new Error('Split segments too short (minimum 0.1m each)');
      }
      
      // Delete original trail
      await client.query(`DELETE FROM ${this.stagingSchema}.trails WHERE app_uuid = $1`, [trailId]);

      // Insert split segments
      for (let i = 0; i < 2; i++) {
        const segment = i === 0 ? row.segment1 : row.segment2;
        const newId = `${trailId}_split_${i + 1}`;
        const newName = `${trail.name} (Split ${i + 1})`;

        await client.query(`
          INSERT INTO ${this.stagingSchema}.trails (app_uuid, name, trail_type, geometry)
          VALUES ($1, $2, $3, $4)
        `, [newId, newName, trail.trail_type, segment]);
      }

      // Commit transaction
      await client.query('COMMIT');

      return { 
        success: true, 
        message: `Split into 2 segments`
      };

    } catch (error) {
      // Rollback on any error
      await client.query('ROLLBACK');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      client.release();
    }
  }

  /**
   * Create a connector trail
   */
  private async createConnector(visitingTrailId: string, startPoint: any, endPoint: any, caseName: string): Promise<{ success: boolean; connectorId?: string; error?: string }> {
    const client = await this.pgClient.connect();
    
    try {
      // Start transaction
      await client.query('BEGIN');

      const connectorId = `connector_${visitingTrailId}_${Date.now()}`;
      const connectorName = `X-Connector: ${caseName}`;
      
      await client.query(`
        INSERT INTO ${this.stagingSchema}.trails (app_uuid, name, trail_type, geometry)
        VALUES ($1, $2, $3, ST_MakeLine($4, $5))
      `, [
        connectorId,
        connectorName,
        'connector',
        startPoint,
        endPoint
      ]);

      // Commit transaction
      await client.query('COMMIT');

      return { success: true, connectorId };

    } catch (error) {
      // Rollback on any error
      await client.query('ROLLBACK');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      client.release();
    }
  }
}
