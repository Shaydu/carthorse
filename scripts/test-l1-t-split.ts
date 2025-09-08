import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';
import { TIntersectionSplittingService } from '../src/services/layer1/TIntersectionSplittingService';

async function main() {
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  const stagingSchema = 'carthorse_1757343066744';

  try {
    console.log(`[TEST] Running Layer 1 TIntersectionSplittingService on schema: ${stagingSchema}`);

    const service = new TIntersectionSplittingService(pgClient, {
      stagingSchema,
      toleranceMeters: 5.0, // test a slightly larger tolerance
      verbose: true,
    } as any);

    const result = await service.execute();
    console.log('[TEST] T-Intersection result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[TEST] Error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pgClient.end();
  }
}

main();
