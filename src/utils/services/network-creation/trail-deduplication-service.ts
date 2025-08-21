import { Pool, PoolClient } from 'pg';

export interface DuplicateTrailGroup {
  groupId: string;
  trails: Array<{
    id: string;
    app_uuid: string;
    name: string;
    length_km: number;
    geometry: any;
  }>;
  representativeTrail: {
    id: string;
    app_uuid: string;
    name: string;
    length_km: number;
  };
}

export class TrailDeduplicationService {
  constructor(
    private pgClient: Pool | PoolClient,
    private stagingSchema: string
  ) {}

  /**
   * Find and remove duplicate trails while preserving the best representative
   */
  async deduplicateTrails(): Promise<number> {
    console.log('🔄 Deduplicating trails...');
    
    // Step 1: Find duplicate groups based on geometric similarity
    const duplicateGroups = await this.findDuplicateGroups();
    console.log(`   📊 Found ${duplicateGroups.length} groups of duplicate trails`);
    
    if (duplicateGroups.length === 0) {
      console.log('   ✅ No duplicates found');
      return 0;
    }
    
    // Step 2: Remove duplicates, keeping the best representative
    let totalRemoved = 0;
    for (const group of duplicateGroups) {
      const removed = await this.removeDuplicateGroup(group);
      totalRemoved += removed;
    }
    
    console.log(`   🗑️ Removed ${totalRemoved} duplicate trails`);
    return totalRemoved;
  }

  /**
   * Find groups of duplicate trails based on geometric similarity
   */
  private async findDuplicateGroups(): Promise<DuplicateTrailGroup[]> {
    const result = await this.pgClient.query(`
      WITH trail_similarity AS (
        SELECT 
          t1.id as trail1_id,
          t1.app_uuid as trail1_uuid,
          t1.name as trail1_name,
          t1.length_km as trail1_length,
          t1.geometry as trail1_geometry,
          t2.id as trail2_id,
          t2.app_uuid as trail2_uuid,
          t2.name as trail2_name,
          t2.length_km as trail2_length,
          t2.geometry as trail2_geometry,
          CASE 
            WHEN LEAST(ST_Area(t1.geometry), ST_Area(t2.geometry)) > 0 
            THEN ST_Area(ST_Intersection(t1.geometry, t2.geometry)) / LEAST(ST_Area(t1.geometry), ST_Area(t2.geometry))
            ELSE 0
          END as overlap_ratio,
          ST_Distance(t1.geometry, t2.geometry) as distance_meters
        FROM ${this.stagingSchema}.trails t1
        JOIN ${this.stagingSchema}.trails t2 ON 
          t1.id < t2.id
          AND ST_DWithin(t1.geometry, t2.geometry, 0.001) -- Within ~100m
          AND ST_Length(t1.geometry::geography) > 10 -- Minimum 10m length
          AND ST_Length(t2.geometry::geography) > 10
      ),
      duplicate_pairs AS (
        SELECT *
        FROM trail_similarity
        WHERE (overlap_ratio > 0.8 -- 80% overlap threshold
           OR (distance_meters < 5 AND overlap_ratio > 0.5)) -- Very close with some overlap
          AND NOT (
            -- Exclude containment relationships - don't deduplicate if one trail is contained within another
            ST_Contains(trail1_geometry, trail2_geometry) 
            OR ST_Contains(trail2_geometry, trail1_geometry)
          )
      ),
      trail_groups AS (
        SELECT 
          trail1_id, trail1_uuid, trail1_name, trail1_length,
          trail2_id, trail2_uuid, trail2_name, trail2_length,
          overlap_ratio,
          -- Create a consistent group ID
          LEAST(trail1_id, trail2_id) as group_id
        FROM duplicate_pairs
      ),
      grouped_trails AS (
        SELECT 
          group_id,
          ARRAY_AGG(DISTINCT trail1_id) || ARRAY_AGG(DISTINCT trail2_id) as all_trail_ids,
          ARRAY_AGG(DISTINCT trail1_uuid) || ARRAY_AGG(DISTINCT trail2_uuid) as all_trail_uuids,
          ARRAY_AGG(DISTINCT trail1_name) || ARRAY_AGG(DISTINCT trail2_name) as all_trail_names,
          ARRAY_AGG(DISTINCT trail1_length) || ARRAY_AGG(DISTINCT trail2_length) as all_trail_lengths,
          MAX(overlap_ratio) as max_overlap
        FROM trail_groups
        GROUP BY group_id
      )
      SELECT 
        group_id,
        all_trail_ids,
        all_trail_uuids,
        all_trail_names,
        all_trail_lengths,
        max_overlap
      FROM grouped_trails
      ORDER BY max_overlap DESC
    `);

    const groups: DuplicateTrailGroup[] = [];
    
    for (const row of result.rows) {
      // Get full trail details for each group
      const trailDetails = await this.pgClient.query(`
        SELECT 
          id,
          app_uuid,
          name,
          length_km,
          ST_AsGeoJSON(geometry) as geometry
        FROM ${this.stagingSchema}.trails
        WHERE id = ANY($1)
        ORDER BY length_km DESC, name ASC
      `, [row.all_trail_ids]);

      if (trailDetails.rows.length > 1) { // Only groups with actual duplicates
        const trails = trailDetails.rows.map(t => ({
          id: t.id,
          app_uuid: t.app_uuid,
          name: t.name,
          length_km: t.length_km,
          geometry: JSON.parse(t.geometry)
        }));

        // Select the best representative (longest, then alphabetically by name)
        const representativeTrail = trails[0];

        groups.push({
          groupId: row.group_id,
          trails,
          representativeTrail
        });
      }
    }

    return groups;
  }

  /**
   * Remove duplicate trails from a group, keeping the representative
   */
  private async removeDuplicateGroup(group: DuplicateTrailGroup): Promise<number> {
    const duplicateIds = group.trails
      .filter(t => t.id !== group.representativeTrail.id)
      .map(t => t.id);

    if (duplicateIds.length === 0) {
      return 0;
    }

    console.log(`   🔄 Group ${group.groupId}: Keeping "${group.representativeTrail.name}" (${group.representativeTrail.length_km.toFixed(3)}km), removing ${duplicateIds.length} duplicates`);

    const result = await this.pgClient.query(`
      DELETE FROM ${this.stagingSchema}.trails
      WHERE id = ANY($1)
    `, [duplicateIds]);

    return result.rowCount || 0;
  }

  /**
   * Get statistics about the current trail set
   */
  async getTrailStats(): Promise<{
    totalTrails: number;
    totalLength: number;
    averageLength: number;
    shortestTrail: number;
    longestTrail: number;
  }> {
    const result = await this.pgClient.query(`
      SELECT 
        COUNT(*) as total_trails,
        SUM(length_km) as total_length,
        AVG(length_km) as average_length,
        MIN(length_km) as shortest_trail,
        MAX(length_km) as longest_trail
      FROM ${this.stagingSchema}.trails
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);

    const row = result.rows[0];
    return {
      totalTrails: parseInt(row.total_trails),
      totalLength: parseFloat(row.total_length) || 0,
      averageLength: parseFloat(row.average_length) || 0,
      shortestTrail: parseFloat(row.shortest_trail) || 0,
      longestTrail: parseFloat(row.longest_trail) || 0
    };
  }
}
