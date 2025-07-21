import { spawnSync } from 'child_process';

export class TestOrchestrator {
  /**
   * Rebuild the test Postgres database by running the create_test_database.sh script.
   * This is a static method so it can be called without an instance.
   */
  static rebuildTestDatabase(): void {
    console.log('🛠️  Rebuilding test Postgres database using create_test_database.sh...');
    const result = spawnSync('./create_test_database.sh', ['--yes'], { encoding: 'utf-8' });
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
    if (result.status !== 0) {
      throw new Error(`❌ Failed to rebuild test database. Exit code: ${result.status}`);
    }
    console.log('✅ Test database rebuilt successfully.');
  }
} 