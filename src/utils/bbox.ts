// Utility function for fallback bbox calculation
export function calculateInitialViewBbox(mainBbox: { minLng: number, maxLng: number, minLat: number, maxLat: number }) {
  const bboxWidth = mainBbox.maxLng - mainBbox.minLng;
  const bboxHeight = mainBbox.maxLat - mainBbox.minLat;
  const centerLng = mainBbox.minLng + bboxWidth / 2;
  const centerLat = mainBbox.minLat + bboxHeight / 2;
  const quarterWidth = bboxWidth * 0.25;
  const quarterHeight = bboxHeight * 0.25;
  return {
    minLng: centerLng - quarterWidth / 2,
    maxLng: centerLng + quarterWidth / 2,
    minLat: centerLat - quarterHeight / 2,
    maxLat: centerLat + quarterHeight / 2
  };
}

// Helper to validate and select initial_view_bbox
export function getValidInitialViewBbox(dbValue: any, mainBbox: { minLng: number, maxLng: number, minLat: number, maxLat: number }) {
  if (
    dbValue === null ||
    dbValue === undefined ||
    dbValue === '' ||
    dbValue === 'null' ||
    (typeof dbValue === 'object' && (
      dbValue.minLng == null || dbValue.maxLng == null || dbValue.minLat == null || dbValue.maxLat == null
    ))
  ) {
    return calculateInitialViewBbox(mainBbox);
  }
  if (typeof dbValue === 'string') {
    try {
      const parsed = JSON.parse(dbValue);
      if (
        parsed &&
        typeof parsed.minLng === 'number' && typeof parsed.maxLng === 'number' &&
        typeof parsed.minLat === 'number' && typeof parsed.maxLat === 'number'
      ) {
        return parsed;
      }
    } catch {}
    return calculateInitialViewBbox(mainBbox);
  }
  if (
    typeof dbValue === 'object' &&
    typeof dbValue.minLng === 'number' && typeof dbValue.maxLng === 'number' &&
    typeof dbValue.minLat === 'number' && typeof dbValue.maxLat === 'number'
  ) {
    return dbValue;
  }
  return calculateInitialViewBbox(mainBbox);
} 