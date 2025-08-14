#!/usr/bin/env node
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

class PublicTrailsSchemaChecker {
  private pgClient: Pool;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
  }

  async checkSchema(): Promise<void> {
    console.log('🔍 Checking public.trails schema...');
    console.log('==================================\n');

    try {
      // Get column information
      const columnsQuery = `
        SELECT 
          column_name, 
          data_type, 
          is_nullable,
          column_default
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'trails'
        ORDER BY ordinal_position;
      `;

      const result = await this.pgClient.query(columnsQuery);
      
      console.log('📋 Current public.trails columns:');
      console.log('================================');
      result.rows.forEach((row, index) => {
        console.log(`${index + 1}. ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        if (row.column_default) {
          console.log(`   Default: ${row.column_default}`);
        }
      });

      // Check if tags or source columns exist
      const hasTags = result.rows.some(row => row.column_name === 'tags');
      const hasSource = result.rows.some(row => row.column_name === 'source');
      const hasMetadata = result.rows.some(row => row.column_name === 'metadata');

      console.log('\n🎯 Source/Tagging Options:');
      console.log('==========================');
      console.log(`Has 'tags' column: ${hasTags ? '✅ Yes' : '❌ No'}`);
      console.log(`Has 'source' column: ${hasSource ? '✅ Yes' : '❌ No'}`);
      console.log(`Has 'metadata' column: ${hasMetadata ? '✅ Yes' : '❌ No'}`);

      // Show sample data to understand current structure
      const sampleQuery = `
        SELECT * FROM public.trails 
        ORDER BY id 
        LIMIT 3;
      `;

      const sampleResult = await this.pgClient.query(sampleQuery);
      
      console.log('\n📋 Sample records from public.trails:');
      console.log('=====================================');
      sampleResult.rows.forEach((row, index) => {
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

      // Recommendations
      console.log('\n💡 Recommendations:');
      console.log('==================');
      if (hasTags) {
        console.log('✅ Use existing "tags" column (JSONB) for source information');
      } else if (hasSource) {
        console.log('✅ Use existing "source" column for CPW identification');
      } else if (hasMetadata) {
        console.log('✅ Use existing "metadata" column for additional CPW data');
      } else {
        console.log('❌ No suitable column found - recommend adding a "tags" column');
        console.log('   ALTER TABLE public.trails ADD COLUMN tags JSONB;');
      }

    } catch (error: any) {
      console.error('❌ Error checking schema:', error.message);
    }
  }

  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

async function main(): Promise<void> {
  console.log('🔍 Public Trails Schema Checker');
  console.log('===============================\n');
  
  const checker = new PublicTrailsSchemaChecker();
  
  try {
    await checker.checkSchema();
  } finally {
    await checker.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
