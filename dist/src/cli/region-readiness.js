#!/usr/bin/env ts-node
"use strict";
/**
 * CARTHORSE Region Readiness CLI
 *
 * Validates that a region's trail data is ready for export by checking:
 * - All trails have 3D geometry
 * - Elevation data is complete
 * - No invalid geometries
 * - No missing required fields
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRegionReadiness = runRegionReadiness;
const commander_1 = require("commander");
const DataIntegrityValidator_1 = require("../validation/DataIntegrityValidator");
const chalk_1 = __importDefault(require("chalk"));
const program = new commander_1.Command();
program
    .name('carthorse-readiness')
    .description('Validate region readiness for CARTHORSE export')
    .version('1.0.0');
program
    .command('check')
    .description('Check if a region is ready for export')
    .requiredOption('-r, --region <region>', 'Region to validate (e.g., boulder, seattle)')
    .option('-h, --host <host>', 'PostgreSQL host', 'localhost')
    .option('-p, --port <port>', 'PostgreSQL port', '5432')
    .option('-u, --user <user>', 'PostgreSQL user', 'postgres')
    .option('-d, --database <database>', 'PostgreSQL database', 'trail_master_db')
    .option('--password <password>', 'PostgreSQL password')
    .action(async (options) => {
    try {
        console.log(chalk_1.default.blue(`🔍 Checking region readiness for: ${options.region}`));
        const dbConfig = {
            host: options.host,
            port: parseInt(options.port),
            user: options.user,
            password: options.password || process.env.PGPASSWORD,
            database: options.database
        };
        const validator = new DataIntegrityValidator_1.DataIntegrityValidator(dbConfig);
        console.log(chalk_1.default.gray('Connecting to database...'));
        await validator.connect();
        console.log(chalk_1.default.gray('Running validation checks...'));
        const result = await validator.validateRegion(options.region);
        validator.printResults(result, options.region);
        await validator.disconnect();
        // Exit with appropriate code
        process.exit(result.passed ? 0 : 1);
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Validation failed:'), error);
        process.exit(1);
    }
});
program
    .command('list')
    .description('List available regions in the database')
    .option('-h, --host <host>', 'PostgreSQL host', 'localhost')
    .option('-p, --port <port>', 'PostgreSQL port', '5432')
    .option('-u, --user <user>', 'PostgreSQL user', 'postgres')
    .option('-d, --database <database>', 'PostgreSQL database', 'trail_master_db')
    .option('--password <password>', 'PostgreSQL password')
    .action(async (options) => {
    try {
        const { Client } = require('pg');
        const client = new Client({
            host: options.host,
            port: parseInt(options.port),
            user: options.user,
            password: options.password || process.env.PGPASSWORD,
            database: options.database
        });
        await client.connect();
        const result = await client.query(`
        SELECT DISTINCT region, COUNT(*) as trail_count 
        FROM trails 
        WHERE region IS NOT NULL 
        GROUP BY region 
        ORDER BY trail_count DESC
      `);
        console.log(chalk_1.default.blue('\n🗺️  Available Regions:'));
        console.log(chalk_1.default.blue('='.repeat(40)));
        if (result.rows.length === 0) {
            console.log(chalk_1.default.yellow('No regions found in database'));
        }
        else {
            result.rows.forEach((row) => {
                console.log(chalk_1.default.red(`  - ${row.name} (${row.osm_id}): ${row.geom_type}, ${row.dims}D, ${row.n_points} points`));
            });
        }
        await client.end();
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Failed to list regions:'), error);
        process.exit(1);
    }
});
// Export for programmatic use
async function runRegionReadiness(args = process.argv) {
    await program.parseAsync(args);
}
// Run if called directly
if (require.main === module) {
    runRegionReadiness();
}
//# sourceMappingURL=region-readiness.js.map