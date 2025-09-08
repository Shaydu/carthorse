import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../src/utils/config-loader';
import { MultipointIntersectionSplittingService } from '../src/services/layer1/MultipointIntersectionSplittingService';

async function main() {
  const dbConfig = getDatabasePoolConfig();
  const pgClient = new Pool(dbConfig);

  const stagingSchema = 'carthorse_1757343066744';

  try {
    console.log(`[TEST] Running Layer 1 MultipointIntersectionSplittingService on schema: ${stagingSchema}`);

    const service = new MultipointIntersectionSplittingService(pgClient, {
      stagingSchema,
      toleranceMeters: 5.0,
      minTrailLengthMeters: 5.0,
      maxIntersectionPoints: 10,
      maxIterations: 5,
      verbose: true,
    });

    const result = await service.splitMultipointIntersections();

    console.log('[TEST] Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[TEST] Error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pgClient.end();
  }
}

main();
