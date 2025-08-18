#!/usr/bin/env node

/**
 * Integration Test for Enhanced Preference-Based Cost Routing
 * This script tests the complete system including SQL functions and TypeScript service
 */

const { Pool } = require('pg');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

class EnhancedCostIntegrationTest {
  constructor() {
    this.pgClient = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      user: process.env.PGUSER || 'carthorse',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'trail_master_db'
    });
    
    this.testResults = [];
  }

  async runTests() {
    console.log('🧪 Starting Enhanced Preference-Based Cost Routing Integration Tests\n');
    
    try {
      await this.testDatabaseConnection();
      await this.testConfigurationLoading();
      await this.testCostCalculationFunctions();
      await this.testPreferenceWeights();
      await this.testEdgeCases();
      await this.testRouteSorting();
      
      this.printTestSummary();
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    } finally {
      await this.pgClient.end();
    }
  }

  async testDatabaseConnection() {
    console.log('📡 Testing database connection...');
    
    try {
      const result = await this.pgClient.query('SELECT 1 as test');
      this.recordTest('Database Connection', result.rows[0].test === 1);
      console.log('✅ Database connection successful');
    } catch (error) {
      this.recordTest('Database Connection', false, error.message);
      console.log('❌ Database connection failed:', error.message);
    }
  }

  async testConfigurationLoading() {
    console.log('\n⚙️ Testing configuration loading...');
    
    try {
      const result = await this.pgClient.query('SELECT get_enhanced_preference_cost_config() as config');
      const config = result.rows[0].config;
      
      const hasPriorityWeights = config.priorityWeights && 
        config.priorityWeights.elevation && 
        config.priorityWeights.distance && 
        config.priorityWeights.shape;
      
      const hasElevationCost = config.elevationCost && 
        config.elevationCost.deviationWeight && 
        config.elevationCost.deviationExponent;
      
      const hasDistanceCost = config.distanceCost && 
        config.distanceCost.deviationWeight && 
        config.distanceCost.deviationExponent;
      
      this.recordTest('Configuration Loading', hasPriorityWeights && hasElevationCost && hasDistanceCost);
      console.log('✅ Configuration loaded successfully');
      console.log(`   - Priority weights: ${JSON.stringify(config.priorityWeights)}`);
    } catch (error) {
      this.recordTest('Configuration Loading', false, error.message);
      console.log('❌ Configuration loading failed:', error.message);
    }
  }

  async testCostCalculationFunctions() {
    console.log('\n🧮 Testing cost calculation functions...');
    
    const testCases = [
      {
        name: 'Perfect Elevation Match',
        actual: 50.0,
        target: 50.0,
        expectedLow: true
      },
      {
        name: 'Elevation Deviation',
        actual: 75.0,
        target: 50.0,
        expectedLow: false
      },
      {
        name: 'Perfect Distance Match',
        actual: 10.0,
        target: 10.0,
        expectedLow: true
      },
      {
        name: 'Distance Deviation',
        actual: 15.0,
        target: 10.0,
        expectedLow: false
      }
    ];

    for (const testCase of testCases) {
      try {
        if (testCase.name.includes('Elevation')) {
          const result = await this.pgClient.query(
            'SELECT calculate_elevation_gain_rate_cost($1, $2) as cost',
            [testCase.actual, testCase.target]
          );
          const cost = result.rows[0].cost;
          const passed = testCase.expectedLow ? cost < 0.1 : cost > 0.1;
          this.recordTest(testCase.name, passed, `Cost: ${cost.toFixed(3)}`);
        } else {
          const result = await this.pgClient.query(
            'SELECT calculate_distance_cost($1, $2) as cost',
            [testCase.actual, testCase.target]
          );
          const cost = result.rows[0].cost;
          const passed = testCase.expectedLow ? cost < 0.1 : cost > 0.1;
          this.recordTest(testCase.name, passed, `Cost: ${cost.toFixed(3)}`);
        }
      } catch (error) {
        this.recordTest(testCase.name, false, error.message);
      }
    }
  }

  async testPreferenceWeights() {
    console.log('\n⚖️ Testing preference weights...');
    
    try {
      // Test that elevation has higher weight than distance
      const elevationMismatch = await this.pgClient.query(
        'SELECT calculate_overall_preference_cost($1, $2, $3, $4, $5) as cost',
        [100.0, 50.0, 10.0, 10.0, 'loop'] // Poor elevation match, good distance match
      );
      
      const distanceMismatch = await this.pgClient.query(
        'SELECT calculate_overall_preference_cost($1, $2, $3, $4, $5) as cost',
        [50.0, 50.0, 20.0, 10.0, 'loop'] // Good elevation match, poor distance match
      );
      
      const elevationCost = elevationMismatch.rows[0].cost;
      const distanceCost = distanceMismatch.rows[0].cost;
      
      // Elevation should have higher weight, so elevation mismatch should cost more
      const passed = elevationCost > distanceCost;
      this.recordTest('Elevation Weight > Distance Weight', passed, 
        `Elevation mismatch cost: ${elevationCost.toFixed(2)}, Distance mismatch cost: ${distanceCost.toFixed(2)}`);
      
      console.log(`   - Elevation mismatch cost: ${elevationCost.toFixed(2)}`);
      console.log(`   - Distance mismatch cost: ${distanceCost.toFixed(2)}`);
    } catch (error) {
      this.recordTest('Preference Weights', false, error.message);
    }
  }

  async testEdgeCases() {
    console.log('\n🔍 Testing edge cases...');
    
    const edgeCases = [
      {
        name: 'Zero Target Distance',
        query: 'SELECT calculate_distance_cost(10.0, 0.0) as cost',
        expectedValid: true
      },
      {
        name: 'Zero Target Elevation',
        query: 'SELECT calculate_elevation_gain_rate_cost(50.0, 0.0) as cost',
        expectedValid: true
      },
      {
        name: 'Very Large Deviation',
        query: 'SELECT calculate_overall_preference_cost(1000.0, 50.0, 100.0, 10.0, \'point-to-point\') as cost',
        expectedValid: true
      }
    ];

    for (const edgeCase of edgeCases) {
      try {
        const result = await this.pgClient.query(edgeCase.query);
        const cost = result.rows[0].cost;
        const passed = edgeCase.expectedValid ? cost >= 0 : false;
        this.recordTest(edgeCase.name, passed, `Cost: ${cost.toFixed(3)}`);
      } catch (error) {
        this.recordTest(edgeCase.name, false, error.message);
      }
    }
  }

  async testRouteSorting() {
    console.log('\n📊 Testing route sorting...');
    
    try {
      // Test route shape preferences
      const loopCost = await this.pgClient.query(
        'SELECT calculate_route_shape_cost(\'loop\') as cost'
      );
      const outAndBackCost = await this.pgClient.query(
        'SELECT calculate_route_shape_cost(\'out-and-back\') as cost'
      );
      const pointToPointCost = await this.pgClient.query(
        'SELECT calculate_route_shape_cost(\'point-to-point\') as cost'
      );
      
      const loop = loopCost.rows[0].cost;
      const outAndBack = outAndBackCost.rows[0].cost;
      const pointToPoint = pointToPointCost.rows[0].cost;
      
      // Loop should have lowest cost, point-to-point should have highest
      const passed = loop < outAndBack && outAndBack < pointToPoint;
      this.recordTest('Route Shape Preferences', passed, 
        `Loop: ${loop}, Out-and-back: ${outAndBack}, Point-to-point: ${pointToPoint}`);
      
      console.log(`   - Loop cost: ${loop}`);
      console.log(`   - Out-and-back cost: ${outAndBack}`);
      console.log(`   - Point-to-point cost: ${pointToPoint}`);
    } catch (error) {
      this.recordTest('Route Sorting', false, error.message);
    }
  }

  recordTest(testName, passed, details = '') {
    this.testResults.push({
      name: testName,
      passed,
      details
    });
    
    const status = passed ? '✅' : '❌';
    console.log(`   ${status} ${testName}${details ? ` - ${details}` : ''}`);
  }

  printTestSummary() {
    console.log('\n📋 Test Summary');
    console.log('='.repeat(50));
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    if (failedTests > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(r => console.log(`   - ${r.name}: ${r.details}`));
    }
    
    console.log('\n' + '='.repeat(50));
    
    if (failedTests === 0) {
      console.log('🎉 All tests passed! Enhanced preference-based cost routing is working correctly.');
    } else {
      console.log('⚠️ Some tests failed. Please review the failed tests above.');
      process.exit(1);
    }
  }
}

// Run the tests if this script is executed directly
if (require.main === module) {
  const testRunner = new EnhancedCostIntegrationTest();
  testRunner.runTests().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = EnhancedCostIntegrationTest;
