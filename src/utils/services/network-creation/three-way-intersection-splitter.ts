import { Pool } from 'pg';

export interface ThreeWayIntersectionConfig {
  stagingSchema: string;
  intersectionPoint: {
    lat: number;
    lng: number;
  };
  searchRadiusMeters: number; // Radius to search for trails to split
  splitToleranceMeters: number; // How close to the point to split
}

export interface ThreeWayIntersectionResult {
  success: boolean;
  trailsSplit: number;
  newIntersectionNode: number;
  trailsFound: Array<{
    trailId: string;
    trailName: string;
    distanceToPoint: number;
    splitSuccessful: boolean;
  }>;
  error?: string;
}

export class ThreeWayIntersectionSplitter {
  constructor(private pgClient: Pool, private config: ThreeWayIntersectionConfig) {}

  /**
   * Split trails to create a 3-way intersection at a specific point
   */
  async splitIntersection(): Promise<ThreeWayIntersectionResult> {
    console.log(`🛤️ Creating 3-way intersection at (${this.config.intersectionPoint.lat}, ${this.config.intersectionPoint.lng})...`);
    
    try {
      // 1. Find all trails that pass within the search radius of the intersection point
      const trailsNearPoint = await this.findTrailsNearPoint();
      
      if (trailsNearPoint.length < 2) {
        throw new Error(`Only found ${trailsNearPoint.length} trails near intersection point. Need at least 2 trails for an intersection.`);
      }
      
      console.log(`📍 Found ${trailsNearPoint.length} trails near intersection point:`);
      trailsNearPoint.forEach(trail => {
        console.log(`  - ${trail.trail_name} (${trail.app_uuid}) - ${trail.distance_meters.toFixed(2)}m away`);
      });
      
      // 2. Split each trail at the intersection point
      const splitResults = [];
      let trailsSplit = 0;
      
      for (const trail of trailsNearPoint) {
        try {
          const splitSuccess = await this.splitTrailAtPoint(trail);
          splitResults.push({
            trailId: trail.app_uuid,
            trailName: trail.trail_name,
            distanceToPoint: trail.distance_meters,
            splitSuccessful: splitSuccess
          });
          
          if (splitSuccess) {
            trailsSplit++;
            console.log(`✅ Successfully split trail: ${trail.trail_name}`);
          } else {
            console.log(`❌ Failed to split trail: ${trail.trail_name}`);
          }
        } catch (error) {
          console.error(`❌ Error splitting trail ${trail.trail_name}:`, error);
          splitResults.push({
            trailId: trail.app_uuid,
            trailName: trail.trail_name,
            distanceToPoint: trail.distance_meters,
            splitSuccessful: false
          });
        }
      }
      
      console.log(`🎯 Successfully split ${trailsSplit} trails at intersection point`);
      
      return {
        success: true,
        trailsSplit,
        newIntersectionNode: 0, // Will be assigned when topology is recreated
        trailsFound: splitResults
      };
      
    } catch (error) {
      console.error('❌ Error creating 3-way intersection:', error);
      return {
        success: false,
        trailsSplit: 0,
        newIntersectionNode: 0,
        trailsFound: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Find trails that pass within the search radius of the intersection point
   */
  private async findTrailsNearPoint(): Promise<Array<{
    app_uuid: string;
    trail_name: string;
    geometry: any;
    distance_meters: number;
  }>> {
    const intersectionWKT = `POINT(${this.config.intersectionPoint.lng} ${this.config.intersectionPoint.lat})`;
    
    const query = `
      SELECT 
        app_uuid,
        name as trail_name,
        geometry,
        ST_Distance(geometry::geography, ST_GeomFromText($1, 4326)::geography) as distance_meters
      FROM ${this.config.stagingSchema}.trails
      WHERE ST_DWithin(
        geometry::geography, 
        ST_GeomFromText($1, 4326)::geography, 
        $2
      )
      ORDER BY distance_meters ASC
    `;
    
    const result = await this.pgClient.query(query, [
      intersectionWKT,
      this.config.searchRadiusMeters
    ]);
    
    return result.rows;
  }

  /**
   * Split a specific trail at the intersection point
   */
  private async splitTrailAtPoint(trail: any): Promise<boolean> {
    const intersectionWKT = `POINT(${this.config.intersectionPoint.lng} ${this.config.intersectionPoint.lat})`;
    
    try {
      // Check if the trail actually needs splitting (not already at an endpoint)
      const distanceToStart = await this.pgClient.query(`
        SELECT ST_Distance(
          ST_StartPoint($1::geometry)::geography,
          ST_GeomFromText($2, 4326)::geography
        ) as distance
      `, [trail.geometry, intersectionWKT]);
      
      const distanceToEnd = await this.pgClient.query(`
        SELECT ST_Distance(
          ST_EndPoint($1::geometry)::geography,
          ST_GeomFromText($2, 4326)::geography
        ) as distance
      `, [trail.geometry, intersectionWKT]);
      
      const startDistance = distanceToStart.rows[0].distance;
      const endDistance = distanceToEnd.rows[0].distance;
      
      // If the intersection point is very close to an endpoint, don't split
      if (startDistance < this.config.splitToleranceMeters || endDistance < this.config.splitToleranceMeters) {
        console.log(`⏭️ Trail ${trail.trail_name} already has endpoint near intersection point (start: ${startDistance.toFixed(2)}m, end: ${endDistance.toFixed(2)}m)`);
        return true; // Consider this successful since no split is needed
      }
      
      // Find the closest point on the trail to the intersection point
      const closestPointQuery = `
        SELECT ST_ClosestPoint($1::geometry, ST_GeomFromText($2, 4326)) as closest_point
      `;
      
      const closestPointResult = await this.pgClient.query(closestPointQuery, [
        trail.geometry,
        intersectionWKT
      ]);
      
      const closestPoint = closestPointResult.rows[0].closest_point;
      
      // Split the trail at the closest point
      const splitQuery = `
        WITH split_result AS (
          SELECT 
            (ST_Dump(ST_Split($1::geometry, $2::geometry))).geom as segment,
            (ST_Dump(ST_Split($1::geometry, $2::geometry))).path[1] as segment_id
        )
        SELECT 
          segment_id,
          ST_AsText(segment) as segment_wkt,
          ST_Length(segment::geography) as segment_length
        FROM split_result
        WHERE ST_Length(segment::geography) > 1 -- Only keep segments longer than 1 meter
        ORDER BY segment_id
      `;
      
      const splitResult = await this.pgClient.query(splitQuery, [
        trail.geometry,
        closestPoint
      ]);
      
      if (splitResult.rows.length < 2) {
        console.log(`⚠️ Trail ${trail.trail_name} could not be split (only ${splitResult.rows.length} segments created)`);
        return false;
      }
      
      // Get original trail properties
      const originalTrailQuery = `
        SELECT app_uuid, name, length_km, elevation_gain, elevation_loss
        FROM ${this.config.stagingSchema}.trails
        WHERE app_uuid = $1
      `;
      
      const originalTrail = await this.pgClient.query(originalTrailQuery, [trail.app_uuid]);
      const original = originalTrail.rows[0];
      
      // Delete the original trail
      await this.pgClient.query(
        `DELETE FROM ${this.config.stagingSchema}.trails WHERE app_uuid = $1`,
        [trail.app_uuid]
      );
      
      // Insert the split segments as new trails
      for (let i = 0; i < splitResult.rows.length; i++) {
        const segment = splitResult.rows[i];
        const segmentUuid = `${original.app_uuid}_segment_${i + 1}`;
        const segmentName = original.name;
        const segmentLengthKm = segment.segment_length / 1000;
        
        // Proportionally distribute elevation gain/loss based on segment length
        const lengthRatio = segmentLengthKm / original.length_km;
        const segmentElevationGain = original.elevation_gain * lengthRatio;
        const segmentElevationLoss = original.elevation_loss * lengthRatio;
        
        await this.pgClient.query(`
          INSERT INTO ${this.config.stagingSchema}.trails (
            app_uuid, name, geometry, length_km, elevation_gain, elevation_loss
          ) VALUES ($1, $2, ST_GeomFromText($3, 4326), $4, $5, $6)
        `, [
          segmentUuid,
          segmentName,
          segment.segment_wkt,
          segmentLengthKm,
          segmentElevationGain,
          segmentElevationLoss
        ]);
      }
      
      console.log(`✅ Split trail ${trail.trail_name} into ${splitResult.rows.length} segments`);
      return true;
      
    } catch (error) {
      console.error(`❌ Error splitting trail ${trail.trail_name}:`, error);
      return false;
    }
  }

  /**
   * Recreate pgRouting topology after splitting trails
   */
  async recreateTopology(): Promise<boolean> {
    try {
      console.log('🔄 Recreating pgRouting topology after trail splitting...');
      
      // Drop existing topology tables if they exist
      await this.pgClient.query(`
        DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded CASCADE;
        DROP TABLE IF EXISTS ${this.config.stagingSchema}.ways_noded_vertices_pgr CASCADE;
      `);
      
      // Create ways_noded table from split trails
      await this.pgClient.query(`
        CREATE TABLE ${this.config.stagingSchema}.ways_noded AS
        SELECT 
          row_number() OVER () as id,
          app_uuid,
          name,
          geometry as the_geom,
          length_km,
          elevation_gain,
          elevation_loss
        FROM ${this.config.stagingSchema}.trails
        WHERE ST_IsValid(geometry) AND ST_Length(geometry::geography) > 1;
      `);
      
      // Add required pgRouting columns
      await this.pgClient.query(`
        ALTER TABLE ${this.config.stagingSchema}.ways_noded 
        ADD COLUMN source integer,
        ADD COLUMN target integer;
      `);
      
      // Create spatial index
      await this.pgClient.query(`
        CREATE INDEX ways_noded_geom_idx ON ${this.config.stagingSchema}.ways_noded USING GIST (the_geom);
      `);
      
      // Create pgRouting topology
      await this.pgClient.query(`
        SELECT pgr_createTopology('${this.config.stagingSchema}.ways_noded', 0.00001, 'the_geom', 'id', 'source', 'target');
      `);
      
      console.log('✅ Successfully recreated pgRouting topology');
      return true;
      
    } catch (error) {
      console.error('❌ Error recreating topology:', error);
      return false;
    }
  }
}
