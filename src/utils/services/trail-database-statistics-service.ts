import { Pool } from 'pg';

export interface TrailDatabaseStatistics {
  totalTrails: number;
  trailLengthDistribution: {
    veryShort: { count: number; percentage: number }; // < 0.01 km / 10 meters
    short: { count: number; percentage: number };     // < 0.1 km / 100 meters  
    normal: { count: number; percentage: number };    // ≥ 0.1 km / 100 meters
  };
  lengthStatistics: {
    shortestTrail: number; // in km
    longestTrail: number;  // in km
    averageLength: number; // in km
  };
}

export class TrailDatabaseStatisticsService {
  constructor(private pgClient: Pool, private schemaName: string = 'public') {}

  /**
   * Calculate comprehensive trail database statistics
   */
  async calculateTrailStatistics(): Promise<TrailDatabaseStatistics> {
    console.log(`📊 Calculating trail database statistics for schema '${this.schemaName}'...`);
    
    const result = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN length_km < 0.01 THEN 1 END) as very_short_count,
        COUNT(CASE WHEN length_km >= 0.01 AND length_km < 0.1 THEN 1 END) as short_count,
        COUNT(CASE WHEN length_km >= 0.1 THEN 1 END) as normal_count,
        MIN(length_km) as shortest_trail,
        MAX(length_km) as longest_trail,
        AVG(length_km) as average_length
      FROM ${this.schemaName}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry) AND length_km > 0
    `);

    const row = result.rows[0];
    const totalTrails = parseInt(row.total_trails) || 0;
    
    const veryShortCount = parseInt(row.very_short_count) || 0;
    const shortCount = parseInt(row.short_count) || 0;
    const normalCount = parseInt(row.normal_count) || 0;
    
    return {
      totalTrails,
      trailLengthDistribution: {
        veryShort: {
          count: veryShortCount,
          percentage: totalTrails > 0 ? (veryShortCount / totalTrails) * 100 : 0
        },
        short: {
          count: shortCount,
          percentage: totalTrails > 0 ? (shortCount / totalTrails) * 100 : 0
        },
        normal: {
          count: normalCount,
          percentage: totalTrails > 0 ? (normalCount / totalTrails) * 100 : 0
        }
      },
      lengthStatistics: {
        shortestTrail: parseFloat(row.shortest_trail) || 0,
        longestTrail: parseFloat(row.longest_trail) || 0,
        averageLength: parseFloat(row.average_length) || 0
      }
    };
  }

  /**
   * Format trail statistics for display in the export report
   */
  formatTrailStatistics(stats: TrailDatabaseStatistics): string {
    const { totalTrails, trailLengthDistribution, lengthStatistics } = stats;
    
    return `
📊 TRAIL DATABASE STATISTICS
============================
Total trails in database: ${totalTrails.toLocaleString()}

Trail Length Distribution:
Very short trails (< 0.01 km / 10 meters): ${trailLengthDistribution.veryShort.count.toLocaleString()} trails (${trailLengthDistribution.veryShort.percentage.toFixed(1)}%)
Short trails (< 0.1 km / 100 meters): ${trailLengthDistribution.short.count.toLocaleString()} trails (${trailLengthDistribution.short.percentage.toFixed(1)}%)
Normal trails (≥ 0.1 km / 100 meters): ${trailLengthDistribution.normal.count.toLocaleString()} trails (${trailLengthDistribution.normal.percentage.toFixed(1)}%)

Length Statistics:
Shortest trail: ${lengthStatistics.shortestTrail.toFixed(6)} km (${(lengthStatistics.shortestTrail * 1000).toFixed(1)} meters)
Longest trail: ${lengthStatistics.longestTrail.toFixed(2)} km
Average length: ${lengthStatistics.averageLength.toFixed(2)} km`;
  }

  /**
   * Display trail statistics to console
   */
  async displayTrailStatistics(): Promise<void> {
    try {
      const stats = await this.calculateTrailStatistics();
      console.log(this.formatTrailStatistics(stats));
    } catch (error) {
      console.error('❌ Failed to calculate trail database statistics:', error);
      throw error;
    }
  }
}
