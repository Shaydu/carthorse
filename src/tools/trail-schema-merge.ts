#!/usr/bin/env node
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../utils/config-loader';

interface MergeResult {
  totalPublicTrails: number;
  totalCotrexTrails: number;
  mergedTrails: number;
  deduplicatedTrails: number;
  conflicts: number;
  errors: string[];
}

interface TrailComparison {
  publicTrail: any;
  cotrexTrail: any;
  distance: number;
  nameSimilarity: number;
  confidence: number;
}

class TrailSchemaMerge {
  private pgClient: Pool;

  constructor() {
    this.pgClient = new Pool(getDatabasePoolConfig());
  }

  async analyzeSchemas(): Promise<void> {
    console.log('🔍 Analyzing trail schemas...');
    
    // Get schema information
    const publicStats = await this.getSchemaStats('public', 'trails');
    const cotrexStats = await this.getSchemaStats('cotrex', 'trails');
    
    console.log('\n📊 Schema Analysis:');
    console.log('==================');
    console.log(`public.trails:`);
    console.log(`  - Total trails: ${publicStats.count}`);
    console.log(`  - Columns: ${publicStats.columns.join(', ')}`);
    console.log(`  - Sample trail:`, publicStats.sample);
    
    console.log(`\ncotrex.trails:`);
    console.log(`  - Total trails: ${cotrexStats.count}`);
    console.log(`  - Columns: ${cotrexStats.columns.join(', ')}`);
    console.log(`  - Sample trail:`, cotrexStats.sample);
  }

  async findOverlappingTrails(bbox?: string, tolerance: number = 100): Promise<TrailComparison[]> {
    console.log(`🔍 Finding overlapping trails (tolerance: ${tolerance}m)...`);
    
    const bboxFilter = bbox ? `AND ST_Intersects(t1.geometry, ST_MakeEnvelope(${bbox}))` : '';
    
    const query = `
      WITH overlapping AS (
        SELECT 
          t1.id as public_id,
          t1.name as public_name,
          t1.geometry as public_geometry,
          t2.id as cotrex_id,
          t2.name as cotrex_name,
          t2.geometry as cotrex_geometry,
          ST_Distance(t1.geometry, t2.geometry) as distance,
          GREATEST(
            similarity(t1.name, t2.name),
            similarity(COALESCE(t1.name, ''), COALESCE(t2.name, ''))
          ) as name_similarity
        FROM public.trails t1
        CROSS JOIN cotrex.trails t2
        WHERE ST_DWithin(t1.geometry, t2.geometry, ${tolerance})
        ${bboxFilter}
        AND t1.name IS NOT NULL 
        AND t2.name IS NOT NULL
        AND t1.name != ''
        AND t2.name != ''
      )
      SELECT 
        public_id,
        public_name,
        cotrex_id,
        cotrex_name,
        distance,
        name_similarity,
        (name_similarity * (1 - (distance / ${tolerance}))) as confidence
      FROM overlapping
      WHERE name_similarity > 0.3
      ORDER BY confidence DESC, distance ASC
      LIMIT 100;
    `;

    const result = await this.pgClient.query(query);
    
    console.log(`📊 Found ${result.rows.length} potential matches`);
    
    return result.rows.map(row => ({
      publicTrail: { id: row.public_id, name: row.public_name },
      cotrexTrail: { id: row.cotrex_id, name: row.cotrex_name },
      distance: parseFloat(row.distance),
      nameSimilarity: parseFloat(row.name_similarity),
      confidence: parseFloat(row.confidence)
    }));
  }

