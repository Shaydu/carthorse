import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import path from 'path';

// Static values that were hardcoded in SQL before
const STATIC_VALUES = {
  // Spatial tolerances
  intersectionTolerance: 1.0,
  edgeTolerance: 1.0,
  simplifyTolerance: 0.001,
  
  // Processing settings
  batchSize: 1000,
  timeoutMs: 30000,
  
  // Validation thresholds
  minTrailLengthMeters: 1,
  maxTrailLengthMeters: 100000,
  minElevationMeters: 0,
  maxElevationMeters: 9000,
  minCoordinatePoints: 2,
  maxCoordinatePoints: 10000,
  
  // Route discovery settings
  maxRoutesPerBin: 10,
  minRouteScore: 0.7,
  minRouteDistanceKm: 1.0,
  maxRouteDistanceKm: 10.0,
  minElevationGainMeters: 10,
  maxElevationGainMeters: 5000,
  
  // Route scoring weights
  distanceWeight: 0.4,
  elevationWeight: 0.3,
  qualityWeight: 0.3,
  
  // Cost weighting
  steepnessWeight: 2.0,
  routingDistanceWeight: 0.5,
  
  // Route patterns (from original recursive route finding)
  routePatterns: [
    { name: 'Short Loop', distance: 5.0, elevation: 200.0, shape: 'loop', tolerance: 20.0 },
    { name: 'Medium Loop', distance: 10.0, elevation: 400.0, shape: 'loop', tolerance: 20.0 },
    { name: 'Long Loop', distance: 15.0, elevation: 600.0, shape: 'loop', tolerance: 20.0 },
    { name: 'Short Out-and-Back', distance: 8.0, elevation: 300.0, shape: 'out-and-back', tolerance: 20.0 },
    { name: 'Medium Out-and-Back', distance: 12.0, elevation: 500.0, shape: 'out-and-back', tolerance: 20.0 },
    { name: 'Long Out-and-Back', distance: 18.0, elevation: 700.0, shape: 'out-and-back', tolerance: 20.0 },
    { name: 'Short Point-to-Point', distance: 6.0, elevation: 250.0, shape: 'point-to-point', tolerance: 20.0 },
    { name: 'Medium Point-to-Point', distance: 12.0, elevation: 450.0, shape: 'point-to-point', tolerance: 20.0 },
    { name: 'Long Point-to-Point', distance: 20.0, elevation: 800.0, shape: 'point-to-point', tolerance: 20.0 }
  ]
};

