import { Pool, PoolClient } from 'pg';

export interface TrailStatsOptions {
  schema: string;
  region?: string;
  sourceFilter?: string; // e.g., 'cotrex'
}

export interface TrailStatsResult {
  totalTrails: number;
  veryShortCount: number;
  shortCount: number;
  normalCount: number;
  veryShortPct: number;
  shortPct: number;
  normalPct: number;
  minLengthKm: number | null;
  maxLengthKm: number | null;
  avgLengthKm: number | null;
}

export class TrailStatsService {
  private pg: Pool | PoolClient;

  constructor(pgClient: Pool | PoolClient) {
    this.pg = pgClient;
  }

  async getTrailStats(options: TrailStatsOptions): Promise<TrailStatsResult> {
    const { schema, region, sourceFilter } = options;

    const filters: string[] = ["geometry IS NOT NULL", "ST_IsValid(geometry)"];
    const params: any[] = [];

    if (region) {
      params.push(region);
      filters.push(`region = $${params.length}`);
    }

    if (sourceFilter) {
      params.push(sourceFilter);
      filters.push(`source = $${params.length}`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const sql = `
      WITH base AS (
        SELECT length_km
        FROM ${schema}.trails
        ${whereClause}
      ),
      counts AS (
        SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN length_km < 0.01 THEN 1 END) AS very_short,
          COUNT(CASE WHEN length_km < 0.1 THEN 1 END) AS short_total,
          COUNT(CASE WHEN length_km >= 0.1 THEN 1 END) AS normal
        FROM base
      ),
      stats AS (
        SELECT
          MIN(length_km) AS min_len,
          MAX(length_km) AS max_len,
          AVG(length_km) AS avg_len
        FROM base
      )
      SELECT
        counts.total,
        counts.very_short,
        -- short bucket excludes very short: short_total - very_short
        GREATEST(counts.short_total - counts.very_short, 0) AS short_only,
        counts.normal,
        stats.min_len,
        stats.max_len,
        stats.avg_len
      FROM counts, stats
    `;

    const res = await this.pg.query(sql, params);
    const row = res.rows[0] || {};

    const total: number = Number(row.total || 0);
    const veryShort: number = Number(row.very_short || 0);
    const shortOnly: number = Number(row.short_only || 0);
    const normal: number = Number(row.normal || 0);

    return {
      totalTrails: total,
      veryShortCount: veryShort,
      shortCount: shortOnly,
      normalCount: normal,
      veryShortPct: total ? (veryShort / total) * 100 : 0,
      shortPct: total ? (shortOnly / total) * 100 : 0,
      normalPct: total ? (normal / total) * 100 : 0,
      minLengthKm: row.min_len !== null ? Number(row.min_len) : null,
      maxLengthKm: row.max_len !== null ? Number(row.max_len) : null,
      avgLengthKm: row.avg_len !== null ? Number(row.avg_len) : null,
    };
  }

  static formatStats(stats: TrailStatsResult): string[] {
    const lines: string[] = [];
    lines.push('Trail Database Statistics');
    lines.push(`Total trails in database: ${stats.totalTrails.toLocaleString()}`);
    lines.push('Trail Length Distribution:');
    lines.push(
      `Very short trails (< 0.01 km / 10 meters): ${stats.veryShortCount.toLocaleString()} trails (${stats.veryShortPct.toFixed(1)}%)`
    );
    lines.push(
      `Short trails (< 0.1 km / 100 meters): ${stats.shortCount.toLocaleString()} trails (${stats.shortPct.toFixed(1)}%)`
    );
    lines.push(
      `Normal trails (≥ 0.1 km / 100 meters): ${stats.normalCount.toLocaleString()} trails (${stats.normalPct.toFixed(1)}%)`
    );
    lines.push('Length Statistics:');
    const min = stats.minLengthKm ?? 0;
    const max = stats.maxLengthKm ?? 0;
    const avg = stats.avgLengthKm ?? 0;
    lines.push(
      `Shortest trail: ${min.toFixed(6)} km (${(min * 1000).toFixed(4)} meters)`
    );
    lines.push(`Longest trail: ${max.toFixed(2)} km`);
    lines.push(`Average length: ${avg.toFixed(2)} km`);
    return lines;
  }
}


