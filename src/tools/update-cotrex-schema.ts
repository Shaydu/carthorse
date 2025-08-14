#!/usr/bin/env node
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

class CotrexSchemaUpdater {
  private pgClient: Pool;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
  }

  async updateCotrexSchema(): Promise<void> {
    console.log('🗄️ Updating cotrex.trails schema to include elevation fields...');
    
    try {
      // Add elevation columns if they don't exist
      const alterQueries = [
        'ALTER TABLE cotrex.trails ADD COLUMN IF NOT EXISTS elevation_gain INTEGER;',
        'ALTER TABLE cotrex.trails ADD COLUMN IF NOT EXISTS elevation_loss INTEGER;',
        'ALTER TABLE cotrex.trails ADD COLUMN IF NOT EXISTS max_elevation INTEGER;',
        'ALTER TABLE cotrex.trails ADD COLUMN IF NOT EXISTS min_elevation INTEGER;',
        'ALTER TABLE cotrex.trails ADD COLUMN IF NOT EXISTS avg_elevation INTEGER;'
      ];

      for (const query of alterQueries) {
        await this.pgClient.query(query);
      }

      console.log('✅ Added elevation columns to cotrex.trails');

      // Show current schema
      await this.showCurrentSchema();

    } catch (error: any) {
      console.error('❌ Error updating schema:', error.message);
      throw error;
    }
  }

  private async showCurrentSchema(): Promise<void> {
    const query = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'cotrex' AND table_name = 'trails'
      ORDER BY ordinal_position;
    `;

    const result = await this.pgClient.query(query);
    
    console.log('\n📋 Current cotrex.trails schema:');
    console.log('================================');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    // Show elevation data status
    const statsQuery = `
      SELECT 
        COUNT(*) as total_trails,
        COUNT(elevation_gain) as with_elevation_gain,
        COUNT(elevation_loss) as with_elevation_loss,
        COUNT(max_elevation) as with_max_elevation,
        COUNT(min_elevation) as with_min_elevation,
        COUNT(avg_elevation) as with_avg_elevation,
        COUNT(CASE WHEN ST_NDims(geometry) = 3 THEN 1 END) as with_3d_geometry
      FROM cotrex.trails;
    `;

    const statsResult = await this.pgClient.query(statsQuery);
    const stats = statsResult.rows[0];

    console.log('\n📊 Current Elevation Data Status:');
    console.log('=================================');
    console.log(`Total trails: ${stats.total_trails}`);
    console.log(`With elevation gain: ${stats.with_elevation_gain} (${((stats.with_elevation_gain/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With elevation loss: ${stats.with_elevation_loss} (${((stats.with_elevation_loss/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With max elevation: ${stats.with_max_elevation} (${((stats.with_max_elevation/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With min elevation: ${stats.with_min_elevation} (${((stats.with_min_elevation/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With avg elevation: ${stats.with_avg_elevation} (${((stats.with_avg_elevation/stats.total_trails)*100).toFixed(1)}%)`);
    console.log(`With 3D geometry: ${stats.with_3d_geometry} (${((stats.with_3d_geometry/stats.total_trails)*100).toFixed(1)}%)`);
  }

  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

async function main(): Promise<void> {
  console.log('🗄️ CPW Schema Updater');
  console.log('=====================\n');
  
  const updater = new CotrexSchemaUpdater();
  
  try {
    await updater.updateCotrexSchema();
    console.log('\n✅ Schema update complete!');
    console.log('🚀 Ready to run elevation processing');
  } finally {
    await updater.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
