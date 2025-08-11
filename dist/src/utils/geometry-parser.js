"use strict";
/**
 * Shared geometry parsing utilities
 * Used by elevation services to parse PostGIS geometry text
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGeometryText = parseGeometryText;
/**
 * Parse PostGIS LINESTRING or LINESTRING Z format to coordinates
 * @param geometryText - PostGIS geometry text like "LINESTRING(lng1 lat1, lng2 lat2, ...)" or "LINESTRING Z(lng1 lat1 z1, lng2 lat2 z2, ...)"
 * @returns Array of [lng, lat] coordinates (Z coordinate ignored for elevation processing)
 */
function parseGeometryText(geometryText) {
    // Parse PostGIS LINESTRING or LINESTRING Z format: "LINESTRING(lng1 lat1, lng2 lat2, ...)" or "LINESTRING Z(lng1 lat1 z1, lng2 lat2 z2, ...)"
    const match = geometryText.match(/LINESTRING Z?\(([^)]+)\)/);
    if (!match) {
        return [];
    }
    const coordPairs = match[1].split(',').map(pair => pair.trim());
    return coordPairs.map(pair => {
        const coords = pair.split(' ').map(Number);
        // Return [lng, lat] - ignore Z coordinate for elevation processing
        return [coords[0], coords[1]];
    });
}
//# sourceMappingURL=geometry-parser.js.map