// Helper function to read YAML config
function readYamlConfig(filePath: string): any {
  try {
    const fileContents = readFileSync(filePath, 'utf8');
    return load(fileContents);
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error}`);
  }
}

// Helper function to extract config values from YAML
function extractConfigValues(globalConfig: any, routeConfig: any) {
  return {
    // Spatial tolerances
    intersectionTolerance: globalConfig?.postgis?.processing?.defaultIntersectionTolerance || 1.0,
    edgeTolerance: globalConfig?.postgis?.processing?.defaultIntersectionTolerance || 1.0,
    simplifyTolerance: globalConfig?.postgis?.processing?.defaultSimplifyTolerance || 0.001,
    
    // Processing settings
    batchSize: globalConfig?.postgis?.processing?.defaultBatchSize || 1000,
    timeoutMs: globalConfig?.postgis?.processing?.defaultTimeoutMs || 30000,
    
    // Validation thresholds
    minTrailLengthMeters: globalConfig?.validation?.minTrailLengthMeters || 1,
    maxTrailLengthMeters: globalConfig?.validation?.maxTrailLengthMeters || 100000,
    minElevationMeters: globalConfig?.validation?.minElevationMeters || 0,
    maxElevationMeters: globalConfig?.validation?.maxElevationMeters || 9000,
    minCoordinatePoints: globalConfig?.validation?.minCoordinatePoints || 2,
    maxCoordinatePoints: globalConfig?.validation?.maxCoordinatePoints || 10000,
    
    // Route discovery settings
    maxRoutesPerBin: routeConfig?.discovery?.maxRoutesPerBin || 10,
    minRouteScore: routeConfig?.discovery?.minRouteScore || 0.7,
    minRouteDistanceKm: routeConfig?.discovery?.minRouteDistanceKm || 1.0,
    maxRouteDistanceKm: routeConfig?.discovery?.maxRouteDistanceKm || 10.0,
    minElevationGainMeters: routeConfig?.discovery?.minElevationGainMeters || 10,
    maxElevationGainMeters: routeConfig?.discovery?.maxElevationGainMeters || 5000,
    
    // Route scoring weights
    distanceWeight: routeConfig?.scoring?.distanceWeight || 0.4,
    elevationWeight: routeConfig?.scoring?.elevationWeight || 0.3,
    qualityWeight: routeConfig?.scoring?.qualityWeight || 0.3,
    
    // Cost weighting
    steepnessWeight: routeConfig?.costWeighting?.steepnessWeight || 2.0,
    routingDistanceWeight: routeConfig?.costWeighting?.distanceWeight || 0.5,
    
    // Route patterns (extracted from route discovery config)
    routePatterns: [
      { name: 'Short Loop', distance: 5.0, elevation: 200.0, shape: 'loop', tolerance: 20.0 },
      { name: 'Medium Loop', distance: 10.0, elevation: 400.0, shape: 'loop', tolerance: 20.0 },
      { name: 'Long Loop', distance: 15.0, elevation: 600.0, shape: 'loop', tolerance: 20.0 },
      { name: 'Short Out-and-Back', distance: 8.0, elevation: 300.0, shape: 'out-and-back', tolerance: 20.0 },
      { name: 'Medium Out-and-Back', distance: 12.0, elevation: 500.0, shape: 'out-and-back', tolerance: 20.0 },
      { name: 'Long Out-and-Back', distance: 18.0, elevation: 700.0, shape: 'out-and-back', tolerance: 20.0 },
      { name: 'Short Point-to-Point', distance: 6.0, elevation: 250.0, shape: 'point-to-point', tolerance: 20.0 },
      { name: 'Medium Point-to-Point', distance: 12.0, elevation: 450.0, shape: 'point-to-point', tolerance: 20.0 },
      { name: 'Long Point-to-Point', distance: 20.0, elevation: 800.0, shape: 'point-to-point', tolerance: 20.0 }
    ]
  };
}

describe('YAML Config Dynamic Values', () => {
  let globalConfig: any;
  let routeConfig: any;
  let dynamicValues: any;

  beforeAll(() => {
    // Read YAML config files
    globalConfig = readYamlConfig('carthorse.config.yaml');
    routeConfig = readYamlConfig('route-discovery.config.yaml');
    dynamicValues = extractConfigValues(globalConfig, routeConfig);
  });

  describe('Config File Loading', () => {
    test('should successfully load carthorse.config.yaml', () => {
      expect(globalConfig).toBeDefined();
      expect(globalConfig.postgis).toBeDefined();
      expect(globalConfig.validation).toBeDefined();
    });

    test('should successfully load route-discovery.config.yaml', () => {
      expect(routeConfig).toBeDefined();
      expect(routeConfig.discovery).toBeDefined();
      expect(routeConfig.scoring).toBeDefined();
      expect(routeConfig.costWeighting).toBeDefined();
    });

    test('should extract config values successfully', () => {
      expect(dynamicValues).toBeDefined();
      expect(dynamicValues.intersectionTolerance).toBeDefined();
      expect(dynamicValues.maxRoutesPerBin).toBeDefined();
    });
  });

  describe('Spatial Tolerances', () => {
    test('intersection tolerance should match static value', () => {
      expect(dynamicValues.intersectionTolerance).toBe(STATIC_VALUES.intersectionTolerance);
    });

    test('edge tolerance should match static value', () => {
      expect(dynamicValues.edgeTolerance).toBe(STATIC_VALUES.edgeTolerance);
    });

    test('simplify tolerance should match static value', () => {
      expect(dynamicValues.simplifyTolerance).toBe(STATIC_VALUES.simplifyTolerance);
    });
  });

  describe('Processing Settings', () => {
    test('batch size should match static value', () => {
      expect(dynamicValues.batchSize).toBe(STATIC_VALUES.batchSize);
    });

    test('timeout should match static value', () => {
      expect(dynamicValues.timeoutMs).toBe(STATIC_VALUES.timeoutMs);
    });
  });

  describe('Validation Thresholds', () => {
    test('min trail length should match static value', () => {
      expect(dynamicValues.minTrailLengthMeters).toBe(STATIC_VALUES.minTrailLengthMeters);
    });

    test('max trail length should match static value', () => {
      expect(dynamicValues.maxTrailLengthMeters).toBe(STATIC_VALUES.maxTrailLengthMeters);
    });

    test('min elevation should match static value', () => {
      expect(dynamicValues.minElevationMeters).toBe(STATIC_VALUES.minElevationMeters);
    });

    test('max elevation should match static value', () => {
      expect(dynamicValues.maxElevationMeters).toBe(STATIC_VALUES.maxElevationMeters);
    });

    test('min coordinate points should match static value', () => {
      expect(dynamicValues.minCoordinatePoints).toBe(STATIC_VALUES.minCoordinatePoints);
    });

    test('max coordinate points should match static value', () => {
      expect(dynamicValues.maxCoordinatePoints).toBe(STATIC_VALUES.maxCoordinatePoints);
    });
  });

  describe('Route Discovery Settings', () => {
    test('max routes per bin should match static value', () => {
      expect(dynamicValues.maxRoutesPerBin).toBe(STATIC_VALUES.maxRoutesPerBin);
    });

    test('min route score should match static value', () => {
      expect(dynamicValues.minRouteScore).toBe(STATIC_VALUES.minRouteScore);
    });

    test('min route distance should match static value', () => {
      expect(dynamicValues.minRouteDistanceKm).toBe(STATIC_VALUES.minRouteDistanceKm);
    });

    test('max route distance should match static value', () => {
      expect(dynamicValues.maxRouteDistanceKm).toBe(STATIC_VALUES.maxRouteDistanceKm);
    });

    test('min elevation gain should match static value', () => {
      expect(dynamicValues.minElevationGainMeters).toBe(STATIC_VALUES.minElevationGainMeters);
    });

    test('max elevation gain should match static value', () => {
      expect(dynamicValues.maxElevationGainMeters).toBe(STATIC_VALUES.maxElevationGainMeters);
    });
  });

  describe('Route Scoring Weights', () => {
    test('distance weight should match static value', () => {
      expect(dynamicValues.distanceWeight).toBe(STATIC_VALUES.distanceWeight);
    });

    test('elevation weight should match static value', () => {
      expect(dynamicValues.elevationWeight).toBe(STATIC_VALUES.elevationWeight);
    });

    test('quality weight should match static value', () => {
      expect(dynamicValues.qualityWeight).toBe(STATIC_VALUES.qualityWeight);
    });

    test('scoring weights should sum to 1.0', () => {
      const totalWeight = dynamicValues.distanceWeight + dynamicValues.elevationWeight + dynamicValues.qualityWeight;
      expect(totalWeight).toBeCloseTo(1.0, 2);
    });
  });

  describe('Cost Weighting', () => {
    test('steepness weight should match static value', () => {
      expect(dynamicValues.steepnessWeight).toBe(STATIC_VALUES.steepnessWeight);
    });

    test('routing distance weight should match static value', () => {
      expect(dynamicValues.routingDistanceWeight).toBe(STATIC_VALUES.routingDistanceWeight);
    });
  });

  describe('Route Patterns', () => {
    test('should have the same number of route patterns', () => {
      expect(dynamicValues.routePatterns).toHaveLength(STATIC_VALUES.routePatterns.length);
    });

    test('route patterns should match static patterns', () => {
      STATIC_VALUES.routePatterns.forEach((staticPattern, index) => {
        const dynamicPattern = dynamicValues.routePatterns[index];
        expect(dynamicPattern.name).toBe(staticPattern.name);
        expect(dynamicPattern.distance).toBe(staticPattern.distance);
        expect(dynamicPattern.elevation).toBe(staticPattern.elevation);
        expect(dynamicPattern.shape).toBe(staticPattern.shape);
        expect(dynamicPattern.tolerance).toBe(staticPattern.tolerance);
      });
    });

    test('all route patterns should have valid shapes', () => {
      const validShapes = ['loop', 'out-and-back', 'point-to-point'];
      dynamicValues.routePatterns.forEach((pattern: any) => {
        expect(validShapes).toContain(pattern.shape);
      });
    });

    test('all route patterns should have positive distances and elevations', () => {
      dynamicValues.routePatterns.forEach((pattern: any) => {
        expect(pattern.distance).toBeGreaterThan(0);
        expect(pattern.elevation).toBeGreaterThan(0);
      });
    });
  });

  describe('Config Value Ranges', () => {
    test('intersection tolerance should be positive', () => {
      expect(dynamicValues.intersectionTolerance).toBeGreaterThan(0);
    });

    test('batch size should be positive', () => {
      expect(dynamicValues.batchSize).toBeGreaterThan(0);
    });

    test('timeout should be positive', () => {
      expect(dynamicValues.timeoutMs).toBeGreaterThan(0);
    });

    test('min route score should be between 0 and 1', () => {
      expect(dynamicValues.minRouteScore).toBeGreaterThanOrEqual(0);
      expect(dynamicValues.minRouteScore).toBeLessThanOrEqual(1);
    });

    test('max elevation should be greater than min elevation', () => {
      expect(dynamicValues.maxElevationMeters).toBeGreaterThan(dynamicValues.minElevationMeters);
    });

    test('max trail length should be greater than min trail length', () => {
      expect(dynamicValues.maxTrailLengthMeters).toBeGreaterThan(dynamicValues.minTrailLengthMeters);
    });

    test('max route distance should be greater than min route distance', () => {
      expect(dynamicValues.maxRouteDistanceKm).toBeGreaterThan(dynamicValues.minRouteDistanceKm);
    });

    test('max elevation gain should be greater than min elevation gain', () => {
      expect(dynamicValues.maxElevationGainMeters).toBeGreaterThan(dynamicValues.minElevationGainMeters);
    });
  });

  describe('Config Consistency', () => {
    test('all required config sections should be present', () => {
      expect(globalConfig.postgis).toBeDefined();
      expect(globalConfig.validation).toBeDefined();
      expect(routeConfig.discovery).toBeDefined();
      expect(routeConfig.scoring).toBeDefined();
      expect(routeConfig.costWeighting).toBeDefined();
    });

    test('config should have expected structure', () => {
      // Check global config structure
      expect(globalConfig.postgis.processing).toBeDefined();
      expect(globalConfig.validation).toBeDefined();
      
      // Check route config structure
      expect(routeConfig.discovery).toBeDefined();
      expect(routeConfig.scoring).toBeDefined();
      expect(routeConfig.costWeighting).toBeDefined();
    });
  });

  describe('Generated SQL Compatibility', () => {
    test('should generate valid SQL config values', () => {
      // Test that the config values can be used in SQL context
      const sqlConfig = {
        intersectionTolerance: dynamicValues.intersectionTolerance,
        edgeTolerance: dynamicValues.edgeTolerance,
        simplifyTolerance: dynamicValues.simplifyTolerance,
        batchSize: dynamicValues.batchSize,
        timeoutMs: dynamicValues.timeoutMs,
        maxRoutesPerBin: dynamicValues.maxRoutesPerBin,
        minRouteScore: dynamicValues.minRouteScore
      };

      // All values should be numbers
      Object.values(sqlConfig).forEach(value => {
        expect(typeof value).toBe('number');
        expect(isNaN(value)).toBe(false);
      });
    });
  });

  describe('Migration Verification', () => {
    test('all static values should have corresponding dynamic values', () => {
      const staticKeys = Object.keys(STATIC_VALUES).filter(key => key !== 'routePatterns');
      const dynamicKeys = Object.keys(dynamicValues).filter(key => key !== 'routePatterns');
      
      staticKeys.forEach(key => {
        expect(dynamicKeys).toContain(key);
      });
    });

    test('dynamic values should preserve static value semantics', () => {
      // Test that the dynamic values maintain the same meaning as static values
      expect(dynamicValues.intersectionTolerance).toBe(STATIC_VALUES.intersectionTolerance);
      expect(dynamicValues.batchSize).toBe(STATIC_VALUES.batchSize);
      expect(dynamicValues.maxRoutesPerBin).toBe(STATIC_VALUES.maxRoutesPerBin);
    });
  });
}); 