#!/usr/bin/env ts-node
/**
 * CARTHORSE Region Readiness CLI
 *
 * Validates that a region's trail data is ready for export by checking:
 * - All trails have 3D geometry
 * - Elevation data is complete
 * - No invalid geometries
 * - No missing required fields
 */
export declare function runRegionReadiness(args?: string[]): Promise<void>;
//# sourceMappingURL=region-readiness.d.ts.map