  async createMergedView(strategy: 'union' | 'intersection' | 'public_priority' | 'cotrex_priority' = 'union'): Promise<void> {
    console.log(`🔄 Creating merged view with strategy: ${strategy}`);
    
    let viewSQL = '';
    
    switch (strategy) {
      case 'union':
        viewSQL = `
          CREATE OR REPLACE VIEW trails_merged AS
          SELECT 
            'public' as source,
            id,
            name,
            geometry,
            created_at,
            updated_at
          FROM public.trails
          UNION ALL
          SELECT 
            'cotrex' as source,
            cpw_objectid as id,
            name,
            geometry,
            created_at,
            updated_at
          FROM cotrex.trails;
        `;
        break;
        
      case 'intersection':
        viewSQL = `
          CREATE OR REPLACE VIEW trails_merged AS
          SELECT 
            t1.id as public_id,
            t1.name as public_name,
            t1.geometry as public_geometry,
            t2.id as cotrex_id,
            t2.name as cotrex_name,
            t2.geometry as cotrex_geometry,
            ST_Distance(t1.geometry, t2.geometry) as distance
          FROM public.trails t1
          INNER JOIN cotrex.trails t2 ON ST_DWithin(t1.geometry, t2.geometry, 50)
          WHERE similarity(t1.name, t2.name) > 0.5;
        `;
        break;
        
      case 'public_priority':
        viewSQL = `
          CREATE OR REPLACE VIEW trails_merged AS
          SELECT 
            t1.id,
            COALESCE(t1.name, t2.name) as name,
            COALESCE(t1.geometry, t2.geometry) as geometry,
            'public_priority' as merge_strategy,
            t1.created_at,
            t1.updated_at
          FROM public.trails t1
          LEFT JOIN cotrex.trails t2 ON ST_DWithin(t1.geometry, t2.geometry, 100)
            AND similarity(t1.name, t2.name) > 0.3
          UNION ALL
          SELECT 
            t2.cpw_objectid as id,
            t2.name,
            t2.geometry,
            'cotrex_only' as merge_strategy,
            t2.created_at,
            t2.updated_at
          FROM cotrex.trails t2
          LEFT JOIN public.trails t1 ON ST_DWithin(t1.geometry, t2.geometry, 100)
            AND similarity(t1.name, t2.name) > 0.3
          WHERE t1.id IS NULL;
        `;
        break;
        
      case 'cotrex_priority':
        viewSQL = `
          CREATE OR REPLACE VIEW trails_merged AS
          SELECT 
            t2.cpw_objectid as id,
            COALESCE(t2.name, t1.name) as name,
            COALESCE(t2.geometry, t1.geometry) as geometry,
            'cotrex_priority' as merge_strategy,
            t2.created_at,
            t2.updated_at
          FROM cotrex.trails t2
          LEFT JOIN public.trails t1 ON ST_DWithin(t1.geometry, t2.geometry, 100)
            AND similarity(t1.name, t2.name) > 0.3
          UNION ALL
          SELECT 
            t1.id,
            t1.name,
            t1.geometry,
            'public_only' as merge_strategy,
            t1.created_at,
            t1.updated_at
          FROM public.trails t1
          LEFT JOIN cotrex.trails t2 ON ST_DWithin(t1.geometry, t2.geometry, 100)
            AND similarity(t1.name, t2.name) > 0.3
          WHERE t2.cpw_objectid IS NULL;
        `;
        break;
    }
    
    await this.pgClient.query(viewSQL);
    console.log(`✅ Created trails_merged view`);
  }

