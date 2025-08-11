/**
 * Shared geometry parsing utilities
 * Used by elevation services to parse PostGIS geometry text
 */
/**
 * Parse PostGIS LINESTRING or LINESTRING Z format to coordinates
 * @param geometryText - PostGIS geometry text like "LINESTRING(lng1 lat1, lng2 lat2, ...)" or "LINESTRING Z(lng1 lat1 z1, lng2 lat2 z2, ...)"
 * @returns Array of [lng, lat] coordinates (Z coordinate ignored for elevation processing)
 */
export declare function parseGeometryText(geometryText: string): number[][];
//# sourceMappingURL=geometry-parser.d.ts.map