import { Pool } from 'pg';

class MoveCotrexToPublic {
  private pgClient: Pool;

  constructor() {
    this.pgClient = new Pool({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'shaydu',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'trail_master_db',
    });
  }

  async run(): Promise<void> {
    console.log('🔄 Moving COTREX trails to public schema');
    console.log('========================================');

    try {
      await this.pgClient.connect();
      console.log('✅ Connected to database');

      // Check if public.cotrex_trails already exists
      const tableExists = await this.checkTableExists('public.cotrex_trails');
      
      if (tableExists) {
        console.log('⚠️  public.cotrex_trails already exists. Dropping it first...');
        await this.pgClient.query('DROP TABLE public.cotrex_trails');
        console.log('✅ Dropped existing public.cotrex_trails table');
      }

      // Create the public.cotrex_trails table with the same structure as cotrex.trails
      console.log('📋 Creating public.cotrex_trails table...');
      await this.createCotrexTrailsTable();
      console.log('✅ Created public.cotrex_trails table');

      // Copy all data from cotrex.trails to public.cotrex_trails
      console.log('📊 Copying data from cotrex.trails to public.cotrex_trails...');
      const copyResult = await this.copyData();
      console.log(`✅ Copied ${copyResult.rowCount} trails to public.cotrex_trails`);

      // Verify the data was copied correctly
      console.log('🔍 Verifying data...');
      await this.verifyData();

      console.log('🎯 Migration completed successfully!');

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    } finally {
      await this.pgClient.end();
    }
  }

  private async checkTableExists(tableName: string): Promise<boolean> {
    const result = await this.pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = $2
      )
    `, [tableName.split('.')[0], tableName.split('.')[1]]);
    
    return result.rows[0].exists;
  }

  private async createCotrexTrailsTable(): Promise<void> {
    await this.pgClient.query(`
      CREATE TABLE public.cotrex_trails (
        id SERIAL PRIMARY KEY,
        name TEXT,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geometry GEOMETRY(LINESTRING, 4326),
        length_km NUMERIC,
        region TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add spatial index
    await this.pgClient.query(`
      CREATE INDEX idx_cotrex_trails_geometry ON public.cotrex_trails USING GIST (geometry)
    `);

    // Add index on region
    await this.pgClient.query(`
      CREATE INDEX idx_cotrex_trails_region ON public.cotrex_trails (region)
    `);
  }

  private async copyData(): Promise<{rowCount: number}> {
    const result = await this.pgClient.query(`
      INSERT INTO public.cotrex_trails (
        id, name, trail_type, surface, difficulty, geometry, length_km, region
      )
      SELECT 
        id, name, trail_type, surface, difficulty, geometry, length_km, region
      FROM cotrex.trails
    `);

    return { rowCount: result.rowCount || 0 };
  }

  private async verifyData(): Promise<void> {
    // Check count
    const countResult = await this.pgClient.query('SELECT COUNT(*) as count FROM public.cotrex_trails');
    const cotrexCount = await this.pgClient.query('SELECT COUNT(*) as count FROM cotrex.trails');
    
    console.log(`   📊 public.cotrex_trails: ${countResult.rows[0].count} trails`);
    console.log(`   📊 cotrex.trails: ${cotrexCount.rows[0].count} trails`);
    
    if (countResult.rows[0].count !== cotrexCount.rows[0].count) {
      throw new Error(`Data count mismatch! Expected ${cotrexCount.rows[0].count}, got ${countResult.rows[0].count}`);
    }

    // Check sample data
    const sampleResult = await this.pgClient.query(`
      SELECT id, name, trail_type, ST_AsText(ST_StartPoint(geometry)) as start_point
      FROM public.cotrex_trails 
      LIMIT 3
    `);
    
    console.log('   📋 Sample trails:');
    sampleResult.rows.forEach(row => {
      console.log(`      - ${row.name} (ID: ${row.id}, Type: ${row.trail_type})`);
    });
  }
}

// Run the migration
if (require.main === module) {
  const migrator = new MoveCotrexToPublic();
  migrator.run()
    .then(() => {
      console.log('✅ Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}
