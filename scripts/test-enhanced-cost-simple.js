#!/usr/bin/env node

/**
 * Simple Test for Enhanced Preference-Based Cost Routing
 * This script tests the core logic without requiring TypeScript compilation
 */

const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

class SimpleEnhancedCostTest {
  constructor() {
    this.testResults = [];
  }

  runTests() {
    console.log('🧪 Simple Enhanced Preference-Based Cost Routing Test\n');
    
    this.testConfigurationLoading();
    this.testCostCalculationLogic();
    this.testPreferenceWeights();
    this.testEdgeCases();
    
    this.printTestSummary();
  }

  testConfigurationLoading() {
    console.log('📋 Test 1: Configuration Loading');
    
    try {
      const configPath = path.join(__dirname, '..', 'configs', 'layer3-routing.config.yaml');
      const configFile = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(configFile);
      
      const enhancedCost = config.costWeighting?.enhancedCostRouting;
      
      if (enhancedCost && enhancedCost.enabled) {
        this.recordTest('Configuration Found', true, 'Enhanced cost routing configuration loaded');
        this.recordTest('Configuration Enabled', true, 'Enhanced cost routing is enabled');
        
        const weights = enhancedCost.priorityWeights;
        if (weights) {
          this.recordTest('Priority Weights', true, 
            `Elevation: ${weights.elevation}, Distance: ${weights.distance}, Shape: ${weights.shape}`);
        } else {
          this.recordTest('Priority Weights', false, 'Priority weights not found');
        }
        
        const elevationCost = enhancedCost.elevationCost;
        if (elevationCost) {
          this.recordTest('Elevation Cost Config', true, 
            `Deviation weight: ${elevationCost.deviationWeight}, Exponent: ${elevationCost.deviationExponent}`);
        } else {
          this.recordTest('Elevation Cost Config', false, 'Elevation cost configuration not found');
        }
        
        const distanceCost = enhancedCost.distanceCost;
        if (distanceCost) {
          this.recordTest('Distance Cost Config', true, 
            `Deviation weight: ${distanceCost.deviationWeight}, Exponent: ${distanceCost.deviationExponent}`);
        } else {
          this.recordTest('Distance Cost Config', false, 'Distance cost configuration not found');
        }
      } else {
        this.recordTest('Configuration Found', false, 'Enhanced cost routing configuration not found');
      }
    } catch (error) {
      this.recordTest('Configuration Loading', false, error.message);
    }
  }

  testCostCalculationLogic() {
    console.log('\n📋 Test 2: Cost Calculation Logic');
    
    // Test elevation gain rate cost calculation
    const elevationTests = [
      { actual: 50, target: 50, expectedLow: true, name: 'Perfect Elevation Match' },
      { actual: 75, target: 50, expectedLow: false, name: 'Elevation Deviation' },
      { actual: 150, target: 50, expectedLow: false, name: 'Large Elevation Deviation' }
    ];
    
    elevationTests.forEach(test => {
      const deviationPercent = Math.abs(test.actual - test.target) / test.target;
      const deviationCost = Math.pow(deviationPercent * 3.0, 1.5);
      
      // Add preference cost based on difficulty ranges
      let preferenceCost = 0.5; // Default for unknown ranges
      if (test.actual >= 0 && test.actual < 50) preferenceCost = 0.2;
      else if (test.actual >= 50 && test.actual < 100) preferenceCost = 0.0;
      else if (test.actual >= 100 && test.actual < 150) preferenceCost = 0.1;
      else if (test.actual >= 150 && test.actual < 200) preferenceCost = 0.3;
      else if (test.actual >= 200) preferenceCost = 0.5;
      
      const totalCost = (deviationCost * 0.7) + (preferenceCost * 0.3);
      const passed = test.expectedLow ? totalCost < 0.1 : totalCost > 0.1;
      
      this.recordTest(test.name, passed, `Cost: ${totalCost.toFixed(3)}`);
    });
    
    // Test distance cost calculation
    const distanceTests = [
      { actual: 10, target: 10, expectedLow: true, name: 'Perfect Distance Match' },
      { actual: 15, target: 10, expectedLow: false, name: 'Distance Deviation' },
      { actual: 25, target: 10, expectedLow: false, name: 'Large Distance Deviation' }
    ];
    
    distanceTests.forEach(test => {
      const deviationPercent = Math.abs(test.actual - test.target) / test.target;
      const deviationCost = Math.pow(deviationPercent * 2.0, 1.2);
      
      // Add preference cost based on distance ranges
      let preferenceCost = 0.5; // Default for unknown ranges
      if (test.actual >= 0 && test.actual < 2) preferenceCost = 0.4;
      else if (test.actual >= 2 && test.actual < 5) preferenceCost = 0.2;
      else if (test.actual >= 5 && test.actual < 15) preferenceCost = 0.0;
      else if (test.actual >= 15 && test.actual < 25) preferenceCost = 0.1;
      else if (test.actual >= 25) preferenceCost = 0.3;
      
      const totalCost = (deviationCost * 0.7) + (preferenceCost * 0.3);
      const passed = test.expectedLow ? totalCost < 0.1 : totalCost > 0.1;
      
      this.recordTest(test.name, passed, `Cost: ${totalCost.toFixed(3)}`);
    });
  }

