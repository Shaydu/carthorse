import { Pool } from 'pg';
import { CentralizedTrailSplitManager, CentralizedSplitConfig } from '../../utils/services/network-creation/centralized-trail-split-manager';
import { TrailSplitManager } from '../../utils/TrailSplitManager';

export interface ProximitySnappingResult {
  success: boolean;
  trailsSnapped: number;
  trailsSplit: number;
  verticesCreated: number;
  error?: string;
}

export interface ProximitySnappingConfig {
  stagingSchema: string;
  proximityToleranceMeters: number; // 0.5m tolerance
  minTrailLengthMeters: number;
  maxIterations: number;
  verbose?: boolean;
}

/**
 * Service to find trails within 0.5m of each other's splitting points,
 * snap them to the same endpoint, and split them to create a single vertex
 * that connects all the trails for better network connectivity.
 */
export class ProximitySnappingSplittingService {
  private splitManager: TrailSplitManager;
  private centralizedManager: CentralizedTrailSplitManager;

  constructor(
    private pgClient: Pool,
    private config: ProximitySnappingConfig
  ) {
    this.splitManager = TrailSplitManager.getInstance();
    this.splitManager.setTolerance(0.5); // Use 0.5m tolerance for proximity detection
    
    // Initialize centralized split manager
    const centralizedConfig: CentralizedSplitConfig = {
      stagingSchema: config.stagingSchema,
      intersectionToleranceMeters: 0.5,
      minSegmentLengthMeters: 5.0,
      preserveOriginalTrailNames: true,
      validationToleranceMeters: 1.0,
      validationTolerancePercentage: 0.1
    };
    
    this.centralizedManager = CentralizedTrailSplitManager.getInstance(pgClient, centralizedConfig);
  }

