import { calculateInitialViewBbox, getValidInitialViewBbox } from '../utils/bbox';

describe('initial_view_bbox logic', () => {
  const mainBbox = { minLng: 0, maxLng: 8, minLat: 0, maxLat: 4 };
  const expectedFallback = { minLng: 3, maxLng: 5, minLat: 1.5, maxLat: 2.5 };

  it('uses a valid object from DB as-is', () => {
    const dbValue = { minLng: 1, maxLng: 2, minLat: 3, maxLat: 4 };
    expect(getValidInitialViewBbox(dbValue, mainBbox)).toEqual(dbValue);
  });

  it('parses a valid stringified bbox from DB', () => {
    const dbValue = JSON.stringify({ minLng: 1, maxLng: 2, minLat: 3, maxLat: 4 });
    expect(getValidInitialViewBbox(dbValue, mainBbox)).toEqual({ minLng: 1, maxLng: 2, minLat: 3, maxLat: 4 });
  });

  it('falls back to calculated bbox for null', () => {
    expect(getValidInitialViewBbox(null, mainBbox)).toEqual(expectedFallback);
  });

  it('falls back to calculated bbox for string "null"', () => {
    expect(getValidInitialViewBbox('null', mainBbox)).toEqual(expectedFallback);
  });

  it('falls back to calculated bbox for empty string', () => {
    expect(getValidInitialViewBbox('', mainBbox)).toEqual(expectedFallback);
  });

  it('falls back to calculated bbox for invalid object', () => {
    expect(getValidInitialViewBbox({}, mainBbox)).toEqual(expectedFallback);
    expect(getValidInitialViewBbox({ minLng: null, maxLng: null, minLat: null, maxLat: null }, mainBbox)).toEqual(expectedFallback);
  });

  it('calculates the fallback bbox accurately', () => {
    expect(calculateInitialViewBbox(mainBbox)).toEqual(expectedFallback);
  });
}); 