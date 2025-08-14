#!/usr/bin/env node
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

class TrailSchemaComparator {
  private pgClient: Pool;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
  }

  async compareSchemas(): Promise<void> {
    console.log('🔍 Comparing trail schemas...');
    console.log('============================\n');

    // Get schema information
    const publicStats = await this.getSchemaStats('public', 'trails');
    const cotrexStats = await this.getSchemaStats('cotrex', 'trails');
    
    console.log('📊 Schema Comparison:');
    console.log('====================');
    console.log(`public.trails:`);
    console.log(`  - Total trails: ${publicStats.count}`);
    console.log(`  - Columns: ${publicStats.columns.join(', ')}`);
    
    console.log(`\ncotrex.trails:`);
    console.log(`  - Total trails: ${cotrexStats.count}`);
    console.log(`  - Columns: ${cotrexStats.columns.join(', ')}`);

    console.log('\n📋 Sample Records:');
    console.log('==================');
    
    console.log('\n🏔️ Sample from public.trails:');
    console.log('-----------------------------');
    await this.showSampleRecords('public', 'trails', 3);
    
    console.log('\n🏔️ Sample from cotrex.trails:');
    console.log('-----------------------------');
    await this.showSampleRecords('cotrex', 'trails', 3);

    console.log('\n📊 Data Quality Analysis:');
    console.log('========================');
    await this.analyzeDataQuality();
  }

  private async getSchemaStats(schema: string, table: string): Promise<any> {
    const countQuery = `SELECT COUNT(*) FROM ${schema}.${table}`;
    const columnsQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `;
    
    const [countResult, columnsResult] = await Promise.all([
      this.pgClient.query(countQuery),
      this.pgClient.query(columnsQuery, [schema, table])
    ]);
    
    return {
      count: parseInt(countResult.rows[0].count),
      columns: columnsResult.rows.map(row => `${row.column_name} (${row.data_type})`)
    };
  }

  private async showSampleRecords(schema: string, table: string, limit: number): Promise<void> {
    const query = `
      SELECT * FROM ${schema}.${table} 
      ORDER BY id 
      LIMIT ${limit};
    `;
    
    const result = await this.pgClient.query(query);
    
    result.rows.forEach((row, index) => {
      console.log(`\nRecord ${index + 1}:`);
      Object.entries(row).forEach(([key, value]) => {
        if (key === 'geometry') {
          console.log(`  ${key}: [GEOMETRY - ${typeof value}]`);
        } else if (typeof value === 'string' && value.length > 100) {
          console.log(`  ${key}: "${value.substring(0, 100)}..."`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      });
    });
  }

  private async analyzeDataQuality(): Promise<void> {
    console.log('\n📈 Data Completeness Analysis:');
    console.log('-----------------------------');
    
    // Analyze public.trails
    const publicAnalysis = await this.analyzeTable('public', 'trails');
    console.log('\npublic.trails:');
    Object.entries(publicAnalysis).forEach(([field, stats]) => {
      console.log(`  ${field}: ${stats.nullCount}/${stats.totalCount} null (${((stats.nullCount/stats.totalCount)*100).toFixed(1)}%)`);
    });

    // Analyze cotrex.trails
    const cotrexAnalysis = await this.analyzeTable('cotrex', 'trails');
    console.log('\ncotrex.trails:');
    Object.entries(cotrexAnalysis).forEach(([field, stats]) => {
      console.log(`  ${field}: ${stats.nullCount}/${stats.totalCount} null (${((stats.nullCount/stats.totalCount)*100).toFixed(1)}%)`);
    });

    // Show unique values for key fields
    console.log('\n🎯 Key Field Analysis:');
    console.log('---------------------');
    
    await this.showUniqueValues('public', 'trails', 'name', 10);
    await this.showUniqueValues('cotrex', 'trails', 'name', 10);
    
    await this.showUniqueValues('public', 'trails', 'trail_type', 5);
    await this.showUniqueValues('cotrex', 'trails', 'trail_type', 5);
  }

  private async analyzeTable(schema: string, table: string): Promise<any> {
    const columnsQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2
      AND data_type NOT LIKE '%geometry%'
      ORDER BY ordinal_position;
    `;
    
    const columnsResult = await this.pgClient.query(columnsQuery, [schema, table]);
    const columns = columnsResult.rows.map(row => row.column_name);
    
    const analysis: any = {};
    
    for (const column of columns) {
      const nullQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(${column}) as non_null,
          COUNT(*) - COUNT(${column}) as null_count
        FROM ${schema}.${table};
      `;
      
      const result = await this.pgClient.query(nullQuery);
      const stats = result.rows[0];
      
      analysis[column] = {
        totalCount: parseInt(stats.total),
        nullCount: parseInt(stats.null_count),
        nonNullCount: parseInt(stats.non_null)
      };
    }
    
    return analysis;
  }

  private async showUniqueValues(schema: string, table: string, field: string, limit: number): Promise<void> {
    try {
      const query = `
        SELECT ${field}, COUNT(*) as count
        FROM ${schema}.${table}
        WHERE ${field} IS NOT NULL
        GROUP BY ${field}
        ORDER BY count DESC
        LIMIT ${limit};
      `;
      
      const result = await this.pgClient.query(query);
      
      console.log(`\n${schema}.${table}.${field} (top ${limit}):`);
      result.rows.forEach(row => {
        console.log(`  "${row[field]}": ${row.count} trails`);
      });
    } catch (error: any) {
      console.log(`\n${schema}.${table}.${field}: Error - ${error.message}`);
    }
  }

  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

async function main(): Promise<void> {
  console.log('🔍 Trail Schema Comparison Tool');
  console.log('===============================\n');
  
  const comparator = new TrailSchemaComparator();
  
  try {
    await comparator.compareSchemas();
  } finally {
    await comparator.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
