import { DataIntegrityValidator } from '../validation/DataIntegrityValidator';

describe.skip('CARTHORSE Basic Tests', () => {
  test('DataIntegrityValidator can be instantiated', () => {
    const validator = new DataIntegrityValidator({
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'test'
    });
    expect(validator).toBeDefined();
  });
}); 