  async createMergedTable(strategy: 'union' | 'smart_merge' = 'smart_merge'): Promise<MergeResult> {
    console.log(`🔄 Creating merged table with strategy: ${strategy}`);
    
    const result: MergeResult = {
      totalPublicTrails: 0,
      totalCotrexTrails: 0,
      mergedTrails: 0,
      deduplicatedTrails: 0,
      conflicts: 0,
      errors: []
    };

    try {
      // Get counts
      const publicCount = await this.pgClient.query('SELECT COUNT(*) FROM public.trails');
      const cotrexCount = await this.pgClient.query('SELECT COUNT(*) FROM cotrex.trails');
      
      result.totalPublicTrails = parseInt(publicCount.rows[0].count);
      result.totalCotrexTrails = parseInt(cotrexCount.rows[0].count);

      // Create merged table
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS trails_merged (
          id SERIAL PRIMARY KEY,
          source_type VARCHAR(20) NOT NULL,
          source_id INTEGER,
          name VARCHAR(255),
          trail_type VARCHAR(100),
          length_miles DECIMAL(10,3),
          difficulty VARCHAR(50),
          surface_type VARCHAR(100),
          geometry GEOMETRY(LINESTRINGZ, 4326),
          merge_confidence DECIMAL(5,3),
          merge_notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      
      await this.pgClient.query(createTableSQL);
      await this.pgClient.query('TRUNCATE TABLE trails_merged');

      if (strategy === 'union') {
        // Simple union - insert all trails from both sources
        await this.pgClient.query(`
          INSERT INTO trails_merged (source_type, source_id, name, geometry, created_at)
          SELECT 'public', id, name, geometry, created_at FROM public.trails
        `);
        
        await this.pgClient.query(`
          INSERT INTO trails_merged (source_type, source_id, name, trail_type, length_miles, difficulty, surface_type, geometry, created_at)
          SELECT 'cotrex', cpw_objectid, name, trail_type, length_miles, difficulty, surface_type, geometry, created_at FROM cotrex.trails
        `);
        
        const mergedCount = await this.pgClient.query('SELECT COUNT(*) FROM trails_merged');
        result.mergedTrails = parseInt(mergedCount.rows[0].count);
        
      } else if (strategy === 'smart_merge') {
        // Smart merge with deduplication
        await this.performSmartMerge(result);
      }

      // Create indexes
      await this.createMergedIndexes();
      
      // Generate summary
      await this.generateMergeSummary(result);

    } catch (error: any) {
      result.errors.push(error.message || 'Unknown error');
      console.error('Error in merge:', error);
    }

    return result;
  }

  private async performSmartMerge(result: MergeResult): Promise<void> {
    console.log('🧠 Performing smart merge...');
    
    // Step 1: Find overlapping trails
    const overlapping = await this.findOverlappingTrails();
    
    // Step 2: Insert non-overlapping public trails
    const publicOnlySQL = `
      INSERT INTO trails_merged (source_type, source_id, name, geometry, created_at)
      SELECT 'public', t1.id, t1.name, t1.geometry, t1.created_at
      FROM public.trails t1
      LEFT JOIN cotrex.trails t2 ON ST_DWithin(t1.geometry, t2.geometry, 100)
        AND similarity(t1.name, t2.name) > 0.3
      WHERE t2.cpw_objectid IS NULL;
    `;
    
    const publicOnlyResult = await this.pgClient.query(publicOnlySQL);
    result.mergedTrails += publicOnlyResult.rowCount || 0;
    
    // Step 3: Insert non-overlapping cotrex trails
    const cotrexOnlySQL = `
      INSERT INTO trails_merged (source_type, source_id, name, trail_type, length_miles, difficulty, surface_type, geometry, created_at)
      SELECT 'cotrex', t2.cpw_objectid, t2.name, t2.trail_type, t2.length_miles, t2.difficulty, t2.surface_type, t2.geometry, t2.created_at
      FROM cotrex.trails t2
      LEFT JOIN public.trails t1 ON ST_DWithin(t1.geometry, t2.geometry, 100)
        AND similarity(t1.name, t2.name) > 0.3
      WHERE t1.id IS NULL;
    `;
    
    const cotrexOnlyResult = await this.pgClient.query(cotrexOnlySQL);
    result.mergedTrails += cotrexOnlyResult.rowCount || 0;
    
    // Step 4: Insert merged overlapping trails
    for (const overlap of overlapping.slice(0, 50)) { // Limit to top 50 matches
      try {
        const mergeSQL = `
          INSERT INTO trails_merged (source_type, source_id, name, trail_type, length_miles, difficulty, surface_type, geometry, merge_confidence, merge_notes, created_at)
          SELECT 
            'merged',
            t1.id,
            COALESCE(t1.name, t2.name) as name,
            t2.trail_type,
            t2.length_miles,
            t2.difficulty,
            t2.surface_type,
            COALESCE(t1.geometry, t2.geometry) as geometry,
            ${overlap.confidence} as merge_confidence,
            'Merged from public.trails (${overlap.publicTrail.id}) and cotrex.trails (${overlap.cotrexTrail.id})' as merge_notes,
            LEAST(t1.created_at, t2.created_at) as created_at
          FROM public.trails t1
          JOIN cotrex.trails t2 ON t1.id = ${overlap.publicTrail.id} AND t2.cpw_objectid = ${overlap.cotrexTrail.id}
        `;
        
        await this.pgClient.query(mergeSQL);
        result.mergedTrails++;
        result.deduplicatedTrails++;
        
      } catch (error) {
        result.conflicts++;
        result.errors.push(`Merge conflict for public.trails.${overlap.publicTrail.id} and cotrex.trails.${overlap.cotrexTrail.id}: ${(error as any).message || 'Unknown error'}`);
      }
    }
  }

  private async createMergedIndexes(): Promise<void> {
    console.log('🔍 Creating indexes on merged table...');
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_trails_merged_geometry ON trails_merged USING GIST (geometry);',
      'CREATE INDEX IF NOT EXISTS idx_trails_merged_source ON trails_merged (source_type, source_id);',
      'CREATE INDEX IF NOT EXISTS idx_trails_merged_name ON trails_merged (name);',
      'CREATE INDEX IF NOT EXISTS idx_trails_merged_confidence ON trails_merged (merge_confidence);'
    ];

    for (const indexSQL of indexes) {
      try {
        await this.pgClient.query(indexSQL);
      } catch (error) {
        console.warn(`Warning: Could not create index: ${error.message}`);
      }
    }
  }

