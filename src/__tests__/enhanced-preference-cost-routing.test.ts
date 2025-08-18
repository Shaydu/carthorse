import { Pool } from 'pg';
import { EnhancedPreferenceCostService } from '../utils/services/enhanced-preference-cost-service';
import { RouteDiscoveryConfigLoader } from '../config/route-discovery-config-loader';

// Mock the database connection
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

describe('Enhanced Preference-Based Cost Routing', () => {
  let mockPool: jest.Mocked<Pool>;
  let costService: EnhancedPreferenceCostService;
  let mockQuery: jest.Mock;

  beforeEach(() => {
    mockPool = new Pool() as jest.Mocked<Pool>;
    mockQuery = mockPool.query as jest.Mock;
    costService = new EnhancedPreferenceCostService(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Cost Calculation Logic', () => {
    describe('Elevation Gain Rate Cost', () => {
      it('should calculate low cost for perfect elevation gain rate match', () => {
        const actual = 100; // m/km
        const target = 100; // m/km
        const cost = (costService as any).calculateElevationGainRateCost(actual, target);
        
        // Should be very low cost for perfect match
        expect(cost).toBeLessThan(0.1);
      });

      it('should calculate higher cost for deviation from target elevation gain rate', () => {
        const actual = 150; // m/km
        const target = 100; // m/km
        const cost = (costService as any).calculateElevationGainRateCost(actual, target);
        
        // Should be higher cost for 50% deviation
        expect(cost).toBeGreaterThan(0.1);
      });

      it('should prefer moderate terrain (50-100 m/km) with lowest cost', () => {
        const moderateCost = (costService as any).getElevationGainRatePreferenceCost(75);
        const easyCost = (costService as any).getElevationGainRatePreferenceCost(25);
        const hardCost = (costService as any).getElevationGainRatePreferenceCost(125);
        
        expect(moderateCost).toBe(0.0); // Lowest cost
        expect(easyCost).toBe(0.2);     // Higher cost
        expect(hardCost).toBe(0.1);     // Low cost
      });

      it('should penalize extreme terrain (>200 m/km) with highest cost', () => {
        const extremeCost = (costService as any).getElevationGainRatePreferenceCost(250);
        expect(extremeCost).toBe(0.5); // Highest cost
      });
    });

    describe('Distance Cost', () => {
      it('should calculate low cost for perfect distance match', () => {
        const actual = 10; // km
        const target = 10; // km
        const cost = (costService as any).calculateDistanceCost(actual, target);
        
        // Should be very low cost for perfect match
        expect(cost).toBeLessThan(0.1);
      });

      it('should calculate higher cost for deviation from target distance', () => {
        const actual = 15; // km
        const target = 10; // km
        const cost = (costService as any).calculateDistanceCost(actual, target);
        
        // Should be higher cost for 50% deviation
        expect(cost).toBeGreaterThan(0.1);
      });

      it('should prefer medium routes (5-15 km) with lowest cost', () => {
        const mediumCost = (costService as any).getDistancePreferenceCost(10);
        const shortCost = (costService as any).getDistancePreferenceCost(3);
        const longCost = (costService as any).getDistancePreferenceCost(20);
        
        expect(mediumCost).toBe(0.0); // Lowest cost
        expect(shortCost).toBe(0.2);  // Higher cost
        expect(longCost).toBe(0.1);   // Low cost
      });

      it('should penalize very short routes (<2 km) with higher cost', () => {
        const veryShortCost = (costService as any).getDistancePreferenceCost(1);
        expect(veryShortCost).toBe(0.4); // Higher cost
      });
    });

    describe('Route Shape Cost', () => {
      it('should prefer loop routes with lowest cost', () => {
        const loopCost = (costService as any).getRouteShapePreferenceCost('loop');
        expect(loopCost).toBe(0.0); // Lowest cost
      });

      it('should prefer out-and-back routes with low cost', () => {
        const outAndBackCost = (costService as any).getRouteShapePreferenceCost('out-and-back');
        expect(outAndBackCost).toBe(0.1); // Low cost
      });

      it('should penalize point-to-point routes with higher cost', () => {
        const pointToPointCost = (costService as any).getRouteShapePreferenceCost('point-to-point');
        expect(pointToPointCost).toBe(0.3); // Higher cost
      });

      it('should handle unknown route shapes with highest cost', () => {
        const unknownCost = (costService as any).getRouteShapePreferenceCost('unknown');
        expect(unknownCost).toBe(0.5); // Highest cost
      });
    });
  });

  describe('Overall Cost Calculation', () => {
    it('should calculate weighted overall cost correctly', async () => {
      // Mock route data
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_distance_km: 10.0,
          total_elevation_gain: 500.0,
          route_shape: 'loop'
        }]
      });

      const costBreakdown = await costService.calculateRoutePreferenceCost(
        'staging_test',
        'test-route-id',
        10.0,  // target distance
        500.0  // target elevation
      );

      expect(costBreakdown.totalCost).toBeGreaterThanOrEqual(0);
      expect(costBreakdown.totalCost).toBeLessThanOrEqual(100);
      expect(costBreakdown.elevationCost).toBeGreaterThanOrEqual(0);
      expect(costBreakdown.distanceCost).toBeGreaterThanOrEqual(0);
      expect(costBreakdown.shapeCost).toBeGreaterThanOrEqual(0);
      expect(costBreakdown.elevationGainRate).toBe(50); // 500m / 10km
      expect(costBreakdown.targetElevationGainRate).toBe(50); // 500m / 10km
    });

    it('should prioritize elevation over distance and shape', async () => {
      // Mock route data with perfect elevation match but poor distance match
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_distance_km: 20.0,  // 100% deviation from target 10km
          total_elevation_gain: 500.0, // Perfect match for 50 m/km
          route_shape: 'point-to-point' // Higher shape cost
        }]
      });

      const costBreakdown = await costService.calculateRoutePreferenceCost(
        'staging_test',
        'test-route-id',
        10.0,  // target distance
        500.0  // target elevation
      );

      // Elevation cost should be very low (perfect match)
      expect(costBreakdown.elevationCost).toBeLessThan(10);
      // Distance cost should be significant (poor match)
      expect(costBreakdown.distanceCost).toBeGreaterThan(5);
      // Shape cost should be moderate (point-to-point)
      expect(costBreakdown.shapeCost).toBeGreaterThan(20);
    });
  });

  describe('Route Sorting', () => {
    it('should sort routes by cost in ascending order', async () => {
      // Mock multiple routes with different costs
      const mockRoutes = [
        { routeId: 'route-1', cost: 15.0 },
        { routeId: 'route-2', cost: 5.0 },
        { routeId: 'route-3', cost: 25.0 }
      ];

      // Mock the cost calculation for each route
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total_distance_km: 10.0, total_elevation_gain: 500.0, route_shape: 'loop' }] })
        .mockResolvedValueOnce({ rows: [{ total_distance_km: 10.0, total_elevation_gain: 500.0, route_shape: 'loop' }] })
        .mockResolvedValueOnce({ rows: [{ total_distance_km: 10.0, total_elevation_gain: 500.0, route_shape: 'loop' }] });

      const sortedRoutes = await costService.sortRoutesByPreferenceCost(
        'staging_test',
        ['route-1', 'route-2', 'route-3'],
        10.0,  // target distance
        500.0  // target elevation
      );

      // Should be sorted by cost (ascending)
      expect(sortedRoutes[0].routeId).toBe('route-2'); // Lowest cost
      expect(sortedRoutes[1].routeId).toBe('route-1'); // Medium cost
      expect(sortedRoutes[2].routeId).toBe('route-3'); // Highest cost
    });
  });

  describe('SQL Function Integration', () => {
    it('should call SQL function for finding routes with minimum cost', async () => {
      const mockRows = [
        {
          route_id: 'route-1',
          total_distance_km: 10.0,
          total_elevation_gain: 500.0,
          elevation_gain_rate_m_per_km: 50.0,
          route_shape: 'loop',
          preference_cost: 5.0,
          elevation_cost: 2.0,
          distance_cost: 2.0,
          shape_cost: 1.0
        }
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockRows });

      const routes = await costService.findRoutesWithMinimumPreferenceCost(
        'staging_test',
        10.0,  // target distance
        500.0, // target elevation
        20     // max routes
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('find_routes_with_minimum_preference_cost'),
        ['staging_test', 10.0, 500.0, 20]
      );
      expect(routes).toEqual(mockRows);
    });
  });

  describe('Configuration', () => {
    it('should return cost configuration with default values', () => {
      const config = costService.getCostConfiguration();
      
      expect(config.priorityWeights.elevation).toBe(0.35);
      expect(config.priorityWeights.distance).toBe(0.25);
      expect(config.priorityWeights.shape).toBe(0.4);
      expect(config.elevationCost.deviationWeight).toBe(3.0);
      expect(config.elevationCost.deviationExponent).toBe(1.5);
      expect(config.distanceCost.deviationWeight).toBe(2.0);
      expect(config.distanceCost.deviationExponent).toBe(1.2);
    });
  });

  describe('Error Handling', () => {
    it('should handle route not found error', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        costService.calculateRoutePreferenceCost(
          'staging_test',
          'non-existent-route',
          10.0,
          500.0
        )
      ).rejects.toThrow('Route not found: non-existent-route');
    });

    it('should handle database query errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(
        costService.calculateRoutePreferenceCost(
          'staging_test',
          'test-route',
          10.0,
          500.0
        )
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero target distance', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_distance_km: 5.0,
          total_elevation_gain: 100.0,
          route_shape: 'loop'
        }]
      });

      const costBreakdown = await costService.calculateRoutePreferenceCost(
        'staging_test',
        'test-route',
        0.0,   // zero target distance
        100.0  // target elevation
      );

      expect(costBreakdown.targetElevationGainRate).toBe(0);
      expect(costBreakdown.distanceDeviation).toBe(1); // 100% deviation when target is 0
    });

    it('should handle zero actual distance', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_distance_km: 0.0,
          total_elevation_gain: 100.0,
          route_shape: 'loop'
        }]
      });

      const costBreakdown = await costService.calculateRoutePreferenceCost(
        'staging_test',
        'test-route',
        10.0,  // target distance
        100.0  // target elevation
      );

      expect(costBreakdown.elevationGainRate).toBe(0);
    });

    it('should handle very large deviations', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_distance_km: 100.0,  // 10x target distance
          total_elevation_gain: 5000.0, // 10x target elevation
          route_shape: 'point-to-point'
        }]
      });

      const costBreakdown = await costService.calculateRoutePreferenceCost(
        'staging_test',
        'test-route',
        10.0,  // target distance
        500.0  // target elevation
      );

      // Should have high costs for large deviations
      expect(costBreakdown.totalCost).toBeGreaterThan(50);
      expect(costBreakdown.elevationCost).toBeGreaterThan(20);
      expect(costBreakdown.distanceCost).toBeGreaterThan(20);
    });
  });
});
