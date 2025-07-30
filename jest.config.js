module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  globalSetup: '<rootDir>/jest.global-setup.js',
  globalTeardown: './jest.global-teardown.js',
  // Extend timeouts by 30%
  testTimeout: 156000, // Increased from 120000ms (2 minutes) to 156000ms (2.6 minutes)
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
}; 