  private async generateMergeSummary(result: MergeResult): Promise<void> {
    console.log('📊 Generating merge summary...');
    
    const statsQuery = `
      SELECT 
        source_type,
        COUNT(*) as count,
        AVG(merge_confidence) as avg_confidence
      FROM trails_merged
      GROUP BY source_type
      ORDER BY source_type;
    `;

    const statsResult = await this.pgClient.query(statsQuery);
    
    console.log('\n📊 Merge Summary:');
    console.log('================');
    console.log(`Total public trails: ${result.totalPublicTrails}`);
    console.log(`Total cotrex trails: ${result.totalCotrexTrails}`);
    console.log(`Merged trails: ${result.mergedTrails}`);
    console.log(`Deduplicated: ${result.deduplicatedTrails}`);
    console.log(`Conflicts: ${result.conflicts}`);
    console.log(`Errors: ${result.errors.length}`);
    
    console.log('\nBreakdown by source:');
    for (const row of statsResult.rows) {
      console.log(`  ${row.source_type}: ${row.count} trails (avg confidence: ${parseFloat(row.avg_confidence || 0).toFixed(3)})`);
    }
    
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(error => console.log(`  - ${error}`));
    }
  }

  private async getSchemaStats(schema: string, table: string): Promise<any> {
    const countQuery = `SELECT COUNT(*) FROM ${schema}.${table}`;
    const columnsQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `;
    const sampleQuery = `SELECT * FROM ${schema}.${table} LIMIT 1`;
    
    const [countResult, columnsResult, sampleResult] = await Promise.all([
      this.pgClient.query(countQuery),
      this.pgClient.query(columnsQuery, [schema, table]),
      this.pgClient.query(sampleQuery)
    ]);
    
    return {
      count: parseInt(countResult.rows[0].count),
      columns: columnsResult.rows.map(row => row.column_name),
      sample: sampleResult.rows[0] || null
    };
  }

  async close(): Promise<void> {
    await this.pgClient.end();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const strategy = process.argv[3] || 'smart_merge';
  
  const merger = new TrailSchemaMerge();
  
  try {
    switch (command) {
      case 'analyze':
        await merger.analyzeSchemas();
        break;
        
      case 'overlap':
        const tolerance = parseInt(process.argv[3]) || 100;
        const overlapping = await merger.findOverlappingTrails(undefined, tolerance);
        console.log('\n🔍 Overlapping Trails:');
        overlapping.forEach((overlap, index) => {
          console.log(`${index + 1}. ${overlap.publicTrail.name} ↔ ${overlap.cotrexTrail.name}`);
          console.log(`   Distance: ${overlap.distance.toFixed(1)}m, Similarity: ${(overlap.nameSimilarity * 100).toFixed(1)}%, Confidence: ${(overlap.confidence * 100).toFixed(1)}%`);
        });
        break;
        
      case 'view':
        await merger.createMergedView(strategy as any);
        break;
        
      case 'table':
        const result = await merger.createMergedTable(strategy as any);
        console.log('\n✅ Merge complete!');
        break;
        
      default:
        console.log('Usage:');
        console.log('  analyze                    - Analyze both schemas');
        console.log('  overlap [tolerance]        - Find overlapping trails');
        console.log('  view [strategy]            - Create merged view');
        console.log('  table [strategy]           - Create merged table');
        console.log('');
        console.log('Strategies:');
        console.log('  union, intersection, public_priority, cotrex_priority, smart_merge');
    }
  } finally {
    await merger.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
