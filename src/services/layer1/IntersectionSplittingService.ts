import { Pool } from 'pg';
import { TransactionalTrailSplitter, TrailSplitConfig } from '../../utils/services/network-creation/transactional-trail-splitter';
import { OptimizedIntersectionDetectionService } from './OptimizedIntersectionDetectionService';

export interface IntersectionSplittingResult {
  success: boolean;
  splitCount: number;
  error?: string;
  details?: {
    intersectionsFound: number;
    segmentsCreated: number;
    toleranceUsed: number;
    visitedTrailSplit: boolean;
    visitingTrailUnchanged: boolean;
  };
}

export class IntersectionSplittingService {
  private trailSplitter: TransactionalTrailSplitter;
  private optimizedDetectionService: OptimizedIntersectionDetectionService;

  constructor(
    private pgClient: Pool,
    private stagingSchema: string
  ) {
    // Initialize the centralized trail splitter
    const splitConfig: TrailSplitConfig = {
      stagingSchema: this.stagingSchema,
      intersectionToleranceMeters: 3.0,
      minSegmentLengthMeters: 5.0,
      preserveOriginalTrailNames: true,
      validationToleranceMeters: 1.0,
      validationTolerancePercentage: 0.1
    };
    this.trailSplitter = new TransactionalTrailSplitter(this.pgClient, splitConfig);
    
    // Initialize the optimized intersection detection service
    this.optimizedDetectionService = new OptimizedIntersectionDetectionService(
      this.pgClient,
      this.stagingSchema
    );
  }

  /**
   * Apply simplified T-intersection splitting logic
   * Uses the rule: "Does another trail's endpoint come within 3 meters of the path?"
   * Splits visited trails at intersection points to create proper routing graph segments
   */
  async splitTrailsAtIntersections(): Promise<IntersectionSplittingResult> {
    try {
      console.log('🔍 Starting simplified T-intersection splitting (optimized version)...');
      
      // Create optimized indices for better performance
      await this.optimizedDetectionService.createOptimizedIndices();
      
      let totalIntersectionsFound = 0;
      let totalSplitCount = 0;
      let visitedTrailSplit = false;
      let visitingTrailUnchanged = false;

      // Step 1: Find trail pairs where one trail's endpoint is within 3 meters of another trail using optimized detection
      const tIntersectionPairs = await this.optimizedDetectionService.findTIntersectionsOptimized(3.0);
      
      console.log(`Found ${tIntersectionPairs.length} potential T-intersection pairs`);

      for (const pair of tIntersectionPairs) {
        console.log(`\n🔍 Processing T-intersection: ${pair.visitor_name} → ${pair.visited_name} (distance: ${pair.distance.toFixed(2)}m)`);
        
        // Step 2: Apply the simplified splitting logic
        const splitSuccess = await this.splitTIntersection(pair);
        
        if (splitSuccess) {
          totalIntersectionsFound++;
          visitedTrailSplit = true;
          visitingTrailUnchanged = true;
        }
      }

      totalSplitCount = await this.countSplitSegments();

      console.log(`✅ T-intersection splitting completed:`);
      console.log(`   - T-intersections found: ${totalIntersectionsFound}`);
      console.log(`   - Segments created: ${totalSplitCount}`);

      return {
        success: true,
        splitCount: totalSplitCount,
        details: {
          intersectionsFound: totalIntersectionsFound,
          segmentsCreated: totalSplitCount,
          toleranceUsed: 3.0,
          visitedTrailSplit,
          visitingTrailUnchanged
        }
      };

    } catch (error) {
      console.error('❌ Error in T-intersection splitting:', error);
      return {
        success: false,
        splitCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }


  /**
   * Split a T-intersection using the simplified approach
   */
  private async splitTIntersection(pair: any): Promise<boolean> {
    try {
      // Step 1: Get the trail geometries
      const visitorTrail = await this.pgClient.query(`
        SELECT geometry, name FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
      `, [pair.visitor_id]);

      const visitedTrail = await this.pgClient.query(`
        SELECT geometry, name FROM ${this.stagingSchema}.trails WHERE app_uuid = $1
      `, [pair.visited_id]);

      if (visitorTrail.rows.length === 0 || visitedTrail.rows.length === 0) {
        return false;
      }

      const visitorGeom = visitorTrail.rows[0].geometry;
      const visitedGeom = visitedTrail.rows[0].geometry;
      const visitorName = visitorTrail.rows[0].name;
      const visitedName = visitedTrail.rows[0].name;

      // Step 2: Find the closest point on the visited trail to the visitor endpoint
      const closestPointResult = await this.pgClient.query(`
        SELECT ST_ClosestPoint($1::geometry, $2::geometry) as closest_point
      `, [visitedGeom, pair.closest_endpoint]);

      const closestPoint = closestPointResult.rows[0].closest_point;

      // Step 3: Create a line from visitor endpoint to closest point on visited trail
      const extensionLineResult = await this.pgClient.query(`
        SELECT ST_MakeLine($1::geometry, $2::geometry) as extension_line
      `, [pair.closest_endpoint, closestPoint]);

      const extensionLine = extensionLineResult.rows[0].extension_line;

      // Step 4: Find where the extension line intersects the visited trail
      const intersectionResult = await this.pgClient.query(`
        SELECT (ST_Dump(ST_Intersection($1::geometry, $2::geometry))).geom AS intersection_point
      `, [visitedGeom, extensionLine]);

      if (intersectionResult.rows.length === 0) {
        console.log(`   ❌ No intersection found for ${visitorName} → ${visitedName}`);
        return false;
      }

      const intersectionPoint = intersectionResult.rows[0].intersection_point;

      // Step 5: Use centralized trail splitter for validation and consistency
      console.log(`   🔄 Using centralized splitter for ${visitedName} at T-intersection`);
      
      const splitResult = await this.trailSplitter.splitTrailAtomically({
        originalTrailId: pair.visited_id,
        originalTrailName: visitedName,
        originalGeometry: visitedGeom,
        originalLengthKm: pair.visited_length_km || 0,
        originalElevationGain: pair.visited_elevation_gain || 0,
        originalElevationLoss: pair.visited_elevation_loss || 0,
        splitPoints: [{
          lng: intersectionPoint.coordinates[0],
          lat: intersectionPoint.coordinates[1],
          distance: 0 // Distance along trail - would need to be calculated
        }]
      });

      if (splitResult.success && splitResult.segmentsCreated > 1) {
        console.log(`   ✅ Split ${visitedName} into ${splitResult.segmentsCreated} segments using centralized validation`);
        return true;
      } else {
        console.log(`   ⚠️ Split validation failed for ${visitedName}: ${splitResult.error || 'Unknown error'}`);
        return false;
      }
    } catch (error) {
      console.error(`Error splitting T-intersection ${pair.visitor_name} → ${pair.visited_name}:`, error);
      return false;
    }
  }


  /**
   * Count the total number of split segments
   */
  private async countSplitSegments(): Promise<number> {
    const result = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails WHERE name LIKE '%(Segment %'
    `);
    return parseInt(result.rows[0].count);
  }

  /**
   * Cleanup method
   */
  async cleanup(): Promise<void> {
    // Any cleanup needed
  }
}
