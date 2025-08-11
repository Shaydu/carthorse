"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTestConfig = exports.TestConfigLoader = exports.TEST_CONFIG = void 0;
exports.isTestDatabaseConfigured = isTestDatabaseConfigured;
exports.shouldSkipTest = shouldSkipTest;
exports.logTestConfiguration = logTestConfiguration;
// Centralized test configuration for Carthorse tests
// This file now uses the TestConfigLoader for YAML-based configuration
const test_config_loader_1 = require("./test-config-loader");
// Get the test config loader instance
const testConfigLoader = test_config_loader_1.TestConfigLoader.getInstance();
// Export the test configuration for backward compatibility
exports.TEST_CONFIG = testConfigLoader.getConfig();
// Export convenience functions for backward compatibility
function isTestDatabaseConfigured() {
    return testConfigLoader.isTestDatabaseConfigured();
}
function shouldSkipTest(reason) {
    return testConfigLoader.shouldSkipTest(reason);
}
function logTestConfiguration() {
    testConfigLoader.logTestConfiguration();
}
// Re-export types and loader for new usage
var test_config_loader_2 = require("./test-config-loader");
Object.defineProperty(exports, "TestConfigLoader", { enumerable: true, get: function () { return test_config_loader_2.TestConfigLoader; } });
Object.defineProperty(exports, "getTestConfig", { enumerable: true, get: function () { return test_config_loader_2.getTestConfig; } });
//# sourceMappingURL=test-config.js.map