  /**
   * Find trails within proximity tolerance and snap them to create shared vertices
   */
  async applyProximitySnappingSplitting(): Promise<ProximitySnappingResult> {
    console.log('🔗 Applying proximity snapping and splitting (0.5m tolerance)...');
    
    const client = await this.pgClient.connect();
    const tolerance = this.config.proximityToleranceMeters;
    const minTrailLengthMeters = this.config.minTrailLengthMeters;
    const maxIterations = this.config.maxIterations;
    
    try {
      // Ensure we start with a clean transaction state
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      let iteration = 1;
      let totalProcessed = 0;
      let totalSnapped = 0;
      let totalSplit = 0;
      let totalVertices = 0;
      let hasMoreProximities = true;

      while (hasMoreProximities && iteration <= maxIterations) {
        console.log(`   🔄 Iteration ${iteration}/${maxIterations}:`);

        // Find all proximity groups (trails within 0.5m of each other)
        const proximityGroups = await this.findProximityGroups(client, tolerance, minTrailLengthMeters);
        
        if (proximityGroups.length === 0) {
          console.log(`   ✅ No more proximity groups found after ${iteration} iterations`);
          hasMoreProximities = false;
          break;
        }

        console.log(`   🔍 Found ${proximityGroups.length} proximity groups:`);
        
        let iterationProcessed = 0;
        for (const group of proximityGroups) {
          console.log(`      📍 Group ${group.groupId}: ${group.trailCount} trails within ${tolerance}m`);
          
          try {
            const result = await this.processProximityGroup(client, group, tolerance);
            if (result.success) {
              iterationProcessed++;
              totalProcessed++;
              totalSnapped += result.trailsSnapped;
              totalSplit += result.trailsSplit;
              totalVertices += result.verticesCreated;
              
              console.log(`         ✅ Processed: ${result.trailsSnapped} snapped, ${result.trailsSplit} split, ${result.verticesCreated} vertices`);
            }
          } catch (error) {
            console.error(`         ❌ Error processing proximity group ${group.groupId}:`, error);
          }
        }

        console.log(`   📊 Iteration ${iteration}: processed ${iterationProcessed} proximity groups`);
        
        if (iterationProcessed === 0) {
          hasMoreProximities = false;
        }
        
        iteration++;
      }

      console.log(`✅ Proximity snapping and splitting completed:`);
      console.log(`   - Proximity groups processed: ${totalProcessed}`);
      console.log(`   - Trails snapped: ${totalSnapped}`);
      console.log(`   - Trails split: ${totalSplit}`);
      console.log(`   - Vertices created: ${totalVertices}`);

      return {
        success: true,
        trailsSnapped: totalSnapped,
        trailsSplit: totalSplit,
        verticesCreated: totalVertices
      };

    } catch (error) {
      console.error('❌ Error in proximity snapping and splitting:', error);
      return {
        success: false,
        trailsSnapped: 0,
        trailsSplit: 0,
        verticesCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      // Ensure we clean up any pending transactions
      try {
        await client.query('ROLLBACK');
      } catch (e) {
        // Ignore rollback errors
      }
      client.release();
    }
  }

  /**
   * Find groups of trails that are within proximity tolerance of each other
   */
  private async findProximityGroups(client: any, toleranceMeters: number, minTrailLengthMeters: number): Promise<any[]> {
    const toleranceDegrees = toleranceMeters / 111000; // Convert meters to degrees (approximate)
    
    const query = `
      WITH trail_endpoints AS (
        -- Get all trail endpoints (start and end points)
        SELECT 
          app_uuid,
          name,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point,
          geometry
        FROM ${this.config.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
          AND ST_IsValid(geometry)
          AND ST_Length(geometry::geography) >= $1
      ),
      proximity_pairs AS (
        -- Find trail endpoints that are within tolerance of each other
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.start_point as trail1_point,
          'start' as trail1_point_type,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.start_point as trail2_point,
          'start' as trail2_point_type,
          ST_Distance(t1.start_point::geography, t2.start_point::geography) as distance_meters
        FROM trail_endpoints t1
        JOIN trail_endpoints t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_DWithin(t1.start_point::geography, t2.start_point::geography, $2)
          AND ST_Distance(t1.start_point::geography, t2.start_point::geography) > 0
        
        UNION ALL
        
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.start_point as trail1_point,
          'start' as trail1_point_type,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.end_point as trail2_point,
          'end' as trail2_point_type,
          ST_Distance(t1.start_point::geography, t2.end_point::geography) as distance_meters
        FROM trail_endpoints t1
        JOIN trail_endpoints t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t1.start_point::geography, t2.end_point::geography, $2)
          AND ST_Distance(t1.start_point::geography, t2.end_point::geography) > 0
        
        UNION ALL
        
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.end_point as trail1_point,
          'end' as trail1_point_type,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.start_point as trail2_point,
          'start' as trail2_point_type,
          ST_Distance(t1.end_point::geography, t2.start_point::geography) as distance_meters
        FROM trail_endpoints t1
        JOIN trail_endpoints t2 ON t1.app_uuid != t2.app_uuid
        WHERE ST_DWithin(t1.end_point::geography, t2.start_point::geography, $2)
          AND ST_Distance(t1.end_point::geography, t2.start_point::geography) > 0
        
        UNION ALL
        
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.end_point as trail1_point,
          'end' as trail1_point_type,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.end_point as trail2_point,
          'end' as trail2_point_type,
          ST_Distance(t1.end_point::geography, t2.end_point::geography) as distance_meters
        FROM trail_endpoints t1
        JOIN trail_endpoints t2 ON t1.app_uuid < t2.app_uuid
        WHERE ST_DWithin(t1.end_point::geography, t2.end_point::geography, $2)
          AND ST_Distance(t1.end_point::geography, t2.end_point::geography) > 0
      ),
      proximity_groups AS (
        -- Group trails by proximity using a connected components approach
        SELECT 
          ROW_NUMBER() OVER (ORDER BY MIN(distance_meters)) as group_id,
          COUNT(DISTINCT trail1_uuid) + COUNT(DISTINCT trail2_uuid) as trail_count,
          ARRAY_AGG(DISTINCT trail1_uuid) || ARRAY_AGG(DISTINCT trail2_uuid) as trail_uuids,
          ARRAY_AGG(DISTINCT trail1_name) || ARRAY_AGG(DISTINCT trail2_name) as trail_names,
          AVG(distance_meters) as avg_distance_meters,
          MIN(distance_meters) as min_distance_meters,
          MAX(distance_meters) as max_distance_meters
        FROM proximity_pairs
        GROUP BY 
          -- Group by connected components (simplified approach)
          CASE 
            WHEN trail1_uuid < trail2_uuid THEN trail1_uuid::text || '_' || trail2_uuid::text
            ELSE trail2_uuid::text || '_' || trail1_uuid::text
          END
        HAVING COUNT(*) >= 1
      )
      SELECT 
        group_id,
        trail_count,
        trail_uuids,
        trail_names,
        avg_distance_meters,
        min_distance_meters,
        max_distance_meters
      FROM proximity_groups
      ORDER BY min_distance_meters ASC
      LIMIT 50  -- Process up to 50 groups per iteration
    `;

    const result = await client.query(query, [minTrailLengthMeters, toleranceMeters]);
    return result.rows;
  }

  /**
   * Process a proximity group by snapping trails to a common vertex and splitting them
   */
  private async processProximityGroup(client: any, group: any, toleranceMeters: number): Promise<{
    success: boolean;
    trailsSnapped: number;
    trailsSplit: number;
    verticesCreated: number;
  }> {
    try {
      // Ensure we start with a clean transaction state
      try {
        await client.query('ROLLBACK');
      } catch (e) {
        // Ignore rollback errors if no transaction is active
      }
      await client.query('BEGIN');

      // Step 1: Calculate the centroid of all proximity points
      const centroidResult = await client.query(`
        WITH trail_endpoints AS (
          SELECT 
            app_uuid,
            name,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point
          FROM ${this.config.stagingSchema}.trails
          WHERE app_uuid = ANY($1)
        ),
        all_points AS (
          SELECT start_point as point FROM trail_endpoints
          UNION ALL
          SELECT end_point as point FROM trail_endpoints
        )
        SELECT 
          ST_Centroid(ST_Collect(point)) as centroid_point,
          COUNT(*) as point_count
        FROM all_points
      `, [group.trail_uuids]);

      if (centroidResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, trailsSnapped: 0, trailsSplit: 0, verticesCreated: 0 };
      }

      const centroidPoint = centroidResult.rows[0].centroid_point;
      const pointCount = centroidResult.rows[0].point_count;

      console.log(`         📍 Centroid calculated from ${pointCount} points`);

      // Step 2: Find trails that need to be snapped to the centroid
      const trailsToSnap = await client.query(`
        WITH trail_endpoints AS (
          SELECT 
            app_uuid,
            name,
            geometry,
            ST_StartPoint(geometry) as start_point,
            ST_EndPoint(geometry) as end_point
          FROM ${this.config.stagingSchema}.trails
          WHERE app_uuid = ANY($1)
        )
        SELECT 
          app_uuid,
          name,
          geometry,
          start_point,
          end_point,
          CASE 
            WHEN ST_Distance(start_point::geography, $2::geography) <= ST_Distance(end_point::geography, $2::geography)
            THEN 'start'
            ELSE 'end'
          END as closest_endpoint_type,
          CASE 
            WHEN ST_Distance(start_point::geography, $2::geography) <= ST_Distance(end_point::geography, $2::geography)
            THEN start_point
            ELSE end_point
          END as closest_endpoint,
          LEAST(
            ST_Distance(start_point::geography, $2::geography),
            ST_Distance(end_point::geography, $2::geography)
          ) as distance_to_centroid
        FROM trail_endpoints
        WHERE LEAST(
          ST_Distance(start_point::geography, $2::geography),
          ST_Distance(end_point::geography, $2::geography)
        ) <= $3
        ORDER BY distance_to_centroid ASC
      `, [group.trail_uuids, centroidPoint, toleranceMeters]);

      if (trailsToSnap.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, trailsSnapped: 0, trailsSplit: 0, verticesCreated: 0 };
      }

      console.log(`         🔗 Found ${trailsToSnap.rows.length} trails to snap to centroid`);

      let trailsSnapped = 0;
      let trailsSplit = 0;

      // Step 3: Snap and split each trail
      for (const trail of trailsToSnap.rows) {
        try {
          // Check if this trail has already been split at this location
          const coordResult = await client.query(`
            SELECT 
              ST_X($1) as x,
              ST_Y($1) as y,
              ST_Z($1) as z
          `, [centroidPoint]);
          
          const trailCoords = {
            x: coordResult.rows[0].x,
            y: coordResult.rows[0].y,
            z: coordResult.rows[0].z || 0
          };

          const isDuplicate = this.splitManager.isDuplicateSplit(trail.app_uuid, trailCoords);
          if (isDuplicate) {
            console.log(`         ⏭️  Skipping ${trail.name} - already split within tolerance`);
            continue;
          }

          // Snap the trail to the centroid
          const snappedGeometry = await this.snapTrailToPoint(
            client, 
            trail.geometry, 
            centroidPoint, 
            trail.closest_endpoint_type
          );

          if (!snappedGeometry) {
            console.log(`         ⚠️  Failed to snap ${trail.name}`);
            continue;
          }

          // Split the trail at the centroid point
          const splitResult = await this.splitTrailAtPoint(
            client,
            trail.app_uuid,
            trail.name,
            snappedGeometry,
            centroidPoint
          );

          if (splitResult.success) {
            trailsSnapped++;
            trailsSplit += splitResult.segmentsCreated;

            // Record this split
            this.splitManager.recordSplit(
              trail.app_uuid,
              trail.name,
              trailCoords,
              'ProximitySnapping',
              1
            );

            console.log(`         ✅ Snapped and split ${trail.name}: ${splitResult.segmentsCreated} segments`);
          }

        } catch (error) {
          console.error(`         ❌ Error processing trail ${trail.name}:`, error);
          // Continue processing other trails even if one fails
          continue;
        }
      }

      await client.query('COMMIT');

      return {
        success: true,
        trailsSnapped,
        trailsSplit,
        verticesCreated: trailsSnapped > 0 ? 1 : 0 // One vertex per proximity group
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Snap a trail geometry to a specific point
   */
  private async snapTrailToPoint(client: any, geometry: any, targetPoint: any, endpointType: string): Promise<any> {
    try {
      const snapQuery = `
        SELECT 
          CASE 
            WHEN $3 = 'start' THEN
              ST_SetPoint($1, 0, $2)
            ELSE
              ST_SetPoint($1, ST_NPoints($1) - 1, $2)
          END as snapped_geometry
      `;

      const result = await client.query(snapQuery, [geometry, targetPoint, endpointType]);
      return result.rows[0]?.snapped_geometry;
    } catch (error) {
      console.error('Error snapping trail to point:', error);
      return null;
    }
  }

  /**
   * Split a trail at a specific point
   */
  private async splitTrailAtPoint(client: any, trailUuid: string, trailName: string, geometry: any, splitPoint: any): Promise<{
    success: boolean;
    segmentsCreated: number;
  }> {
    try {
      // Split the trail at the point
      const splitQuery = `
        WITH split_segments AS (
          SELECT (ST_Dump(ST_Split($1, $2))).geom as segment_geom
        )
        SELECT 
          segment_geom,
          ST_Length(segment_geom::geography) as length_meters
        FROM split_segments
        WHERE ST_Length(segment_geom::geography) > 0.1  -- Minimum 0.1m length
        ORDER BY ST_Length(segment_geom::geography) DESC
      `;

      const splitResult = await client.query(splitQuery, [geometry, splitPoint]);
      
      if (splitResult.rows.length === 0) {
        return { success: false, segmentsCreated: 0 };
      }

      // Delete the original trail
      await client.query(`
        DELETE FROM ${this.config.stagingSchema}.trails 
        WHERE app_uuid = $1
      `, [trailUuid]);

      // Insert the split segments
      let segmentsCreated = 0;
      for (let i = 0; i < splitResult.rows.length; i++) {
        const segment = splitResult.rows[i];
        const segmentName = splitResult.rows.length > 1 ? `${trailName} (segment ${i + 1})` : trailName;

        // Get original trail data for proper insertion
        const originalTrailResult = await client.query(`
          SELECT trail_type, surface, difficulty, elevation_gain, elevation_loss, 
                 max_elevation, min_elevation, avg_elevation, source, source_tags, osm_id
          FROM ${this.config.stagingSchema}.trails_backup
          WHERE app_uuid = $1
          LIMIT 1
        `, [trailUuid]);
        
        const originalTrail = originalTrailResult.rows[0];
        
        // Use centralized manager to insert trail with proper original_trail_uuid
        await this.centralizedManager.insertTrail(
          {
            name: segmentName,
            geometry: segment.segment_geom,
            length_km: segment.length_meters / 1000.0,
            trail_type: originalTrail.trail_type,
            surface: originalTrail.surface,
            difficulty: originalTrail.difficulty,
            elevation_gain: originalTrail.elevation_gain,
            elevation_loss: originalTrail.elevation_loss,
            max_elevation: originalTrail.max_elevation,
            min_elevation: originalTrail.min_elevation,
            avg_elevation: originalTrail.avg_elevation,
            source: originalTrail.source,
            source_tags: originalTrail.source_tags,
            osm_id: originalTrail.osm_id
          },
          'ProximitySnappingSplittingService',
          true, // isReplacementTrail
          trailUuid // originalTrailId
        );

        segmentsCreated++;
      }

      return { success: true, segmentsCreated };

    } catch (error) {
      console.error('Error splitting trail at point:', error);
      return { success: false, segmentsCreated: 0 };
    }
  }
}
