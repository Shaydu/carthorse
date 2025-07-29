// Basic tests have been moved to specific test files
// This file is kept for future basic functionality tests if needed
describe('CARTHORSE Basic Tests', () => {
  test('should have proper environment setup', () => {
    expect(process.env.PGHOST).toBeDefined();
    expect(process.env.PGUSER).toBeDefined();
    expect(process.env.PGDATABASE).toBeDefined();
  });
}); 