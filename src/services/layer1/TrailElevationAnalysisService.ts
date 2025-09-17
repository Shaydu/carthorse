import { Pool } from 'pg';

export interface TrailElevationAnalysisConfig {
  stagingSchema: string;
  region: string;
  verbose?: boolean;
}

export interface ElevationAnalysisResult {
  trailsProcessed: number;
  trailsUpdated: number;
  errors: string[];
  success: boolean;
}

export class TrailElevationAnalysisService {
  private pgClient: Pool;
  private config: TrailElevationAnalysisConfig;

  constructor(pgClient: Pool, config: TrailElevationAnalysisConfig) {
    this.pgClient = pgClient;
    this.config = config;
  }

  /**
   * Analyze and update elevation statistics for all trails in staging schema
   */
  async analyzeElevationStatistics(): Promise<ElevationAnalysisResult> {
    console.log('📊 Analyzing elevation statistics for split trails...');
    
    const result: ElevationAnalysisResult = {
      trailsProcessed: 0,
      trailsUpdated: 0,
      errors: [],
      success: false
    };

    try {
      // Get all trails that need elevation analysis
      const trailsQuery = `
        SELECT 
          app_uuid,
          name,
          ST_AsText(geometry) as geometry_text,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation
        FROM ${this.config.stagingSchema}.trails
        WHERE geometry IS NOT NULL 
        AND ST_NDims(geometry) = 3
        AND ST_IsValid(geometry)
        AND (elevation_gain = 0 OR elevation_loss = 0 OR max_elevation = 0 OR min_elevation = 0 OR avg_elevation = 0)
        ORDER BY name
      `;

      const trails = await this.pgClient.query(trailsQuery);
      result.trailsProcessed = trails.rows.length;

      if (trails.rows.length === 0) {
        console.log('✅ No trails need elevation analysis');
        result.success = true;
        return result;
      }

      console.log(`🔍 Found ${trails.rows.length} trails needing elevation analysis`);

      // Process trails in batches to avoid memory issues
      const batchSize = 50;
      for (let i = 0; i < trails.rows.length; i += batchSize) {
        const batch = trails.rows.slice(i, i + batchSize);
        await this.processBatch(batch, result);
        
        if (this.config.verbose) {
          console.log(`⏳ Processed ${Math.min(i + batchSize, trails.rows.length)}/${trails.rows.length} trails`);
        }
      }

      result.success = result.errors.length === 0;
      console.log(`✅ Elevation analysis complete: ${result.trailsUpdated}/${result.trailsProcessed} trails updated`);

    } catch (error) {
      const errorMsg = `Elevation analysis failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Process a batch of trails
   */
  private async processBatch(trails: any[], result: ElevationAnalysisResult): Promise<void> {
    for (const trail of trails) {
      try {
        const elevationData = await this.calculateElevationFromGeometry(trail.geometry_text);
        
        if (elevationData) {
          await this.updateTrailElevation(trail.app_uuid, elevationData);
          result.trailsUpdated++;
        }
      } catch (error) {
        const errorMsg = `Failed to process trail ${trail.name}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`❌ ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }
  }

  /**
   * Calculate elevation statistics from geometry text
   */
  private async calculateElevationFromGeometry(geometryText: string): Promise<{
    elevation_gain: number;
    elevation_loss: number;
    max_elevation: number;
    min_elevation: number;
    avg_elevation: number;
  } | null> {
    try {
      // Use PostgreSQL to calculate elevation statistics from geometry
      const elevationQuery = `
        WITH geom AS (
          SELECT ST_GeomFromText($1, 4326) AS g
        )
        SELECT 
          COALESCE(r.elevation_gain, 0) as elevation_gain,
          COALESCE(r.elevation_loss, 0) as elevation_loss,
          COALESCE(ST_ZMax(geom.g), 0) as max_elevation,
          COALESCE(ST_ZMin(geom.g), 0) as min_elevation,
          COALESCE(ST_Z(ST_Centroid(geom.g)), 0) as avg_elevation
        FROM geom
        LEFT JOIN LATERAL recalculate_elevation_data(geom.g) r ON TRUE
      `;

      const elevationResult = await this.pgClient.query(elevationQuery, [geometryText]);
      const elevation = elevationResult.rows[0];

      return {
        elevation_gain: parseFloat(elevation.elevation_gain) || 0,
        elevation_loss: parseFloat(elevation.elevation_loss) || 0,
        max_elevation: parseFloat(elevation.max_elevation) || 0,
        min_elevation: parseFloat(elevation.min_elevation) || 0,
        avg_elevation: parseFloat(elevation.avg_elevation) || 0
      };
    } catch (error) {
      console.error(`❌ Error calculating elevation for geometry: ${error}`);
      return null;
    }
  }

  /**
   * Update trail with calculated elevation data
   */
  private async updateTrailElevation(
    appUuid: string, 
    elevationData: {
      elevation_gain: number;
      elevation_loss: number;
      max_elevation: number;
      min_elevation: number;
      avg_elevation: number;
    }
  ): Promise<void> {
    const updateQuery = `
      UPDATE ${this.config.stagingSchema}.trails 
      SET 
        elevation_gain = $1,
        elevation_loss = $2,
        max_elevation = $3,
        min_elevation = $4,
        avg_elevation = $5
      WHERE app_uuid = $6
    `;

    await this.pgClient.query(updateQuery, [
      elevationData.elevation_gain,
      elevationData.elevation_loss,
      elevationData.max_elevation,
      elevationData.min_elevation,
      elevationData.avg_elevation,
      appUuid
    ]);
  }

  /**
   * Get elevation statistics summary
   */
  async getElevationSummary(): Promise<{
    totalTrails: number;
    trailsWithElevation: number;
    trailsMissingElevation: number;
    avgElevationGain: number;
    avgElevationLoss: number;
  }> {
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN max_elevation > 0 AND min_elevation > 0 AND avg_elevation > 0 THEN 1 END) as trails_with_elevation,
        COUNT(CASE WHEN max_elevation = 0 OR min_elevation = 0 OR avg_elevation = 0 THEN 1 END) as trails_missing_elevation,
        AVG(elevation_gain) as avg_elevation_gain,
        AVG(elevation_loss) as avg_elevation_loss
      FROM ${this.config.stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_NDims(geometry) = 3
    `;

    const result = await this.pgClient.query(summaryQuery);
    const row = result.rows[0];

    return {
      totalTrails: parseInt(row.total_trails) || 0,
      trailsWithElevation: parseInt(row.trails_with_elevation) || 0,
      trailsMissingElevation: parseInt(row.trails_missing_elevation) || 0,
      avgElevationGain: parseFloat(row.avg_elevation_gain) || 0,
      avgElevationLoss: parseFloat(row.avg_elevation_loss) || 0
    };
  }
}

