"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresDatabaseService = void 0;
const queries_1 = require("../sql/queries");
class PostgresDatabaseService {
    constructor(client) {
        this.client = client;
    }
    async connect() {
        await this.client.connect();
    }
    async disconnect() {
        await this.client.end();
    }
    async executeQuery(sql, params) {
        return await this.client.query(sql, params);
    }
    async executeTransaction(operations) {
        await this.client.query('BEGIN');
        try {
            for (const operation of operations) {
                await this.client.query(operation.sql, operation.params);
            }
            await this.client.query('COMMIT');
        }
        catch (error) {
            await this.client.query('ROLLBACK');
            throw error;
        }
    }
    async checkSchemaVersion(expectedVersion) {
        const result = await this.executeQuery(queries_1.ValidationQueries.checkSchemaVersion());
        if (!result.rows.length) {
            throw new Error('❌ schema_version table is missing or empty!');
        }
        const dbVersion = result.rows[0].version;
        if (dbVersion !== expectedVersion) {
            throw new Error(`❌ Schema version mismatch: expected ${expectedVersion}, found ${dbVersion}`);
        }
        console.log(`✅ Schema version ${dbVersion} is as expected.`);
    }
    async checkRequiredFunctions(requiredFunctions) {
        const result = await this.executeQuery(queries_1.ValidationQueries.checkRequiredFunctions(requiredFunctions), [requiredFunctions]);
        const foundFunctions = result.rows.map((row) => row.proname);
        const missingFunctions = requiredFunctions.filter(func => !foundFunctions.includes(func));
        if (missingFunctions.length > 0) {
            console.error(`❌ Installation incomplete. Missing functions: ${missingFunctions.join(', ')}`);
            console.error('💡 Please run: npx ts-node src/orchestrator/CarthorseOrchestrator.ts install');
            throw new Error(`Installation required. Missing functions: ${missingFunctions.join(', ')}`);
        }
        console.log('  ✅ All required functions available');
    }
    async checkRequiredTables(requiredTables) {
        const result = await this.executeQuery(queries_1.ValidationQueries.checkRequiredTables(requiredTables), [requiredTables]);
        const foundTables = result.rows.map((row) => row.table_name);
        const missingTables = requiredTables.filter(table => !foundTables.includes(table));
        if (missingTables.length > 0) {
            throw new Error(`❌ Required tables not found: ${missingTables.join(', ')}. Please run installation.`);
        }
        console.log('  ✅ All required tables available');
    }
    async checkDataAvailability(region, bbox) {
        const { query, params } = queries_1.ValidationQueries.checkDataAvailability(region, bbox);
        const result = await this.executeQuery(query, params);
        const count = parseInt(result.rows[0].count);
        const hasData = count > 0;
        // Get available regions for context
        const regionsResult = await this.executeQuery(queries_1.ValidationQueries.getAvailableRegions());
        const regions = regionsResult.rows.map((row) => row.region);
        if (!hasData) {
            console.warn(`⚠️  No trails found in production for region '${region}'`);
            console.log('   Available regions:');
            regionsResult.rows.forEach((row) => {
                console.log(`     ${row.region}: ${row.count} trails`);
            });
            throw new Error(`No trails found for region '${region}' in production database`);
        }
        console.log(`  ✅ Found ${count} trails for region '${region}'${bbox ? ' in bbox' : ''}`);
        return {
            trailCount: count,
            hasData,
            regions
        };
    }
}
exports.PostgresDatabaseService = PostgresDatabaseService;
//# sourceMappingURL=DatabaseService.js.map