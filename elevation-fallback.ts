import fetch from 'node-fetch';

// Types for elevation API responses
interface OpenTopoDataResponse {
  results: Array<{ elevation: number }>
}

interface USGS3DEPResponse {
  values: Array<{ value: number }>
}

export interface ElevationFallbackConfig {
  enabled: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  cacheResults?: boolean;
}

export class ElevationFallbackService {
  private elevationCache = new Map<string, number>();
  private config: ElevationFallbackConfig;

  constructor(config: ElevationFallbackConfig) {
    this.config = {
      enabled: false,
      maxRetries: 2,
      timeoutMs: 5000,
      cacheResults: true,
      ...config
    };
  }

  /**
   * Get elevation from USGS 3DEP REST API (free, no rate limits)
   */
  private async getElevationFromUSGS3DEP(lng: number, lat: number): Promise<number | null> {
    if (!this.config.enabled) return null;
    
    const cacheKey = `usgs3dep:${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (this.config.cacheResults && this.elevationCache.has(cacheKey)) {
      return this.elevationCache.get(cacheKey)!;
    }

    try {
      const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSample?geometry={"x":${lng},"y":${lat},"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPoint&returnGeometry=false&f=json`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
      
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!resp.ok) return null;
      
      const data = await resp.json() as USGS3DEPResponse;
      if (data && Array.isArray(data.values) && data.values.length > 0) {
        const elevation = data.values[0].value;
        if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
          if (this.config.cacheResults) {
            this.elevationCache.set(cacheKey, elevation);
          }
          return elevation;
        }
      }
    } catch (err) {
      console.error(`[USGS3DEP] Error fetching elevation for [${lng}, ${lat}]:`, err);
    }
    return null;
  }

  /**
   * Get elevation from SRTM30m via OpenTopoData (free, global coverage)
   */
  private async getElevationFromSRTM30m(lng: number, lat: number): Promise<number | null> {
    if (!this.config.enabled) return null;
    
    const cacheKey = `srtm30m:${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (this.config.cacheResults && this.elevationCache.has(cacheKey)) {
      return this.elevationCache.get(cacheKey)!;
    }

    try {
      const url = `https://api.opentopodata.org/v1/srtm30m?locations=${lat},${lng}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
      
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!resp.ok) return null;
      
      const data = await resp.json() as OpenTopoDataResponse;
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        const elevation = data.results[0].elevation;
        if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
          if (this.config.cacheResults) {
            this.elevationCache.set(cacheKey, elevation);
          }
          return elevation;
        }
      }
    } catch (err) {
      console.error(`[SRTM30m] Error fetching elevation for [${lng}, ${lat}]:`, err);
    }
    return null;
  }

  /**
   * Get elevation from SRTM90m via OpenTopoData (free, global coverage)
   */
  private async getElevationFromSRTM90m(lng: number, lat: number): Promise<number | null> {
    if (!this.config.enabled) return null;
    
    const cacheKey = `srtm90m:${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (this.config.cacheResults && this.elevationCache.has(cacheKey)) {
      return this.elevationCache.get(cacheKey)!;
    }

    try {
      const url = `https://api.opentopodata.org/v1/srtm90m?locations=${lat},${lng}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
      
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!resp.ok) return null;
      
      const data = await resp.json() as OpenTopoDataResponse;
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        const elevation = data.results[0].elevation;
        if (typeof elevation === 'number' && elevation > -1000 && elevation < 10000) {
          if (this.config.cacheResults) {
            this.elevationCache.set(cacheKey, elevation);
          }
          return elevation;
        }
      }
    } catch (err) {
      console.error(`[SRTM90m] Error fetching elevation for [${lng}, ${lat}]:`, err);
    }
    return null;
  }

  /**
   * Get elevation using fallback chain: USGS 3DEP → SRTM30m → SRTM90m
   * Returns null if no elevation data is available from any source
   */
  async getElevationWithFallback(lng: number, lat: number, tiffElevation: number | null = null): Promise<{
    elevation: number | null;
    source: 'tiff' | 'usgs3dep' | 'srtm30m' | 'srtm90m' | 'none';
  }> {
    // If TIFF provided elevation, use it (highest priority)
    if (tiffElevation !== null && tiffElevation > 0) {
      return { elevation: tiffElevation, source: 'tiff' };
    }

    // Fallback chain: USGS 3DEP → SRTM30m → SRTM90m
    let elevation = await this.getElevationFromUSGS3DEP(lng, lat);
    if (elevation !== null) {
      console.log(`[DEBUG] Fallback 1: USGS 3DEP elevation used for [${lng}, ${lat}] = ${elevation}`);
      return { elevation, source: 'usgs3dep' };
    }

    elevation = await this.getElevationFromSRTM30m(lng, lat);
    if (elevation !== null) {
      console.log(`[DEBUG] Fallback 2: SRTM30m elevation used for [${lng}, ${lat}] = ${elevation}`);
      return { elevation, source: 'srtm30m' };
    }

    elevation = await this.getElevationFromSRTM90m(lng, lat);
    if (elevation !== null) {
      console.log(`[DEBUG] Fallback 3: SRTM90m elevation used for [${lng}, ${lat}] = ${elevation}`);
      return { elevation, source: 'srtm90m' };
    }

    console.log(`[DEBUG] Coordinate: [${lng}, ${lat}] -> No elevation data available from any source`);
    return { elevation: null, source: 'none' };
  }

  /**
   * Clear the elevation cache
   */
  clearCache(): void {
    this.elevationCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.elevationCache.size,
      keys: Array.from(this.elevationCache.keys())
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ElevationFallbackConfig>): void {
    this.config = { ...this.config, ...config };
  }
} 