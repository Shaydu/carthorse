import { GLOBAL_CONFIG, configHelpers } from '../../config/carthorse.global.config';

describe('Global Configuration', () => {
  describe('Elevation Precision', () => {
    it('should get elevation precision from environment variable', () => {
      // Test default precision
      const precision = configHelpers.getElevationPrecision();
      expect(precision).toBe(2); // Default value
    });

    it('should round elevation values to configured precision', () => {
      const testCases = [
        { input: 1928.5791, precision: 2, expected: 1928.58 },
        { input: 158.86658, precision: 2, expected: 158.87 },
        { input: 1928.5791, precision: 1, expected: 1928.6 },
        { input: 158.86658, precision: 1, expected: 158.9 },
        { input: 1928.5791, precision: 0, expected: 1929 },
        { input: 158.86658, precision: 0, expected: 159 },
      ];

      testCases.forEach(({ input, precision, expected }) => {
        // Temporarily set precision for this test
        const originalPrecision = GLOBAL_CONFIG.elevation.precision;
        (GLOBAL_CONFIG.elevation as any).precision = precision;
        
        const result = configHelpers.roundElevation(input);
        expect(result).toBe(expected);
        
        // Restore original precision
        (GLOBAL_CONFIG.elevation as any).precision = originalPrecision;
      });
    });

    it('should format elevation values with proper precision', () => {
      const testCases = [
        { input: 1928.5791, precision: 2, expected: '1928.58' },
        { input: 158.86658, precision: 2, expected: '158.87' },
        { input: 1928.5791, precision: 1, expected: '1928.6' },
        { input: 158.86658, precision: 1, expected: '158.9' },
        { input: 1928.5791, precision: 0, expected: '1929' },
        { input: 158.86658, precision: 0, expected: '159' },
      ];

      testCases.forEach(({ input, precision, expected }) => {
        // Temporarily set precision for this test
        const originalPrecision = GLOBAL_CONFIG.elevation.precision;
        (GLOBAL_CONFIG.elevation as any).precision = precision;
        
        const result = configHelpers.formatElevation(input);
        expect(result).toBe(expected);
        
        // Restore original precision
        (GLOBAL_CONFIG.elevation as any).precision = originalPrecision;
      });
    });

    it('should validate precision values within acceptable range', () => {
      // Test valid precision values
      expect(configHelpers.getElevationPrecision()).toBeGreaterThanOrEqual(0);
      expect(configHelpers.getElevationPrecision()).toBeLessThanOrEqual(6);
    });

    it('should handle edge cases for elevation rounding', () => {
      const edgeCases = [
        { input: 0, expected: 0 },
        { input: 1000.0, expected: 1000 },
        { input: 999.999, precision: 2, expected: 1000 },
        { input: 0.001, precision: 2, expected: 0 },
        { input: 0.005, precision: 2, expected: 0.01 },
      ];

      edgeCases.forEach(({ input, expected, precision = 2 }) => {
        // Temporarily set precision for this test
        const originalPrecision = GLOBAL_CONFIG.elevation.precision;
        (GLOBAL_CONFIG.elevation as any).precision = precision;
        
        const result = configHelpers.roundElevation(input);
        expect(result).toBe(expected);
        
        // Restore original precision
        (GLOBAL_CONFIG.elevation as any).precision = originalPrecision;
      });
    });
  });

  describe('Spatial Configuration', () => {
    it('should get spatial tolerances', () => {
      const intersectionTolerance = configHelpers.getSpatialTolerance('intersection');
      const edgeTolerance = configHelpers.getSpatialTolerance('edge');

      expect(intersectionTolerance).toBeGreaterThan(0);
      expect(edgeTolerance).toBeGreaterThan(0);
    });
  });

  describe('Processing Configuration', () => {
    it('should get processing settings', () => {
      const batchSize = configHelpers.getBatchSize();
      const timeout = configHelpers.getTimeoutMs();
      const verbose = configHelpers.isVerbose();

      expect(batchSize).toBeGreaterThan(0);
      expect(timeout).toBeGreaterThan(0);
      expect(typeof verbose).toBe('boolean');
    });
  });

  describe('Global Config Structure', () => {
    it('should have all required configuration sections', () => {
      expect(GLOBAL_CONFIG).toHaveProperty('elevation');
      expect(GLOBAL_CONFIG).toHaveProperty('spatial');
      expect(GLOBAL_CONFIG).toHaveProperty('database');
      expect(GLOBAL_CONFIG).toHaveProperty('processing');
      expect(GLOBAL_CONFIG).toHaveProperty('export');
      expect(GLOBAL_CONFIG).toHaveProperty('validation');
      expect(GLOBAL_CONFIG).toHaveProperty('cleanup');
    });

    it('should have proper elevation configuration', () => {
      expect(GLOBAL_CONFIG.elevation).toHaveProperty('precision');
      expect(GLOBAL_CONFIG.elevation).toHaveProperty('defaultPrecision');
      expect(GLOBAL_CONFIG.elevation).toHaveProperty('maxPrecision');
      expect(GLOBAL_CONFIG.elevation).toHaveProperty('minPrecision');
    });
  });
}); 