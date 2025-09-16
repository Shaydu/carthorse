import { Pool } from 'pg';
import { DegreeZeroSnapService } from '../services/layer2/DegreeZeroSnapService';
import { getDatabasePoolConfig } from '../utils/config-loader';

async function main() {
  const schema = process.argv[2];
  const mode = process.argv[3] || 'analyze'; // 'analyze' | 'fix'
  const t1 = parseFloat(process.argv[4] || '2'); // endpoint tolerance meters
  const t2 = parseFloat(process.argv[5] || '3'); // edge tolerance meters

  if (!schema) {
    console.error('Usage: npx ts-node src/cli/degree-zero-analyze.ts <staging_schema> [analyze|fix] [endpoint_m] [edge_m]');
    process.exit(1);
  }

  const pg = new Pool(getDatabasePoolConfig());
  await pg.connect();

  try {
    const service = new DegreeZeroSnapService(pg, {
      stagingSchema: schema,
      endpointToleranceMeters: t1,
      edgeToleranceMeters: t2,
      dryRun: mode !== 'fix',
      verbose: true
    });

    const report = mode === 'fix' ? await service.fix() : await service.analyze();

    console.log('\nDegree-0 analysis:');
    console.log(`  total_nodes: ${report.totalNodes}`);
    console.log(`  degree_zero: ${report.degreeZero}`);
    console.log(`  near_endpoint: ${report.nearEndpoint}`);
    console.log(`  near_edge: ${report.nearEdge}`);
    console.log(`  on_bbox_boundary: ${report.onBboxBoundary}`);
    if (mode === 'fix') {
      console.log(`  fixed_by_endpoint_snap: ${report.fixedByEndpointSnap}`);
      console.log(`  fixed_by_edge_projection: ${report.fixedByEdgeProjection}`);
    }
  } finally {
    await pg.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });


