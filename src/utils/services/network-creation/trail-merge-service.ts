import { Pool } from 'pg';

export interface TrailMergeResult {
  totalTrails: number;
  mergedTrails: number;
  deduplicatedTrails: number;
  conflicts: number;
  details: {
    action: 'merged' | 'deduplicated' | 'conflict';
    trailName: string;
    source: string;
    reason: string;
  }[];
  errors: string[];
}

export interface TrailMergeConfig {
  stagingSchema: string;
  mergeSources: {
    osm?: boolean;
    cpw?: boolean;
    cotrex?: boolean;
  };
  deduplicationTolerance: number; // meters
  mergeStrategy: 'prefer_cpw' | 'prefer_osm' | 'longest' | 'highest_quality';
  enableConflictResolution: boolean;
}

export class TrailMergeService {
  constructor(private pgClient: Pool) {}

  /**
   * Merge and deduplicate trails from multiple sources
   */
  async mergeTrails(config: TrailMergeConfig): Promise<TrailMergeResult> {
    console.log('🔄 Starting trail merge and deduplication...');
    
    const result: TrailMergeResult = {
      totalTrails: 0,
      mergedTrails: 0,
      deduplicatedTrails: 0,
      conflicts: 0,
      details: [],
      errors: []
    };

    try {
      // Step 1: Create merged trails table
      await this.createMergedTrailsTable(config.stagingSchema);
      
      // Step 2: Load trails from all sources
      const sourceTrails = await this.loadSourceTrails(config);
      result.totalTrails = sourceTrails.length;
      
      console.log(`📊 Loaded ${sourceTrails.length} trails from sources`);
      
      // Step 3: Group trails by similarity
      const trailGroups = await this.groupSimilarTrails(sourceTrails, config.deduplicationTolerance);
      console.log(`📊 Grouped into ${trailGroups.length} potential duplicate groups`);
      
      // Step 4: Process each group
      for (const group of trailGroups) {
        try {
          const groupResult = await this.processTrailGroup(group, config);
          
          result.mergedTrails += groupResult.merged;
          result.deduplicatedTrails += groupResult.deduplicated;
          result.conflicts += groupResult.conflicts;
          result.details.push(...groupResult.details);
          
        } catch (error) {
          console.warn(`⚠️ Error processing trail group:`, error);
          result.errors.push(`Trail group error: ${error}`);
        }
      }
      
      // Step 5: Create indexes on merged table
      await this.createMergedIndexes(config.stagingSchema);
      
      // Step 6: Generate summary
      await this.generateMergeSummary(config.stagingSchema);
      
      console.log(`✅ Trail merge complete:`);
      console.log(`   📊 Total trails: ${result.totalTrails}`);
      console.log(`   🔗 Merged trails: ${result.mergedTrails}`);
      console.log(`   🗑️ Deduplicated trails: ${result.deduplicatedTrails}`);
      console.log(`   ⚠️ Conflicts: ${result.conflicts}`);
      console.log(`   ❌ Errors: ${result.errors.length}`);

    } catch (error) {
      console.error('❌ Trail merge failed:', error);
      result.errors.push(`Merge failed: ${error}`);
    }

    return result;
  }