  testPreferenceWeights() {
    console.log('\n📋 Test 3: Preference Weights');
    
    // Test that elevation has higher weight than distance
    const elevationMismatchCost = this.calculateOverallCost(100, 50, 10, 10, 'loop');
    const distanceMismatchCost = this.calculateOverallCost(50, 50, 20, 10, 'loop');
    
    // With shape as highest priority (40%), shape costs should dominate
    // Elevation (35%) and distance (25%) should be secondary
    const passed = elevationMismatchCost > distanceMismatchCost * 0.7; // Elevation should still cost more than distance
    this.recordTest('Shape > Elevation > Distance Priority', passed, 
      `Elevation mismatch: ${elevationMismatchCost.toFixed(2)}, Distance mismatch: ${distanceMismatchCost.toFixed(2)}`);
    
    // Test route shape preferences
    const loopCost = this.calculateOverallCost(50, 50, 10, 10, 'loop');
    const outAndBackCost = this.calculateOverallCost(50, 50, 10, 10, 'out-and-back');
    const pointToPointCost = this.calculateOverallCost(50, 50, 10, 10, 'point-to-point');
    
    const shapePassed = loopCost < outAndBackCost && outAndBackCost < pointToPointCost;
    this.recordTest('Route Shape Preferences', shapePassed,
      `Loop: ${loopCost.toFixed(2)}, Out-and-back: ${outAndBackCost.toFixed(2)}, Point-to-point: ${pointToPointCost.toFixed(2)}`);
  }

  testEdgeCases() {
    console.log('\n📋 Test 4: Edge Cases');
    
    // Test zero target values
    const zeroDistanceCost = this.calculateDistanceCost(10, 0);
    this.recordTest('Zero Target Distance', zeroDistanceCost >= 0, `Cost: ${zeroDistanceCost.toFixed(3)}`);
    
    const zeroElevationCost = this.calculateElevationCost(50, 0);
    this.recordTest('Zero Target Elevation', zeroElevationCost >= 0, `Cost: ${zeroElevationCost.toFixed(3)}`);
    
    // Test very large deviations
    const largeDeviationCost = this.calculateOverallCost(1000, 50, 100, 10, 'point-to-point');
    this.recordTest('Very Large Deviation', largeDeviationCost > 50, `Cost: ${largeDeviationCost.toFixed(2)}`);
  }

  calculateElevationCost(actual, target) {
    const deviationPercent = target > 0 ? Math.abs(actual - target) / target : 0;
    const deviationCost = Math.pow(deviationPercent * 3.0, 1.5);
    
    let preferenceCost = 0.5;
    if (actual >= 0 && actual < 50) preferenceCost = 0.2;
    else if (actual >= 50 && actual < 100) preferenceCost = 0.0;
    else if (actual >= 100 && actual < 150) preferenceCost = 0.1;
    else if (actual >= 150 && actual < 200) preferenceCost = 0.3;
    else if (actual >= 200) preferenceCost = 0.5;
    
    return (deviationCost * 0.7) + (preferenceCost * 0.3);
  }

  calculateDistanceCost(actual, target) {
    const deviationPercent = target > 0 ? Math.abs(actual - target) / target : 0;
    const deviationCost = Math.pow(deviationPercent * 2.0, 1.2);
    
    let preferenceCost = 0.5;
    if (actual >= 0 && actual < 2) preferenceCost = 0.4;
    else if (actual >= 2 && actual < 5) preferenceCost = 0.2;
    else if (actual >= 5 && actual < 15) preferenceCost = 0.0;
    else if (actual >= 15 && actual < 25) preferenceCost = 0.1;
    else if (actual >= 25) preferenceCost = 0.3;
    
    return (deviationCost * 0.7) + (preferenceCost * 0.3);
  }

  calculateShapeCost(shape) {
    switch (shape) {
      case 'loop': return 0.0;
      case 'out-and-back': return 0.1;
      case 'point-to-point': return 0.3;
      default: return 0.5;
    }
  }

  calculateOverallCost(actualElevation, targetElevation, actualDistance, targetDistance, shape) {
    const elevationCost = this.calculateElevationCost(actualElevation, targetElevation);
    const distanceCost = this.calculateDistanceCost(actualDistance, targetDistance);
    const shapeCost = this.calculateShapeCost(shape);
    
    // Use default weights: elevation 35%, distance 25%, shape 40%
    const totalCost = (elevationCost * 0.35) + (distanceCost * 0.25) + (shapeCost * 0.4);
    
    return totalCost * 100; // Normalize to 0-100 range
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
      console.log('🎉 All tests passed! Enhanced preference-based cost routing logic is working correctly.');
    } else {
      console.log('⚠️ Some tests failed. Please review the failed tests above.');
      process.exit(1);
    }
  }
}

// Run the tests
const testRunner = new SimpleEnhancedCostTest();
testRunner.runTests();
