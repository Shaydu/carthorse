"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaVerifier = void 0;
exports.verifyTestDatabaseSchema = verifyTestDatabaseSchema;
const pg_1 = require("pg");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs = __importStar(require("fs"));
class SchemaVerifier {
    constructor(pgConfig, sqlitePath) {
        this.pgConfig = pgConfig;
        this.sqlitePath = sqlitePath;
        this.sqliteDb = null;
        this.pgClient = new pg_1.Client(pgConfig);
    }
    async connect() {
        await this.pgClient.connect();
        if (this.sqlitePath && fs.existsSync(this.sqlitePath)) {
            this.sqliteDb = new better_sqlite3_1.default(this.sqlitePath, { readonly: true });
        }
    }
    async disconnect() {
        await this.pgClient.end();
        if (this.sqliteDb) {
            this.sqliteDb.close();
        }
    }
    /**
     * Get PostgreSQL table schema
     */
    async getPostgresSchema() {
        const query = `
      SELECT 
        t.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length
      FROM information_schema.tables t
      JOIN information_schema.columns c ON t.table_name = c.table_name
      WHERE t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
        AND c.table_schema = 'public'
      ORDER BY t.table_name, c.ordinal_position
    `;
        const result = await this.pgClient.query(query);
        const tables = {};
        result.rows.forEach((row) => {
            if (!tables[row.table_name]) {
                tables[row.table_name] = [];
            }
            tables[row.table_name].push({
                table_name: row.table_name,
                column_name: row.column_name,
                data_type: row.data_type,
                is_nullable: row.is_nullable,
                column_default: row.column_default,
                character_maximum_length: row.character_maximum_length
            });
        });
        return Object.keys(tables).map(tableName => ({
            table_name: tableName,
            columns: tables[tableName] || [],
        }));
    }
    /**
     * Get SQLite table schema
     */
    getSqliteSchema() {
        if (!this.sqliteDb) {
            throw new Error('SQLite database not connected');
        }
        const tables = {};
        // Get all table names
        const tableNames = this.sqliteDb.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'spatial_%'
    `).all();
        tableNames.forEach(({ name }) => {
            const tableInfo = this.sqliteDb.prepare(`PRAGMA table_info(${name})`).all();
            tables[name] = tableInfo.map(row => ({
                table_name: name,
                column_name: row.name,
                data_type: this.normalizeSqliteType(row.type),
                is_nullable: row.notnull === 0 ? 'YES' : 'NO',
                column_default: row.dflt_value,
                character_maximum_length: null
            }));
        });
        return Object.keys(tables).map(tableName => ({
            table_name: tableName,
            columns: tables[tableName] || [],
        }));
    }
    /**
     * Normalize SQLite data types to PostgreSQL equivalents
     */
    normalizeSqliteType(sqliteType) {
        const type = sqliteType.toUpperCase();
        if (type.includes('INTEGER') || type.includes('INT'))
            return 'integer';
        if (type.includes('REAL') || type.includes('FLOAT') || type.includes('DOUBLE'))
            return 'real';
        if (type.includes('TEXT') || type.includes('VARCHAR') || type.includes('CHAR'))
            return 'text';
        if (type.includes('BLOB'))
            return 'bytea';
        if (type.includes('BOOLEAN') || type.includes('BOOL'))
            return 'boolean';
        if (type.includes('TIMESTAMP') || type.includes('DATETIME'))
            return 'timestamp';
        if (type.includes('DATE'))
            return 'date';
        if (type.includes('TIME'))
            return 'time';
        return 'text'; // Default fallback
    }
    /**
     * Compare schemas between PostgreSQL and SQLite
     */
    async compareSchemas() {
        const pgSchema = await this.getPostgresSchema();
        const sqliteSchema = this.getSqliteSchema();
        const pgTables = new Set(pgSchema.map(t => t.table_name));
        const sqliteTables = new Set(sqliteSchema.map(t => t.table_name));
        const comparison = {
            tables: {
                missing_in_test: Array.from(pgTables).filter(t => !sqliteTables.has(t)),
                missing_in_prod: Array.from(sqliteTables).filter(t => !pgTables.has(t)),
                common: Array.from(pgTables).filter(t => sqliteTables.has(t))
            },
            columns: {},
            isValid: true
        };
        // Compare columns for common tables
        comparison.tables.common.forEach(tableName => {
            const pgTable = pgSchema.find(t => t.table_name === tableName);
            const sqliteTable = sqliteSchema.find(t => t.table_name === tableName);
            if (!pgTable || !sqliteTable)
                return;
            const pgColumns = new Map(pgTable.columns.map(c => [c.column_name, c]));
            const sqliteColumns = new Map(sqliteTable.columns.map(c => [c.column_name, c]));
            const missingInTest = Array.from(pgColumns.keys()).filter(col => !sqliteColumns.has(col));
            const missingInProd = Array.from(sqliteColumns.keys()).filter(col => !pgColumns.has(col));
            const typeMismatches = [];
            pgColumns.forEach((pgCol, colName) => {
                const sqliteCol = sqliteColumns.get(colName);
                if (sqliteCol && pgCol.data_type !== sqliteCol.data_type) {
                    typeMismatches.push({
                        column: colName,
                        test_type: sqliteCol.data_type,
                        prod_type: pgCol.data_type
                    });
                }
            });
            comparison.columns[tableName] = {
                missing_in_test: missingInTest,
                missing_in_prod: missingInProd,
                type_mismatches: typeMismatches
            };
            // Mark as invalid if there are any differences
            if (missingInTest.length > 0 || missingInProd.length > 0 || typeMismatches.length > 0) {
                comparison.isValid = false;
            }
        });
        // Mark as invalid if there are missing tables
        if (comparison.tables.missing_in_test.length > 0 || comparison.tables.missing_in_prod.length > 0) {
            comparison.isValid = false;
        }
        return comparison;
    }
    /**
     * Print schema comparison report
     */
    printComparisonReport(comparison) {
        console.log('\n🔍 DATABASE SCHEMA COMPARISON REPORT');
        console.log('=====================================');
        if (comparison.isValid) {
            console.log('✅ Schemas match perfectly!');
            return;
        }
        // Table differences
        if (comparison.tables.missing_in_test.length > 0) {
            console.log('\n❌ Tables missing in test database:');
            comparison.tables.missing_in_test.forEach(table => {
                console.log(`   - ${table}`);
            });
        }
        if (comparison.tables.missing_in_prod.length > 0) {
            console.log('\n❌ Tables missing in production database:');
            comparison.tables.missing_in_prod.forEach(table => {
                console.log(`   - ${table}`);
            });
        }
        // Column differences
        Object.entries(comparison.columns).forEach(([tableName, differences]) => {
            if (differences.missing_in_test.length > 0 ||
                differences.missing_in_prod.length > 0 ||
                differences.type_mismatches.length > 0) {
                console.log(`\n📋 Table: ${tableName}`);
                if (differences.missing_in_test.length > 0) {
                    console.log('   ❌ Columns missing in test database:');
                    differences.missing_in_test.forEach(col => {
                        console.log(`      - ${col}`);
                    });
                }
                if (differences.missing_in_prod.length > 0) {
                    console.log('   ❌ Columns missing in production database:');
                    differences.missing_in_prod.forEach(col => {
                        console.log(`      - ${col}`);
                    });
                }
                if (differences.type_mismatches.length > 0) {
                    console.log('   ⚠️  Type mismatches:');
                    differences.type_mismatches.forEach(mismatch => {
                        console.log(`      - ${mismatch.column}: test=${mismatch.test_type}, prod=${mismatch.prod_type}`);
                    });
                }
            }
        });
        console.log('\n💡 RECOMMENDATIONS:');
        if (!comparison.isValid) {
            console.log('   - Update test database schema to match production');
            console.log('   - Run database migrations if needed');
            console.log('   - Verify that all required columns are present');
        }
    }
    /**
     * Verify that a specific table exists and has required columns
     */
    async verifyTable(tableName, requiredColumns) {
        try {
            const pgSchema = await this.getPostgresSchema();
            const pgTable = pgSchema.find(t => t.table_name === tableName);
            if (!pgTable) {
                console.log(`❌ Table '${tableName}' not found in production database`);
                return false;
            }
            const pgColumns = new Set(pgTable.columns.map(c => c.column_name));
            const missingColumns = requiredColumns.filter(col => !pgColumns.has(col));
            if (missingColumns.length > 0) {
                console.log(`❌ Table '${tableName}' missing required columns: ${missingColumns.join(', ')}`);
                return false;
            }
            console.log(`✅ Table '${tableName}' verified with all required columns`);
            return true;
        }
        catch (error) {
            console.error(`❌ Error verifying table '${tableName}':`, error);
            return false;
        }
    }
}
exports.SchemaVerifier = SchemaVerifier;
/**
 * Utility function to verify test database schema
 */
async function verifyTestDatabaseSchema(pgConfig, sqlitePath) {
    const verifier = new SchemaVerifier(pgConfig, sqlitePath);
    try {
        await verifier.connect();
        if (sqlitePath && fs.existsSync(sqlitePath)) {
            const comparison = await verifier.compareSchemas();
            verifier.printComparisonReport(comparison);
            return comparison.isValid;
        }
        else {
            // Just verify production schema
            const pgSchema = await verifier.getPostgresSchema();
            console.log('\n🔍 PRODUCTION DATABASE SCHEMA:');
            console.log('==============================');
            pgSchema.forEach(table => {
                console.log(`\n📋 Table: ${table.table_name}`);
                table.columns.forEach(col => {
                    console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
                });
            });
            return true;
        }
    }
    catch (error) {
        console.error('❌ Schema verification failed:', error);
        return false;
    }
    finally {
        await verifier.disconnect();
    }
}
//# sourceMappingURL=schema-verifier.js.map