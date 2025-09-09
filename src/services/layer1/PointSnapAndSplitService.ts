import { Pool, PoolClient } from 'pg';

export interface PointSnapAndSplitConfig {
  stagingSchema: string;
  pgClient: Pool | PoolClient;
  snapToleranceMeters?: number;
  verbose?: boolean;
}

export interface PointSnapAndSplitResult {
  success: boolean;
  pointsProcessed: number;
  trailsSplit: number;
  intersectionsCreated: number;
  error?: string;
}

export interface PointToSnapAndSplit {
  lng: number;
  lat: number;
  elevation?: number;
  description?: string;
  preferredTrailName?: string; // Optional: prefer trails with this name
}

export class PointSnapAndSplitService {
  private config: PointSnapAndSplitConfig;
  private pointsToProcess: PointToSnapAndSplit[] = [];

  constructor(config: PointSnapAndSplitConfig) {
    this.config = {
      snapToleranceMeters: 10.0, // Default 10 meters
      verbose: false,
      ...config
    };
  }

  /**
   * Add a point to be snapped and split
   */
  addPoint(point: PointToSnapAndSplit): void {
    this.pointsToProcess.push(point);
  }

  /**
   * Execute the snap and split operation for all added points
   */
  async execute(): Promise<PointSnapAndSplitResult> {
    if (this.pointsToProcess.length === 0) {
      return {
        success: true,
        pointsProcessed: 0,
        trailsSplit: 0,
        intersectionsCreated: 0
      };
    }

    if (this.config.verbose) {
      console.log(`🎯 Point Snap and Split Service: Processing ${this.pointsToProcess.length} points`);
    }

    let pointsProcessed = 0;
    let trailsSplit = 0;
    let intersectionsCreated = 0;

    try {
      for (const point of this.pointsToProcess) {
        if (this.config.verbose) {
          console.log(`\n📍 Processing point: ${point.lng}, ${point.lat}, ${point.elevation || 'N/A'} ${point.description ? `(${point.description})` : ''}`);
        }

        const result = await this.snapAndSplitPoint(point);
        
        if (result.success) {
          pointsProcessed++;
          if (result.trailSplit) trailsSplit++;
          if (result.intersectionCreated) intersectionsCreated++;
          
          if (this.config.verbose) {
            console.log(`   ✅ Success: ${result.trailSplit ? 'Trail split' : 'No split needed'}, ${result.intersectionCreated ? 'Intersection created' : 'No intersection'}`);
          }
        } else {
          if (this.config.verbose) {
            console.log(`   ❌ Failed: ${result.error}`);
          }
        }
      }

      return {
        success: true,
        pointsProcessed,
        trailsSplit,
        intersectionsCreated
      };

    } catch (error) {
      return {
        success: false,
        pointsProcessed,
        trailsSplit,
        intersectionsCreated,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Snap a point to the nearest trail and create a degree-3 intersection
   */
  private async snapAndSplitPoint(point: PointToSnapAndSplit): Promise<{
    success: boolean;
    trailSplit: boolean;
    intersectionCreated: boolean;
    error?: string;
  }> {
    try {
      // Step 1: Find the nearest trail to this point (excluding the trail that has this as an endpoint)
      const findNearestTrailQuery = `
        WITH target_point AS (
          SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) as point_geom
        ),
        trails_with_endpoints AS (
          SELECT 
            id,
            app_uuid,
            name,
            trail_type,
            geometry,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point,
            ST_Distance(geometry, tp.point_geom) * 111320 as distance_meters,
            ST_ClosestPoint(geometry, tp.point_geom) as closest_point
          FROM ${this.config.stagingSchema}.trails, target_point tp
          WHERE ST_IsValid(geometry)
            AND ST_GeometryType(geometry) = 'ST_LineString'
        ),
        filtered_trails AS (
          SELECT *
          FROM trails_with_endpoints
          WHERE NOT (
            -- Exclude trails where the target point is very close to start or end (within 5m)
            ST_Distance(start_point, (SELECT point_geom FROM target_point)) * 111320 < 5.0
            OR ST_Distance(end_point, (SELECT point_geom FROM target_point)) * 111320 < 5.0
          )
          ${point.preferredTrailName ? `AND name ILIKE '%${point.preferredTrailName}%'` : ''}
        )
        SELECT 
          id,
          app_uuid,
          name,
          trail_type,
          ST_AsText(geometry) as geom_text,
          distance_meters,
          closest_point
        FROM filtered_trails
        ORDER BY distance_meters
        LIMIT 1;
      `;

      const nearestTrailResult = await this.config.pgClient.query(findNearestTrailQuery, [point.lng, point.lat]);

      if (nearestTrailResult.rows.length === 0) {
        return {
          success: false,
          trailSplit: false,
          intersectionCreated: false,
          error: 'No valid trails found'
        };
      }

      const nearestTrail = nearestTrailResult.rows[0];
      const distanceMeters = nearestTrail.distance_meters;

      if (distanceMeters > this.config.snapToleranceMeters!) {
        return {
          success: false,
          trailSplit: false,
          intersectionCreated: false,
          error: `Nearest trail is ${distanceMeters.toFixed(2)}m away (tolerance: ${this.config.snapToleranceMeters}m)`
        };
      }

      if (this.config.verbose) {
        console.log(`   🛤️  Nearest trail: "${nearestTrail.name || 'Unnamed'}" (${distanceMeters.toFixed(2)}m away)`);
      }

      // Step 2: Get the closest point on the trail
      const closestPointQuery = `
        SELECT 
          ST_X(closest_point) as lng,
          ST_Y(closest_point) as lat,
          ST_Z(closest_point) as elevation
        FROM (
          SELECT ST_ClosestPoint(
            geometry,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)
          ) as closest_point
          FROM ${this.config.stagingSchema}.trails 
          WHERE id = $3
        ) as cp;
      `;

      const closestPointResult = await this.config.pgClient.query(closestPointQuery, [point.lng, point.lat, nearestTrail.id]);
      const closestPoint = closestPointResult.rows[0];

      if (this.config.verbose) {
        console.log(`   📍 Closest point on trail: ${closestPoint.lng}, ${closestPoint.lat}, ${closestPoint.elevation}`);
      }

      // Step 3: Check if we need to split the trail at this point
      const needsSplitQuery = `
        SELECT 
          ST_Distance(
            ST_StartPoint(geometry),
            ST_SetSRID(ST_MakePoint($1, $2), 4326)
          ) * 111320 as distance_to_start,
          ST_Distance(
            ST_EndPoint(geometry),
            ST_SetSRID(ST_MakePoint($1, $2), 4326)
          ) * 111320 as distance_to_end
        FROM ${this.config.stagingSchema}.trails 
        WHERE id = $3;
      `;

      const needsSplitResult = await this.config.pgClient.query(needsSplitQuery, [closestPoint.lng, closestPoint.lat, nearestTrail.id]);
      const distances = needsSplitResult.rows[0];

      // If the closest point is very close to start or end, we don't need to split
      const minDistanceToEndpoint = Math.min(distances.distance_to_start, distances.distance_to_end);
      const shouldSplit = minDistanceToEndpoint > 1.0; // Split if more than 1m from endpoints (reduced threshold)

      if (this.config.verbose) {
        console.log(`   📏 Distance to endpoints: start=${distances.distance_to_start.toFixed(2)}m, end=${distances.distance_to_end.toFixed(2)}m`);
        console.log(`   ✂️  Should split: ${shouldSplit ? 'Yes' : 'No'}`);
      }

      let trailSplit = false;

      if (shouldSplit) {
        // Step 4: Split the trail at the closest point
        const splitResult = await this.splitTrailAtPoint(nearestTrail, closestPoint);
        if (splitResult.success) {
          trailSplit = true;
          if (this.config.verbose) {
            console.log(`   ✅ Trail split into ${splitResult.segmentCount} segments`);
          }
        } else {
          return {
            success: false,
            trailSplit: false,
            intersectionCreated: false,
            error: `Failed to split trail: ${splitResult.error}`
          };
        }
      }

      // Step 5: Create or update intersection point in routing nodes
      const intersectionResult = await this.createIntersectionPoint(closestPoint, nearestTrail);
      
      return {
        success: true,
        trailSplit,
        intersectionCreated: intersectionResult.success
      };

    } catch (error) {
      return {
        success: false,
        trailSplit: false,
        intersectionCreated: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Split a trail at a specific point
   */
  private async splitTrailAtPoint(trail: any, splitPoint: any): Promise<{
    success: boolean;
    segmentCount: number;
    error?: string;
  }> {
    try {
      // Use ST_Split to split the trail at the point with a small buffer to ensure intersection
      const splitQuery = `
        WITH split_segments AS (
          SELECT 
            (ST_Dump(ST_Split(geometry, ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2, $3), 4326), 0.00001)))).geom as segment_geom
          FROM ${this.config.stagingSchema}.trails 
          WHERE id = $4
        )
        SELECT 
          ST_AsText(segment_geom) as geometry_text,
          ST_Length(segment_geom::geography) as length_meters
        FROM split_segments
        WHERE ST_Length(segment_geom::geography) > 0.1  -- Filter out tiny segments (reduced threshold)
        ORDER BY ST_Length(segment_geom::geography) DESC;
      `;

      const splitResult = await this.config.pgClient.query(splitQuery, [
        splitPoint.lng,
        splitPoint.lat,
        splitPoint.elevation || 0,
        trail.id
      ]);

      if (this.config.verbose) {
        console.log(`   🔍 Split result: ${splitResult.rows.length} segments created`);
        splitResult.rows.forEach((segment, index) => {
          console.log(`      Segment ${index + 1}: ${segment.length_meters.toFixed(2)}m`);
        });
      }

      if (splitResult.rows.length < 2) {
        return {
          success: false,
          segmentCount: splitResult.rows.length,
          error: `Split did not create enough segments (got ${splitResult.rows.length}, need at least 2)`
        };
      }

      // Get the original trail data before deleting
      const originalTrailQuery = `
        SELECT * FROM ${this.config.stagingSchema}.trails WHERE id = $1
      `;
      const originalTrailResult = await this.config.pgClient.query(originalTrailQuery, [trail.id]);
      
      if (originalTrailResult.rows.length === 0) {
        return {
          success: false,
          segmentCount: 0,
          error: 'Original trail not found'
        };
      }
      
      const originalTrail = originalTrailResult.rows[0];

      // Delete the original trail
      await this.config.pgClient.query(
        `DELETE FROM ${this.config.stagingSchema}.trails WHERE id = $1`,
        [trail.id]
      );

      // Insert the new split segments with proper data from original trail
      for (const segment of splitResult.rows) {
        await this.config.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.trails (
            app_uuid, original_trail_uuid, name, trail_type, surface, difficulty,
            geometry, length_km, elevation_gain, elevation_loss,
            max_elevation, min_elevation, avg_elevation,
            bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
            source, source_tags, osm_id
          ) VALUES (
            gen_random_uuid(),
            $1,
            $2,
            $3, $4, $5,
            ST_Force3D($6::geometry),
            ST_Length($6::geography) / 1000.0,
            $7, $8, $9, $10, $11,
            ST_XMin($6::geometry), ST_XMax($6::geometry),
            ST_YMin($6::geometry), ST_YMax($6::geometry),
            $12, $13, $14
          )
        `, [
          originalTrail.app_uuid, // original_trail_uuid
          originalTrail.name,     // name
          originalTrail.trail_type,
          originalTrail.surface,
          originalTrail.difficulty,
          segment.geometry_text,  // geometry
          originalTrail.elevation_gain,
          originalTrail.elevation_loss,
          originalTrail.max_elevation,
          originalTrail.min_elevation,
          originalTrail.avg_elevation,
          originalTrail.source,
          originalTrail.source_tags,
          originalTrail.osm_id
        ]);
      }

      return {
        success: true,
        segmentCount: splitResult.rows.length
      };

    } catch (error) {
      return {
        success: false,
        segmentCount: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Create or update an intersection point in routing nodes
   */
  private async createIntersectionPoint(point: any, trail: any): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // Check if a node already exists at this location
      const existingNodeQuery = `
        SELECT id, node_uuid, node_type, connected_trails
        FROM ${this.config.stagingSchema}.routing_nodes 
        WHERE ST_DWithin(
          ST_SetSRID(ST_MakePoint(lng, lat), 4326),
          ST_SetSRID(ST_MakePoint($1, $2), 4326),
          0.0001  -- ~10 meters
        )
        ORDER BY ST_Distance(
          ST_SetSRID(ST_MakePoint(lng, lat), 4326),
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        )
        LIMIT 1;
      `;

      const existingNodeResult = await this.config.pgClient.query(existingNodeQuery, [point.lng, point.lat]);

      if (existingNodeResult.rows.length > 0) {
        // Update existing node to be a degree-3 intersection
        const existingNode = existingNodeResult.rows[0];
        
        await this.config.pgClient.query(`
          UPDATE ${this.config.stagingSchema}.routing_nodes 
          SET 
            node_type = 'degree3_intersection',
            connected_trails = connected_trails + 1
          WHERE id = $1;
        `, [existingNode.id]);

        // Update or insert prediction
        await this.config.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.graphsage_predictions (node_id, prediction, confidence)
          VALUES ($1, 2, 1.0)
          ON CONFLICT (node_id) DO UPDATE SET
            prediction = 2,
            confidence = 1.0;
        `, [existingNode.id]);

        if (this.config.verbose) {
          console.log(`   🔄 Updated existing node ${existingNode.id} to degree-3 intersection`);
        }
      } else {
        // Create new intersection node
        const newNodeQuery = `
          INSERT INTO ${this.config.stagingSchema}.routing_nodes (
            node_uuid, lat, lng, elevation, node_type, connected_trails
          ) VALUES (
            'node-' || nextval('${this.config.stagingSchema}.routing_nodes_id_seq'),
            $1, $2, $3, 'degree3_intersection', 1
          ) RETURNING id;
        `;

        const newNodeResult = await this.config.pgClient.query(newNodeQuery, [
          point.lat,
          point.lng,
          point.elevation || 0
        ]);

        const newNodeId = newNodeResult.rows[0].id;

        // Insert prediction for new node
        await this.config.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.graphsage_predictions (node_id, prediction, confidence)
          VALUES ($1, 2, 1.0);
        `, [newNodeId]);

        if (this.config.verbose) {
          console.log(`   ➕ Created new degree-3 intersection node ${newNodeId}`);
        }
      }

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
