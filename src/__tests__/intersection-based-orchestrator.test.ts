/**
 * Tests for Intersection-Based Orchestrator
 * 
 * These tests validate the intersection-based routing strategy implementation.
 */

import { IntersectionBasedOrchestrator, IntersectionBasedOrchestratorConfig } from '../orchestrator/IntersectionBasedOrchestrator';
import { getTestDbConfig } from '../database/connection';

describe('IntersectionBasedOrchestrator', () => {
  let orchestrator: IntersectionBasedOrchestrator;
  let testConfig: IntersectionBasedOrchestratorConfig;

  beforeAll(async () => {
    // Use test configuration
    const dbConfig = getTestDbConfig();
    testConfig = {
      densifyDistance: 5,
      snapTolerance: 0.00001,
      segmentizeDistance: 5
    };
  });

  beforeEach(() => {
    orchestrator = new IntersectionBasedOrchestrator(testConfig);
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await orchestrator.cleanup();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('Configuration', () => {
    it('should initialize with default configuration', () => {
      const defaultOrchestrator = new IntersectionBasedOrchestrator();
      
      expect(defaultOrchestrator.stagingSchema).toMatch(/^staging_intersection_/);
      expect(defaultOrchestrator).toBeInstanceOf(IntersectionBasedOrchestrator);
    });

    it('should initialize with custom configuration', () => {
      const customConfig: IntersectionBasedOrchestratorConfig = {
        densifyDistance: 10,
        snapTolerance: 0.0001,
        segmentizeDistance: 10
      };
      
      const customOrchestrator = new IntersectionBasedOrchestrator(customConfig);
      expect(customOrchestrator).toBeInstanceOf(IntersectionBasedOrchestrator);
    });
  });

  describe('Static Methods', () => {
    it('should have install method', () => {
      expect(typeof IntersectionBasedOrchestrator.install).toBe('function');
    });

    it('should have installTestDatabase method', () => {
      expect(typeof IntersectionBasedOrchestrator.installTestDatabase).toBe('function');
    });
  });

  describe('Instance Methods', () => {
    it('should have processTrails method', () => {
      expect(typeof orchestrator.processTrails).toBe('function');
    });

    it('should have getNetworkStats method', () => {
      expect(typeof orchestrator.getNetworkStats).toBe('function');
    });

    it('should have cleanup method', () => {
      expect(typeof orchestrator.cleanup).toBe('function');
    });

    it('should have exportToSqlite method', () => {
      expect(typeof orchestrator.exportToSqlite).toBe('function');
    });
  });

  describe('Schema Generation', () => {
    it('should generate unique staging schema names', () => {
      const orchestrator1 = new IntersectionBasedOrchestrator();
      const orchestrator2 = new IntersectionBasedOrchestrator();
      
      expect(orchestrator1.stagingSchema).not.toBe(orchestrator2.stagingSchema);
      expect(orchestrator1.stagingSchema).toMatch(/^staging_intersection_/);
      expect(orchestrator2.stagingSchema).toMatch(/^staging_intersection_/);
    });
  });

  describe('Integration Tests', () => {
    // These tests would require a test database setup
    // They are marked as skipped until we have proper test database setup
    
    it.skip('should install test database', async () => {
      await expect(IntersectionBasedOrchestrator.installTestDatabase('boulder', 100))
        .resolves.not.toThrow();
    });

    it.skip('should process trails and generate network stats', async () => {
      // This test would require a test database with trail data
      await orchestrator.processTrails();
      
      const stats = await orchestrator.getNetworkStats();
      
      expect(stats).toHaveProperty('trail_count');
      expect(stats).toHaveProperty('intersection_count');
      expect(stats).toHaveProperty('node_count');
      expect(stats).toHaveProperty('edge_count');
      
      expect(typeof stats.trail_count).toBe('number');
      expect(typeof stats.intersection_count).toBe('number');
      expect(typeof stats.node_count).toBe('number');
      expect(typeof stats.edge_count).toBe('number');
    });

    it.skip('should cleanup staging schema', async () => {
      await expect(orchestrator.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle export to SQLite not implemented', async () => {
      await expect(orchestrator.exportToSqlite('./test.db'))
        .rejects.toThrow('Export functionality not yet implemented');
    });
  });
}); 