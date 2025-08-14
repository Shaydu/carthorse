import { Pool } from 'pg';
import { detectAndFixGaps, validateGapDetection } from '../../utils/gap-detection';

export interface TrailProcessingConfig {
  stagingSchema: string;
  pgClient: Pool;
  region: string;
  bbox?: number[];
  sourceFilter?: string;
}

export interface TrailProcessingResult {
  trailsCopied: number;
  trailsCleaned: number;
  gapsFixed: number;
  overlapsRemoved: number;
}

export class TrailProcessingService {
  private stagingSchema: string;
  private pgClient: Pool;
  private config: TrailProcessingConfig;

  constructor(config: TrailProcessingConfig) {
    this.stagingSchema = config.stagingSchema;
    this.pgClient = config.pgClient;
    this.config = config;
  }

  /**
   * Process Layer 1: Clean trail network
   */
  async processTrails(): Promise<TrailProcessingResult> {
    console.log('🛤️ LAYER 1: TRAILS - Building clean trail network...');
    
    const result: TrailProcessingResult = {
      trailsCopied: 0,
      trailsCleaned: 0,
      gapsFixed: 0,
      overlapsRemoved: 0
    };

    // Step 1: Copy trail data with bbox filter
    result.trailsCopied = await this.copyTrailData();
    
    // Step 2: Clean up trails (remove invalid geometries, short segments)
    result.trailsCleaned = await this.cleanupTrails();
    
    // Step 3: Fill gaps in trail network
    result.gapsFixed = await this.fillTrailGaps();
    
    // Step 4: Remove duplicates/overlaps while preserving all trails
    result.overlapsRemoved = await this.deduplicateTrails();
    
    console.log('✅ LAYER 1 COMPLETE: Clean trail network ready');
    console.log(`📊 Layer 1 Results: ${result.trailsCopied} trails copied, ${result.trailsCleaned} cleaned, ${result.gapsFixed} gaps fixed, ${result.overlapsRemoved} overlaps removed`);
    
    return result;
  }

