import { Pool } from 'pg';

export interface IntersectionBasedSplittingConfig {
  stagingSchema: string;
  intersectionToleranceMeters: number; // How close trails need to be to create an intersection
  minSegmentLengthMeters: number; // Minimum length for a trail segment after splitting
  preserveOriginalTrailNames: boolean; // Whether to preserve original trail names in segments
}

export interface IntersectionBasedSplittingResult {
  success: boolean;
  intersectionsFound: number;
  trailsSplit: number;
  newTrailSegments: number;
  connectivityImprovements: number;
  error?: string;
  details?: {
    intersectionPoints: Array<{
      lat: number;
      lng: number;
      trailsInvolved: number;
      degree: number;
    }>;
    splitTrails: Array<{
      originalTrailId: string;
      originalTrailName: string;
      segmentsCreated: number;
      splitSuccessful: boolean;
    }>;
  };
}

export class IntersectionBasedTrailSplitter {
  constructor(private pgClient: Pool, private config: IntersectionBasedSplittingConfig) {}

  /**
   * Split all trails at their intersection points to create proper routing nodes
   */
  async splitTrailsAtIntersections(): Promise<IntersectionBasedSplittingResult> {
    console.log('🛤️ Splitting trails at all intersection points...');
    
    try {
      // Step 1: Find all intersection points between trails
      const intersectionPoints = await this.findIntersectionPoints();
      console.log(`📍 Found ${intersectionPoints.length} intersection points`);
      
      // Step 2: Split trails at each intersection point
      const splitResults = await this.splitTrailsAtPoints(intersectionPoints);
      
      // Step 3: Clean up any duplicate or very short segments
      await this.cleanupShortSegments();
      
      // Step 4: Validate the splitting results
      const validation = await this.validateSplittingResults();
      
      return {
        success: true,
        intersectionsFound: intersectionPoints.length,
        trailsSplit: splitResults.trailsSplit,
        newTrailSegments: splitResults.newSegments,
        connectivityImprovements: validation.connectivityImprovements,
        details: {
          intersectionPoints: intersectionPoints.map(p => ({
            lat: p.lat,
            lng: p.lng,
            trailsInvolved: p.trail_count,
            degree: p.trail_count
          })),
          splitTrails: splitResults.trailDetails
        }
      };
      
    } catch (error) {
      console.error('❌ Error splitting trails at intersections:', error);
      return {
        success: false,
        intersectionsFound: 0,
        trailsSplit: 0,
        newTrailSegments: 0,
        connectivityImprovements: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find all points where trails intersect
   */
  private async findIntersectionPoints(): Promise<Array<{
    lat: number;
    lng: number;
    trail_count: number;
    intersecting_trails: string[];
  }>> {
    const query = `
      WITH trail_intersections AS (
        SELECT 
          t1.app_uuid as trail1_id,
          t1.name as trail1_name,
          t2.app_uuid as trail2_id,
          t2.name as trail2_name,
          ST_Intersection(t1.geometry, t2.geometry) as intersection_geom
        FROM ${this.config.stagingSchema}.trails t1
        CROSS JOIN ${this.config.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid -- Avoid duplicate pairs
          AND ST_Intersects(t1.geometry, t2.geometry)
          AND ST_GeometryType(ST_Intersection(t1.geometry, t2.geometry)) = 'ST_Point'
      ),
      intersection_points AS (
        SELECT 
          ST_X(intersection_geom) as lng,
          ST_Y(intersection_geom) as lat,
          intersection_geom,
          COUNT(*) as trail_count,
          ARRAY_AGG(DISTINCT trail1_id || ':' || trail1_name) || 
          ARRAY_AGG(DISTINCT trail2_id || ':' || trail2_name) as intersecting_trails
        FROM trail_intersections
        GROUP BY intersection_geom
        HAVING COUNT(*) >= 1 -- At least 2 trails intersect
      )
      SELECT 
        lat,
        lng,
        trail_count,
        intersecting_trails
      FROM intersection_points
      ORDER BY trail_count DESC, lat, lng
    `;
    
    const result = await this.pgClient.query(query);
    return result.rows;
  }

  /**
   * Split trails at specific intersection points
   */
  private async splitTrailsAtPoints(intersectionPoints: any[]): Promise<{
    trailsSplit: number;
    newSegments: number;
    trailDetails: Array<{
      originalTrailId: string;
      originalTrailName: string;
      segmentsCreated: number;
      splitSuccessful: boolean;
    }>;
  }> {
    let trailsSplit = 0;
    let newSegments = 0;
    const trailDetails: any[] = [];
    
    // Get all trails that need to be split
    const trailsToSplit = await this.getTrailsToSplit(intersectionPoints);
    console.log(`🛤️ Found ${trailsToSplit.length} trails that need splitting`);
    
    for (const trail of trailsToSplit) {
      try {
        const splitResult = await this.splitTrailAtIntersections(trail, intersectionPoints);
        
        trailDetails.push({
          originalTrailId: trail.app_uuid,
          originalTrailName: trail.name,
          segmentsCreated: splitResult.segmentsCreated,
          splitSuccessful: splitResult.success
        });
        
        if (splitResult.success) {
          trailsSplit++;
          newSegments += splitResult.segmentsCreated;
          console.log(`✅ Split trail "${trail.name}" into ${splitResult.segmentsCreated} segments`);
        } else {
          console.log(`❌ Failed to split trail "${trail.name}"`);
        }
        
      } catch (error) {
        console.error(`❌ Error splitting trail "${trail.name}":`, error);
        trailDetails.push({
          originalTrailId: trail.app_uuid,
          originalTrailName: trail.name,
          segmentsCreated: 0,
          splitSuccessful: false
        });
      }
    }
    
    return {
      trailsSplit,
      newSegments,
      trailDetails
    };
  }

  /**
   * Get all trails that intersect with any of the intersection points
   */
  private async getTrailsToSplit(intersectionPoints: any[]): Promise<Array<{
    app_uuid: string;
    name: string;
    geometry: any;
    length_km: number;
    elevation_gain: number;
    elevation_loss: number;
  }>> {
    if (intersectionPoints.length === 0) {
      return [];
    }
    
    // Create a geometry collection of all intersection points
    const intersectionWKT = intersectionPoints.map(p => 
      `POINT(${p.lng} ${p.lat})`
    ).join(',');
    
    const query = `
      SELECT DISTINCT
        t.app_uuid,
        t.name,
        t.geometry,
        t.length_km,
        t.elevation_gain,
        t.elevation_loss
      FROM ${this.config.stagingSchema}.trails t
      WHERE EXISTS (
        SELECT 1
        FROM (SELECT ST_GeomFromText('POINT(${intersectionPoints[0].lng} ${intersectionPoints[0].lat})', 4326) as point_geom) as points
        WHERE ST_DWithin(t.geometry::geography, points.point_geom::geography, $1)
      )
      ORDER BY t.name
    `;
    
    const result = await this.pgClient.query(query, [
      this.config.intersectionToleranceMeters
    ]);
    
    return result.rows;
  }

  /**
   * Split a single trail at all its intersection points
   */
  private async splitTrailAtIntersections(trail: any, intersectionPoints: any[]): Promise<{
    success: boolean;
    segmentsCreated: number;
  }> {
    try {
      // Find which intersection points are on this trail
      const trailIntersectionPoints = [];
      
      for (const point of intersectionPoints) {
        const distanceQuery = `
          SELECT ST_Distance(
            $1::geometry::geography,
            ST_GeomFromText('POINT($2 $3)', 4326)::geography
          ) as distance
        `;
        
        const distanceResult = await this.pgClient.query(distanceQuery, [
          trail.geometry,
          point.lng,
          point.lat
        ]);
        
        const distance = distanceResult.rows[0].distance;
        
        if (distance <= this.config.intersectionToleranceMeters) {
          trailIntersectionPoints.push({
            lng: point.lng,
            lat: point.lat,
            distance: distance
          });
        }
      }
      
      if (trailIntersectionPoints.length === 0) {
        return { success: true, segmentsCreated: 1 }; // No splitting needed
      }
      
      // Sort intersection points by distance along the trail
      trailIntersectionPoints.sort((a, b) => a.distance - b.distance);
      
      // Split the trail at each intersection point
      let currentGeometry = trail.geometry;
      const segments = [];
      
      for (const point of trailIntersectionPoints) {
        const pointWKT = `POINT(${point.lng} ${point.lat})`;
        
        // Find the closest point on the trail to the intersection point
        const closestPointQuery = `
          SELECT ST_ClosestPoint($1::geometry, ST_GeomFromText($2, 4326)) as closest_point
        `;
        
        const closestPointResult = await this.pgClient.query(closestPointQuery, [
          currentGeometry,
          pointWKT
        ]);
        
        const closestPoint = closestPointResult.rows[0].closest_point;
        
        // Split the current geometry at the closest point
        const splitQuery = `
          SELECT 
            (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom as segment,
            (ST_Dump(ST_Split($1::geometry, $2::geometry))).path[1] as segment_id
          FROM (SELECT $1::geometry as geom) as g
        `;
        
        const splitResult = await this.pgClient.query(splitQuery, [
          currentGeometry,
          closestPoint
        ]);
        
        if (splitResult.rows.length >= 2) {
          // Add the first segment to our results
          const firstSegment = splitResult.rows[0];
          if (ST_Length(firstSegment.segment) >= this.config.minSegmentLengthMeters) {
            segments.push(firstSegment.segment);
          }
          
          // Continue with the second segment for further splitting
          currentGeometry = splitResult.rows[1].segment;
        }
      }
      
      // Add the final segment
      if (ST_Length(currentGeometry) >= this.config.minSegmentLengthMeters) {
        segments.push(currentGeometry);
      }
      
      if (segments.length <= 1) {
        return { success: true, segmentsCreated: 1 }; // No effective splitting
      }
      
      // Delete the original trail
      await this.pgClient.query(
        `DELETE FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1`,
        [trail.app_uuid]
      );
      
      // Insert the new segments
      const originalLength = trail.length_km;
      const originalElevationGain = trail.elevation_gain;
      const originalElevationLoss = trail.elevation_loss;
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentLength = ST_Length(segment) / 1000; // Convert to km
        const lengthRatio = segmentLength / originalLength;
        
        const segmentUuid = `${trail.app_uuid}_segment_${i + 1}`;
        const segmentName = this.config.preserveOriginalTrailNames 
          ? `${trail.name} Segment ${i + 1}`
          : `${trail.name}_${i + 1}`;
        
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.trails (
            app_uuid, name, geometry, length_km, elevation_gain, elevation_loss
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          segmentUuid,
          segmentName,
          segment,
          segmentLength,
          originalElevationGain * lengthRatio,
          originalElevationLoss * lengthRatio
        ]);
      }
      
      return {
        success: true,
        segmentsCreated: segments.length
      };
      
    } catch (error) {
      console.error(`❌ Error splitting trail ${trail.name}:`, error);
      return {
        success: false,
        segmentsCreated: 0
      };
    }
  }

  /**
   * Clean up any segments that are too short
   */
  private async cleanupShortSegments(): Promise<void> {
    const query = `
      DELETE FROM ${this.config.stagingSchema}.trails
      WHERE ST_Length(geometry::geography) < $1
    `;
    
    const result = await this.pgClient.query(query, [
      this.config.minSegmentLengthMeters
    ]);
    
    console.log(`🧹 Cleaned up ${result.rowCount} segments shorter than ${this.config.minSegmentLengthMeters}m`);
  }

  /**
   * Validate the splitting results
   */
  private async validateSplittingResults(): Promise<{
    connectivityImprovements: number;
  }> {
    // Count how many trails we now have
    const trailCountQuery = `
      SELECT COUNT(*) as trail_count
      FROM ${this.config.stagingSchema}.trails
    `;
    
    const trailCountResult = await this.pgClient.query(trailCountQuery);
    const trailCount = trailCountResult.rows[0].trail_count;
    
    console.log(`📊 After splitting: ${trailCount} trail segments`);
    
    return {
      connectivityImprovements: trailCount
    };
  }
}
