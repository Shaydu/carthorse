import { Pool } from 'pg';

export interface SimpleTrailSnappingResult {
  success: boolean;
  trailsSnapped: number;
  intersectionsFound: number;
  error?: string;
}

export interface TrailSnappingPair {
  trail1Uuid: string;
  trail1Name: string;
  trail2Uuid: string;
  trail2Name: string;
  distanceMeters: number;
  snapPoint: any;
}

export class SimpleTrailSnappingService {
  private stagingSchema: string;
  private pgClient: Pool;

  constructor(config: { stagingSchema: string; pgClient: Pool }) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
  }

  /**
   * Simple trail snapping - just snap trails together without splitting
   * This is much more efficient than creating new intersection points
   */
  async snapTrailsTogether(): Promise<SimpleTrailSnappingResult> {
    try {
      console.log('🔗 Starting simple trail snapping (no splitting)...');
      
      // Step 1: Find trails that are close but don't intersect
      const snappingPairs = await this.findTrailsToSnap();
      
      console.log(`🔍 Found ${snappingPairs.length} trail pairs to snap`);
      
      if (snappingPairs.length === 0) {
        return {
          success: true,
          trailsSnapped: 0,
          intersectionsFound: 0
        };
      }

      // Step 2: Snap trails together
      let trailsSnapped = 0;
      for (const pair of snappingPairs) {
        console.log(`🔗 Snapping: ${pair.trail1Name} ↔ ${pair.trail2Name} (${pair.distanceMeters.toFixed(3)}m)`);
        
        const snapSuccess = await this.snapTrailPair(pair);
        if (snapSuccess) {
          trailsSnapped++;
        }
      }

      console.log(`✅ Simple trail snapping completed: ${trailsSnapped} trail pairs snapped`);

      return {
        success: true,
        trailsSnapped,
        intersectionsFound: snappingPairs.length
      };

    } catch (error) {
      console.error('❌ Error in simple trail snapping:', error);
      return {
        success: false,
        trailsSnapped: 0,
        intersectionsFound: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Find trail pairs that should be snapped together
   * Focus on trails that are very close but don't intersect
   */
  private async findTrailsToSnap(): Promise<TrailSnappingPair[]> {
    console.log('🔍 Finding trails to snap...');

    // Use a conservative tolerance for snapping
    const toleranceMeters = 2.0; // 2 meter tolerance
    const toleranceDegrees = toleranceMeters / 111000; // Rough conversion to degrees

    const query = `
      WITH trail_pairs AS (
        SELECT DISTINCT
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.geometry as trail1_geom,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.geometry as trail2_geom
        FROM ${this.stagingSchema}.trails t1
        CROSS JOIN ${this.stagingSchema}.trails t2
        WHERE t1.app_uuid < t2.app_uuid  -- Avoid duplicate pairs
          AND ST_DWithin(t1.geometry, t2.geometry, $1)  -- Within tolerance
          AND NOT ST_Intersects(t1.geometry, t2.geometry)  -- Don't already intersect
          AND t1.name IS NOT NULL  -- Only named trails
          AND t2.name IS NOT NULL  -- Only named trails
          AND t1.name != ''  -- Not empty names
          AND t2.name != ''  -- Not empty names
      ),
      closest_points AS (
        SELECT 
          trail1_uuid, trail1_name, trail1_geom,
          trail2_uuid, trail2_name, trail2_geom,
          ST_Distance(trail1_geom, trail2_geom) as distance_meters,
          ST_ClosestPoint(trail1_geom, trail2_geom) as snap_point
        FROM trail_pairs
      )
      SELECT 
        trail1_uuid,
        trail1_name,
        trail2_uuid,
        trail2_name,
        distance_meters,
        snap_point
      FROM closest_points
      WHERE distance_meters <= $2  -- Within tolerance
      ORDER BY distance_meters
      LIMIT 100  -- Process most promising pairs first
    `;

    const result = await this.pgClient.query(query, [toleranceDegrees, toleranceMeters]);
    
    console.log(`🔍 Found ${result.rows.length} trail pairs to snap`);
    if (result.rows.length > 0) {
      console.log('   Top snapping candidates:');
      result.rows.slice(0, 5).forEach((row, i) => {
        console.log(`   ${i+1}. ${row.trail1_name} ↔ ${row.trail2_name} (${parseFloat(row.distance_meters).toFixed(3)}m)`);
      });
    }
    
    return result.rows.map(row => ({
      trail1Uuid: row.trail1_uuid,
      trail1Name: row.trail1_name,
      trail2Uuid: row.trail2_uuid,
      trail2Name: row.trail2_name,
      distanceMeters: parseFloat(row.distance_meters),
      snapPoint: row.snap_point
    }));
  }

  /**
   * Snap two trails together by moving their endpoints to meet
   * This is much simpler than splitting - just snap the geometries
   */
  private async snapTrailPair(pair: TrailSnappingPair): Promise<boolean> {
    try {
      console.log(`   🔧 Snapping: ${pair.trail1Name} ↔ ${pair.trail2Name}`);

      // Get both trail geometries
      const [trail1Result, trail2Result] = await Promise.all([
        this.pgClient.query(`
          SELECT geometry, name
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = $1
        `, [pair.trail1Uuid]),
        this.pgClient.query(`
          SELECT geometry, name
          FROM ${this.stagingSchema}.trails 
          WHERE app_uuid = $1
        `, [pair.trail2Uuid])
      ]);

      if (trail1Result.rows.length === 0 || trail2Result.rows.length === 0) {
        console.log(`   ⚠️ One or both trails not found`);
        return false;
      }

      const trail1 = trail1Result.rows[0];
      const trail2 = trail2Result.rows[0];

      // Snap both trails to each other
      const snappedResult = await this.pgClient.query(`
        SELECT 
          ST_Force3D(ST_Snap($1::geometry, $2::geometry, 1e-6)) as trail1_snapped,
          ST_Force3D(ST_Snap($2::geometry, $1::geometry, 1e-6)) as trail2_snapped
      `, [trail1.geometry, trail2.geometry]);

      if (snappedResult.rows.length === 0) {
        console.log(`   ⚠️ Could not snap trails`);
        return false;
      }

      const trail1Snapped = snappedResult.rows[0].trail1_snapped;
      const trail2Snapped = snappedResult.rows[0].trail2_snapped;

      // Update both trails with snapped geometries
      await Promise.all([
        this.pgClient.query(`
          UPDATE ${this.stagingSchema}.trails 
          SET geometry = $1
          WHERE app_uuid = $2
        `, [trail1Snapped, pair.trail1Uuid]),
        this.pgClient.query(`
          UPDATE ${this.stagingSchema}.trails 
          SET geometry = $1
          WHERE app_uuid = $2
        `, [trail2Snapped, pair.trail2Uuid])
      ]);

      console.log(`   ✅ Successfully snapped ${pair.trail1Name} ↔ ${pair.trail2Name}`);
      return true;

    } catch (error) {
      console.error(`   ❌ Error snapping ${pair.trail1Name} ↔ ${pair.trail2Name}:`, error);
      return false;
    }
  }

  /**
   * Get statistics about the current trail network
   */
  async getNetworkStatistics(): Promise<{
    totalTrails: number;
    averageTrailLength: number;
    trailsWithIntersections: number;
  }> {
    const statsResult = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        AVG(ST_Length(geometry::geography)) as avg_length_meters,
        COUNT(CASE WHEN original_trail_uuid IS NOT NULL THEN 1 END) as trails_with_intersections
      FROM ${this.stagingSchema}.trails
    `);

    const stats = statsResult.rows[0];
    return {
      totalTrails: parseInt(stats.total_trails),
      averageTrailLength: parseFloat(stats.avg_length_meters) || 0,
      trailsWithIntersections: parseInt(stats.trails_with_intersections)
    };
  }
}