  /**
   * Copy trail data with bbox filter
   */
  private async copyTrailData(): Promise<number> {
    console.log('📊 Copying trail data...');
    
    let bboxParams: any[] = [];
    let bboxFilter = '';
    let bboxFilterWithAlias = '';
    
    if (this.config.bbox && this.config.bbox.length === 4) {
      const [minLng, minLat, maxLng, maxLat] = this.config.bbox;
      
      // Expand bbox by 0.01 degrees (~1km) to include connected trail segments
      const expansion = 0.01;
      const expandedMinLng = minLng - expansion;
      const expandedMaxLng = maxLng + expansion;
      const expandedMinLat = minLat - expansion;
      const expandedMaxLat = maxLat + expansion;
      
      bboxParams = [expandedMinLng, expandedMinLat, expandedMaxLng, expandedMaxLat];
      bboxFilter = `AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      bboxFilterWithAlias = `AND ST_Intersects(p.geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      
      console.log(`🗺️ Using expanded bbox filter: [${expandedMinLng}, ${expandedMinLat}, ${expandedMaxLng}, ${expandedMaxLat}] (original: [${minLng}, ${minLat}, ${maxLng}, ${maxLat}])`);
    } else {
      console.log('🗺️ Using region filter (no bbox specified)');
      bboxFilter = `AND region = $1`;
      bboxFilterWithAlias = `AND p.region = $1`;
      bboxParams = [this.config.region];
    }
    
    // Add source filter if specified
    let sourceFilter = '';
    let sourceParams: any[] = [];
    if (this.config.sourceFilter) {
      sourceFilter = `AND source = $${bboxParams.length + 1}`;
      sourceParams = [this.config.sourceFilter];
      console.log(`🔍 Using source filter: ${this.config.sourceFilter}`);
    }

    // First, check how many trails should be copied
    const expectedTrailsQuery = `
      SELECT COUNT(*) as count FROM public.trails 
      WHERE geometry IS NOT NULL ${bboxFilter} ${sourceFilter}
    `;
    const expectedTrailsResult = await this.pgClient.query(expectedTrailsQuery, [...bboxParams, ...sourceParams]);
    const expectedCount = parseInt(expectedTrailsResult.rows[0].count);
    console.log(`📊 Expected trails to copy: ${expectedCount}`);

    const insertQuery = `
      INSERT INTO ${this.stagingSchema}.trails (
        app_uuid, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss,
        max_elevation, min_elevation, avg_elevation, region,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      )
      SELECT
        app_uuid::text, name, trail_type, surface, difficulty,
        geometry, length_km, elevation_gain, elevation_loss,
        max_elevation, min_elevation, avg_elevation, region,
        bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat
      FROM public.trails
      WHERE geometry IS NOT NULL ${bboxFilter} ${sourceFilter}
    `;
    
    const insertResult = await this.pgClient.query(insertQuery, [...bboxParams, ...sourceParams]);
    console.log(`📊 Insert result: ${insertResult.rowCount} rows inserted`);
    
    return insertResult.rowCount;
  }

  /**
   * Clean up trails (remove invalid geometries, short segments)
   */
  private async cleanupTrails(): Promise<number> {
    console.log('🧹 Cleaning up trails...');
    
    // Remove invalid geometries
    const invalidResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE geometry IS NULL OR NOT ST_IsValid(geometry)
    `);
    console.log(`   Removed ${invalidResult.rowCount} invalid geometries`);

    // Remove very short segments (less than 1 meter)
    const shortResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_Length(geometry::geography) < 1.0
    `);
    console.log(`   Removed ${shortResult.rowCount} short segments (< 1m)`);

    // Remove trails with too few points
    const fewPointsResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE ST_NumPoints(geometry) < 2
    `);
    console.log(`   Removed ${fewPointsResult.rowCount} trails with < 2 points`);

    // Fix "not simple" geometries (loops)
    const notSimpleResult = await this.pgClient.query(`
      UPDATE ${this.stagingSchema}.trails 
      SET geometry = ST_MakeValid(geometry)
      WHERE NOT ST_IsSimple(geometry)
    `);
    console.log(`   Fixed ${notSimpleResult.rowCount} non-simple geometries`);

    // Get final count
    const finalCount = await this.pgClient.query(`SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails`);
    console.log(`   Final trail count: ${finalCount.rows[0].count}`);
    
    return invalidResult.rowCount + shortResult.rowCount + fewPointsResult.rowCount;
  }

  /**
   * Fill gaps in trail network
   */
  private async fillTrailGaps(): Promise<number> {
    console.log('🔍 Detecting and fixing gaps in trail network...');
    
    // Get gap detection tolerance from config (default 20 meters)
    const gapToleranceMeters = 20; // TODO: Make this configurable from YAML
    
    const gapConfig = {
      toleranceMeters: gapToleranceMeters,
      maxBridgesToCreate: 100 // Limit to prevent too many connections
    };
    
    // Validate gap detection before running
    const validation = await validateGapDetection(this.pgClient, this.stagingSchema, gapConfig);
    console.log(`📊 Gap detection validation:`);
    console.log(`   Total vertices: ${validation.totalVertices}`);
    console.log(`   Degree-1 vertices: ${validation.degree1Vertices}`);
    console.log(`   Degree-2+ vertices: ${validation.degree2PlusVertices}`);
    console.log(`   Potential gaps: ${validation.potentialGaps}`);
    
    // Run gap detection and fixing
    const result = await detectAndFixGaps(this.pgClient, this.stagingSchema, gapConfig);
    
    console.log(`🔍 Gap detection results:`);
    console.log(`   Gaps found: ${result.gapsFound}`);
    console.log(`   Bridges created: ${result.bridgesCreated}`);
    
    if (result.details.length > 0) {
      console.log(`   Bridge details:`);
      result.details.forEach((detail, index) => {
        console.log(`     ${index + 1}. Vertex ${detail.node1_id} → Vertex ${detail.node2_id} (${detail.distance_meters.toFixed(2)}m)`);
      });
    }
    
    return result.bridgesCreated;
  }

  /**
   * Remove duplicates/overlaps while preserving all trails
   */
  private async deduplicateTrails(): Promise<number> {
    console.log('🔄 Removing duplicate trails...');
    
    // Find and remove exact duplicates (same geometry)
    const exactDuplicatesResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE id IN (
        SELECT t1.id
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_Equals(t1.geometry, t2.geometry)
      )
    `);
    console.log(`   Removed ${exactDuplicatesResult.rowCount} exact duplicates`);

    // Find and remove very similar trails (within 1 meter tolerance)
    const similarDuplicatesResult = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails 
      WHERE id IN (
        SELECT t1.id
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON t1.id < t2.id
        WHERE ST_DWithin(t1.geometry, t2.geometry, 1.0)
          AND ST_Length(t1.geometry::geography) <= ST_Length(t2.geometry::geography)
      )
    `);
    console.log(`   Removed ${similarDuplicatesResult.rowCount} similar duplicates`);

    return exactDuplicatesResult.rowCount + similarDuplicatesResult.rowCount;
  }
}