  /**
   * Create merged trails table
   */
  private async createMergedTrailsTable(stagingSchema: string): Promise<void> {
    console.log('📁 Creating merged trails table...');
    
    await this.pgClient.query(`
      DROP TABLE IF EXISTS ${stagingSchema}.trails_merged CASCADE;
      
      CREATE TABLE ${stagingSchema}.trails_merged (
        id SERIAL PRIMARY KEY,
        app_uuid UUID DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        trail_type TEXT,
        surface TEXT,
        difficulty TEXT,
        geometry GEOMETRY(LINESTRINGZ, 4326),
        length_km REAL,
        elevation_gain REAL,
        elevation_loss REAL,
        max_elevation REAL,
        min_elevation REAL,
        avg_elevation REAL,
        region TEXT DEFAULT 'boulder',
        bbox_min_lng REAL,
        bbox_max_lng REAL,
        bbox_min_lat REAL,
        bbox_max_lat REAL,
        source TEXT,
        source_tags JSONB,
        merged_from JSONB, -- Array of source trail IDs
        merge_confidence REAL, -- Confidence score for the merge
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('✅ Merged trails table created');
  }

  /**
   * Load trails from all configured sources
   */
  private async loadSourceTrails(config: TrailMergeConfig): Promise<any[]> {
    const trails: any[] = [];
    
    // Load from staging trails (OSM data)
    if (config.mergeSources.osm) {
      const osmTrails = await this.pgClient.query(`
        SELECT 
          id,
          app_uuid,
          name,
          trail_type,
          surface,
          difficulty,
          geometry,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          region,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          source,
          source_tags,
          'osm' as source_type
        FROM ${config.stagingSchema}.trails
        WHERE source = 'osm' OR source IS NULL
      `);
      
      trails.push(...osmTrails.rows);
      console.log(`📥 Loaded ${osmTrails.rows.length} OSM trails`);
    }
    
    // Load from CPW backfill (if exists)
    if (config.mergeSources.cpw) {
      const cpwTrails = await this.pgClient.query(`
        SELECT 
          id,
          app_uuid,
          name,
          trail_type,
          surface,
          difficulty,
          geometry,
          length_km,
          elevation_gain,
          elevation_loss,
          max_elevation,
          min_elevation,
          avg_elevation,
          region,
          bbox_min_lng,
          bbox_max_lng,
          bbox_min_lat,
          bbox_max_lat,
          source,
          source_tags,
          'cpw' as source_type
        FROM ${config.stagingSchema}.trails
        WHERE source = 'cpw'
      `);
      
      trails.push(...cpwTrails.rows);
      console.log(`📥 Loaded ${cpwTrails.rows.length} CPW trails`);
    }
    
    // Load from cotrex schema (if exists)
    if (config.mergeSources.cotrex) {
      const cotrexExists = await this.checkSchemaExists('cotrex');
      if (cotrexExists) {
        const cotrexTrails = await this.pgClient.query(`
          SELECT 
            id,
            app_uuid,
            name,
            trail_type,
            surface,
            difficulty,
            geometry,
            length_km,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            region,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            'cotrex' as source,
            source_tags,
            'cotrex' as source_type
          FROM cotrex.trails
        `);
        
        trails.push(...cotrexTrails.rows);
        console.log(`📥 Loaded ${cotrexTrails.rows.length} COTREX trails`);
      }
    }
    
    return trails;
  }

  /**
   * Group similar trails using spatial proximity
   */
  private async groupSimilarTrails(trails: any[], tolerance: number): Promise<any[][]> {
    console.log('🔍 Grouping similar trails...');
    
    const groups: any[][] = [];
    const processed = new Set<number>();
    
    for (let i = 0; i < trails.length; i++) {
      if (processed.has(i)) continue;
      
      const group = [trails[i]];
      processed.add(i);
      
      // Find similar trails
      for (let j = i + 1; j < trails.length; j++) {
        if (processed.has(j)) continue;
        
        if (this.areTrailsSimilar(trails[i], trails[j], tolerance)) {
          group.push(trails[j]);
          processed.add(j);
        }
      }
      
      if (group.length > 1) {
        groups.push(group);
      }
    }
    
    return groups;
  }

  /**
   * Check if two trails are similar enough to be considered duplicates
   */
  private areTrailsSimilar(trail1: any, trail2: any, tolerance: number): boolean {
    // Check name similarity
    const nameSimilarity = this.calculateNameSimilarity(trail1.name, trail2.name);
    if (nameSimilarity < 0.7) return false;
    
    // Check spatial proximity
    const distance = this.calculateTrailDistance(trail1, trail2);
    if (distance > tolerance) return false;
    
    // Check length similarity
    const lengthDiff = Math.abs((trail1.length_km || 0) - (trail2.length_km || 0));
    const lengthSimilarity = 1 - (lengthDiff / Math.max(trail1.length_km || 1, trail2.length_km || 1));
    if (lengthSimilarity < 0.8) return false;
    
    return true;
  }

  /**
   * Calculate name similarity using Levenshtein distance
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const maxLength = Math.max(name1.length, name2.length);
    if (maxLength === 0) return 1;
    
    const distance = this.levenshteinDistance(name1.toLowerCase(), name2.toLowerCase());
    return 1 - (distance / maxLength);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate spatial distance between two trails
   */
  private calculateTrailDistance(trail1: any, trail2: any): number {
    // Use bounding box centers for quick distance calculation
    const center1 = {
      lng: (trail1.bbox_min_lng + trail1.bbox_max_lng) / 2,
      lat: (trail1.bbox_min_lat + trail1.bbox_max_lat) / 2
    };
    
    const center2 = {
      lng: (trail2.bbox_min_lng + trail2.bbox_max_lng) / 2,
      lat: (trail2.bbox_min_lat + trail2.bbox_max_lat) / 2
    };
    
    // Calculate distance in meters using Haversine formula
    const R = 6371000; // Earth radius in meters
    const dLat = (center2.lat - center1.lat) * Math.PI / 180;
    const dLng = (center2.lng - center1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(center1.lat * Math.PI / 180) * Math.cos(center2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }

  /**
   * Process a group of similar trails
   */
  private async processTrailGroup(group: any[], config: TrailMergeConfig): Promise<{
    merged: number;
    deduplicated: number;
    conflicts: number;
    details: any[];
  }> {
    const result = {
      merged: 0,
      deduplicated: 0,
      conflicts: 0,
      details: []
    };
    
    if (group.length === 1) {
      // Single trail, no merging needed
      await this.insertMergedTrail(group[0], [group[0].id], 1.0);
      return result;
    }
    
    // Multiple trails, need to merge
    const mergedTrail = this.mergeTrailGroup(group, config.mergeStrategy);
    const confidence = this.calculateMergeConfidence(group);
    
    await this.insertMergedTrail(mergedTrail, group.map(t => t.id), confidence);
    
    result.merged = 1;
    result.deduplicated = group.length - 1;
    
    // Log merge details
    const trailNames = group.map(t => t.name).join(', ');
    result.details.push({
      action: 'merged',
      trailName: mergedTrail.name,
      source: mergedTrail.source,
      reason: `Merged ${group.length} similar trails: ${trailNames}`
    });
    
    return result;
  }

  /**
   * Merge a group of trails into a single trail
   */
  private mergeTrailGroup(group: any[], strategy: string): any {
    // Sort by quality/priority based on strategy
    const sortedGroup = [...group].sort((a, b) => {
      switch (strategy) {
        case 'prefer_cpw':
          return this.getSourcePriority(b.source_type) - this.getSourcePriority(a.source_type);
        case 'prefer_osm':
          return this.getSourcePriority(a.source_type) - this.getSourcePriority(b.source_type);
        case 'longest':
          return (b.length_km || 0) - (a.length_km || 0);
        case 'highest_quality':
          return this.calculateTrailQuality(b) - this.calculateTrailQuality(a);
        default:
          return 0;
      }
    });
    
    // Use the best trail as the base
    const baseTrail = sortedGroup[0];
    
    // Merge additional data from other trails
    const mergedTrail = { ...baseTrail };
    
    // Merge source tags
    const mergedSourceTags = { ...baseTrail.source_tags };
    for (const trail of sortedGroup.slice(1)) {
      if (trail.source_tags) {
        Object.assign(mergedSourceTags, trail.source_tags);
      }
    }
    mergedTrail.source_tags = mergedSourceTags;
    
    // Update source to indicate it's merged
    mergedTrail.source = 'merged';
    
    return mergedTrail;
  }

  /**
   * Get source priority for merging
   */
  private getSourcePriority(sourceType: string): number {
    switch (sourceType) {
      case 'cpw': return 3; // Highest priority
      case 'cotrex': return 2;
      case 'osm': return 1; // Lowest priority
      default: return 0;
    }
  }

  /**
   * Calculate trail quality score
   */
  private calculateTrailQuality(trail: any): number {
    let score = 0;
    
    // Length quality (longer trails get higher scores)
    if (trail.length_km) score += Math.min(trail.length_km * 10, 50);
    
    // Elevation data quality
    if (trail.elevation_gain !== null) score += 10;
    if (trail.elevation_loss !== null) score += 10;
    if (trail.max_elevation !== null) score += 10;
    if (trail.min_elevation !== null) score += 10;
    
    // Metadata quality
    if (trail.trail_type) score += 5;
    if (trail.surface) score += 5;
    if (trail.difficulty) score += 5;
    
    // Source quality
    score += this.getSourcePriority(trail.source_type) * 10;
    
    return score;
  }

  /**
   * Calculate merge confidence score
   */
  private calculateMergeConfidence(group: any[]): number {
    if (group.length === 1) return 1.0;
    
    let confidence = 0.5; // Base confidence
    
    // Higher confidence for more similar trails
    const avgNameSimilarity = this.calculateAverageNameSimilarity(group);
    confidence += avgNameSimilarity * 0.3;
    
    // Higher confidence for trails from same source
    const sourceCounts = group.reduce((acc, trail) => {
      acc[trail.source_type] = (acc[trail.source_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const maxSourceCount = Math.max(...Object.values(sourceCounts));
    confidence += (maxSourceCount / group.length) * 0.2;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Calculate average name similarity in a group
   */
  private calculateAverageNameSimilarity(group: any[]): number {
    let totalSimilarity = 0;
    let comparisons = 0;
    
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        totalSimilarity += this.calculateNameSimilarity(group[i].name, group[j].name);
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  /**
   * Insert merged trail into merged table
   */
  private async insertMergedTrail(trail: any, sourceIds: number[], confidence: number): Promise<void> {
    await this.pgClient.query(`
      INSERT INTO ${this.stagingSchema}.trails_merged (
        name,
        trail_type,
        surface,
        difficulty,
        geometry,
        length_km,
        elevation_gain,
        elevation_loss,
        max_elevation,
        min_elevation,
        avg_elevation,
        region,
        bbox_min_lng,
        bbox_max_lng,
        bbox_min_lat,
        bbox_max_lat,
        source,
        source_tags,
        merged_from,
        merge_confidence
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
    `, [
      trail.name,
      trail.trail_type,
      trail.surface,
      trail.difficulty,
      trail.geometry,
      trail.length_km,
      trail.elevation_gain,
      trail.elevation_loss,
      trail.max_elevation,
      trail.min_elevation,
      trail.avg_elevation,
      trail.region,
      trail.bbox_min_lng,
      trail.bbox_max_lng,
      trail.bbox_min_lat,
      trail.bbox_max_lat,
      trail.source,
      trail.source_tags,
      JSON.stringify(sourceIds),
      confidence
    ]);
  }

  /**
   * Create indexes on merged table
   */
  private async createMergedIndexes(stagingSchema: string): Promise<void> {
    console.log('🔍 Creating indexes on merged trails table...');
    
    await this.pgClient.query(`
      CREATE INDEX idx_merged_trails_geometry ON ${stagingSchema}.trails_merged USING GIST (geometry);
      CREATE INDEX idx_merged_trails_name ON ${stagingSchema}.trails_merged (name);
      CREATE INDEX idx_merged_trails_source ON ${stagingSchema}.trails_merged (source);
      CREATE INDEX idx_merged_trails_confidence ON ${stagingSchema}.trails_merged (merge_confidence);
    `);
    
    console.log('✅ Merged trails indexes created');
  }

  /**
   * Generate merge summary
   */
  private async generateMergeSummary(stagingSchema: string): Promise<void> {
    console.log('📊 Generating merge summary...');
    
    const stats = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        COUNT(CASE WHEN merged_from::jsonb @> '[1]' THEN 1 END) as merged_trails,
        COUNT(CASE WHEN merge_confidence >= 0.8 THEN 1 END) as high_confidence,
        COUNT(CASE WHEN merge_confidence < 0.8 THEN 1 END) as low_confidence,
        AVG(merge_confidence) as avg_confidence,
        SUM(length_km) as total_length_km
      FROM ${stagingSchema}.trails_merged
    `);
    
    const summary = stats.rows[0];
    
    console.log('📊 Merge Summary:');
    console.log(`   🛤️ Total trails: ${summary.total_trails}`);
    console.log(`   🔗 Merged trails: ${summary.merged_trails}`);
    console.log(`   ✅ High confidence: ${summary.high_confidence}`);
    console.log(`   ⚠️ Low confidence: ${summary.low_confidence}`);
    console.log(`   📊 Average confidence: ${summary.avg_confidence?.toFixed(3)}`);
    console.log(`   📏 Total length: ${summary.total_length_km?.toFixed(1)} km`);
  }

  /**
   * Check if schema exists
   */
  private async checkSchemaExists(schemaName: string): Promise<boolean> {
    const result = await this.pgClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.schemata 
        WHERE schema_name = $1
      );
    `, [schemaName]);
    
    return result.rows[0].exists;
  }
}
