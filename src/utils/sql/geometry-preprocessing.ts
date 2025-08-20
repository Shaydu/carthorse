import { Pool, Client } from 'pg';

export interface GeometryPreprocessingConfig {
  schemaName: string;
  tableName?: string; // defaults to 'trails'
  region?: string;
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  maxPasses?: number; // defaults to 5
  minLengthMeters?: number; // defaults to 0.0 (no minimum length)
  tolerance?: number; // defaults to 0.00001 for proximity checks
}

export interface GeometryPreprocessingResult {
  success: boolean;
  initialCount: number;
  finalCount: number;
  droppedCount: number;
  passes: number;
  errors: string[];
  summary: {
    invalidGeometries: number;
    nonSimpleGeometries: number;
    emptyGeometries: number;
    tooShortGeometries: number;
    duplicateGeometries: number;
    complexGeometries: number; // MultiLineString, GeometryCollection
  };
}

export class GeometryPreprocessor {
  private pgClient: Pool | Client;

  constructor(pgClient: Pool | Client) {
    this.pgClient = pgClient;
  }

  /**
   * Preprocess trail geometries to ensure they are simple, valid, and non-duplicated.
   * This function can be called repeatedly until no more changes occur.
   */
  async preprocessTrailGeometries(config: GeometryPreprocessingConfig): Promise<GeometryPreprocessingResult> {
    const {
      schemaName,
      tableName = 'trails',
      region,
      bbox,
      maxPasses = 5,
      minLengthMeters = 0.0,
      tolerance = 0.00001
    } = config;

    const result: GeometryPreprocessingResult = {
      success: false,
      initialCount: 0,
      finalCount: 0,
      droppedCount: 0,
      passes: 0,
      errors: [],
      summary: {
        invalidGeometries: 0,
        nonSimpleGeometries: 0,
        emptyGeometries: 0,
        tooShortGeometries: 0,
        duplicateGeometries: 0,
        complexGeometries: 0
      }
    };

    try {
      console.log(`🔧 Starting geometry preprocessing for ${schemaName}.${tableName}...`);
      
      // Get initial count
      const initialCountResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName}
      `);
      result.initialCount = parseInt(initialCountResult.rows[0].count);
      console.log(`📊 Initial geometry count: ${result.initialCount}`);

      let lastCount = result.initialCount;
      let pass = 0;

      while (pass < maxPasses) {
        pass++;
        console.log(`🔄 Pass ${pass}/${maxPasses}: Processing geometries...`);

        const passResult = await this.performGeometryCleanupPass(schemaName, tableName, region, bbox, minLengthMeters, tolerance);
        
        // Update summary
        result.summary.invalidGeometries += passResult.invalidGeometries;
        result.summary.nonSimpleGeometries += passResult.nonSimpleGeometries;
        result.summary.emptyGeometries += passResult.emptyGeometries;
        result.summary.tooShortGeometries += passResult.tooShortGeometries;
        result.summary.duplicateGeometries += passResult.duplicateGeometries;
        result.summary.complexGeometries += passResult.complexGeometries;

        // Get current count
        const currentCountResult = await this.pgClient.query(`
          SELECT COUNT(*) as count FROM ${schemaName}.${tableName}
        `);
        const currentCount = parseInt(currentCountResult.rows[0].count);

        console.log(`📊 Pass ${pass} results: ${currentCount} geometries remaining (dropped ${lastCount - currentCount})`);

        // Check if we've stabilized
        if (currentCount === lastCount) {
          console.log(`✅ Geometry preprocessing stabilized after ${pass} passes`);
          break;
        }

        lastCount = currentCount;
      }

      result.passes = pass;
      result.finalCount = lastCount;
      result.droppedCount = result.initialCount - result.finalCount;
      result.success = true;

      console.log(`✅ Geometry preprocessing completed:`);
      console.log(`   📊 Initial: ${result.initialCount} geometries`);
      console.log(`   📊 Final: ${result.finalCount} geometries`);
      console.log(`   📊 Dropped: ${result.droppedCount} geometries`);
      console.log(`   🔄 Passes: ${result.passes}`);
      console.log(`   📋 Summary:`, result.summary);

      return result;

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      console.error(`❌ Geometry preprocessing failed:`, error);
      return result;
    }
  }

  /**
   * Perform a single pass of geometry cleanup
   */
  private async performGeometryCleanupPass(
    schemaName: string,
    tableName: string,
    region?: string,
    bbox?: [number, number, number, number],
    minLengthMeters: number = 0.0,
    tolerance: number = 0.00001
  ): Promise<{
    invalidGeometries: number;
    nonSimpleGeometries: number;
    emptyGeometries: number;
    tooShortGeometries: number;
    duplicateGeometries: number;
    complexGeometries: number;
  }> {
    const result = {
      invalidGeometries: 0,
      nonSimpleGeometries: 0,
      emptyGeometries: 0,
      tooShortGeometries: 0,
      duplicateGeometries: 0,
      complexGeometries: 0
    };

    // Build WHERE clause for filtering
    let whereClause = 'WHERE geometry IS NOT NULL';
    if (region) {
      whereClause += ` AND region = '${region}'`;
    }
    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox;
      whereClause += ` AND ST_Intersects(geometry, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`;
    }

    // Step 1: Handle complex geometries (MultiLineString, GeometryCollection)
    console.log('   🔧 Step 1: Processing complex geometries...');
    const complexGeomsResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
      ${whereClause} AND ST_GeometryType(geometry) IN ('ST_MultiLineString', 'ST_GeometryCollection')
    `);
    result.complexGeometries = parseInt(complexGeomsResult.rows[0].count);

    if (result.complexGeometries > 0) {
      await this.pgClient.query(`
        UPDATE ${schemaName}.${tableName} 
        SET geometry = ST_LineMerge(ST_CollectionHomogenize(ST_MakeValid(geometry)))
        ${whereClause} AND ST_GeometryType(geometry) IN ('ST_MultiLineString', 'ST_GeometryCollection')
      `);
      console.log(`   ✅ Processed ${result.complexGeometries} complex geometries`);
    }

    // Step 2: Remove invalid geometries
    console.log('   🔧 Step 2: Removing invalid geometries...');
    const invalidGeomsResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
      ${whereClause} AND NOT ST_IsValid(geometry)
    `);
    result.invalidGeometries = parseInt(invalidGeomsResult.rows[0].count);

    if (result.invalidGeometries > 0) {
      await this.pgClient.query(`
        DELETE FROM ${schemaName}.${tableName} 
        ${whereClause} AND NOT ST_IsValid(geometry)
      `);
      console.log(`   ✅ Removed ${result.invalidGeometries} invalid geometries`);
    }

    // Step 3: Fix non-simple geometries by splitting at self-intersection points
    console.log('   🔧 Step 3: Fixing non-simple geometries...');
    const nonSimpleGeomsResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
      ${whereClause} AND NOT ST_IsSimple(geometry)
    `);
    result.nonSimpleGeometries = parseInt(nonSimpleGeomsResult.rows[0].count);

    if (result.nonSimpleGeometries > 0) {
      // Split non-simple geometries at self-intersection points
      await this.pgClient.query(`
        WITH split_geometries AS (
          SELECT 
            app_uuid,
            name,
            trail_type,
            surface,
            difficulty,
            elevation_gain,
            elevation_loss,
            max_elevation,
            min_elevation,
            avg_elevation,
            source,
            source_tags,
            osm_id,
            bbox_min_lng,
            bbox_max_lng,
            bbox_min_lat,
            bbox_max_lat,
            created_at,
            updated_at,
            dumped.geom as geometry,
            ROW_NUMBER() OVER (PARTITION BY app_uuid ORDER BY ST_Length(dumped.geom::geography) DESC) as segment_order
          FROM ${schemaName}.${tableName} t,
          LATERAL ST_Dump(ST_CollectionHomogenize(ST_Node(t.geometry))) as dumped
          WHERE ${whereClause.replace('WHERE ', '')} AND NOT ST_IsSimple(t.geometry)
            AND ST_GeometryType(dumped.geom) = 'ST_LineString'
            AND ST_Length(dumped.geom::geography) > 1.0  -- Minimum 1 meter
        )
        DELETE FROM ${schemaName}.${tableName} 
        WHERE app_uuid IN (
          SELECT DISTINCT app_uuid FROM ${schemaName}.${tableName} 
          WHERE ${whereClause.replace('WHERE ', '')} AND NOT ST_IsSimple(geometry)
        );
        
        INSERT INTO ${schemaName}.${tableName} (
          app_uuid, name, trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, source_tags, osm_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat,
          created_at, updated_at, geometry
        )
        SELECT 
          CASE 
            WHEN segment_order = 1 THEN app_uuid  -- Keep original UUID for first segment
            ELSE gen_random_uuid()  -- Generate new UUID for additional segments
          END as app_uuid,
          CASE 
            WHEN segment_order = 1 THEN name  -- Keep original name for first segment
            ELSE name || ' (Segment ' || segment_order || ')'  -- Add segment number for additional segments
          END as name,
          trail_type, surface, difficulty,
          elevation_gain, elevation_loss, max_elevation, min_elevation, avg_elevation,
          source, source_tags, osm_id,
          ST_XMin(geometry) as bbox_min_lng, ST_XMax(geometry) as bbox_max_lng,
          ST_YMin(geometry) as bbox_min_lat, ST_YMax(geometry) as bbox_max_lat,
          created_at, updated_at, geometry
        FROM split_geometries;
      `);
      console.log(`   ✅ Fixed ${result.nonSimpleGeometries} non-simple geometries by splitting at self-intersection points`);
    }

    // Step 4: Remove empty geometries
    console.log('   🔧 Step 4: Removing empty geometries...');
    const emptyGeomsResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
      ${whereClause} AND ST_IsEmpty(geometry)
    `);
    result.emptyGeometries = parseInt(emptyGeomsResult.rows[0].count);

    if (result.emptyGeometries > 0) {
      await this.pgClient.query(`
        DELETE FROM ${schemaName}.${tableName} 
        ${whereClause} AND ST_IsEmpty(geometry)
      `);
      console.log(`   ✅ Removed ${result.emptyGeometries} empty geometries`);
    }

    // Step 5: Remove geometries that are too short or single points
    if (minLengthMeters > 0) {
      console.log(`   🔧 Step 5: Removing geometries shorter than ${minLengthMeters}m...`);
      const minLengthDegrees = minLengthMeters / 111000.0; // Convert meters to degrees
      const tooShortGeomsResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
        ${whereClause} AND ST_Length(geometry) < $1
      `, [minLengthDegrees]);
      result.tooShortGeometries = parseInt(tooShortGeomsResult.rows[0].count);

      if (result.tooShortGeometries > 0) {
        await this.pgClient.query(`
          DELETE FROM ${schemaName}.${tableName} 
          ${whereClause} AND ST_Length(geometry) < $1
        `, [minLengthDegrees]);
        console.log(`   ✅ Removed ${result.tooShortGeometries} geometries shorter than ${minLengthMeters}m`);
      }
    } else {
      console.log('   🔧 Step 5: Removing single-point geometries...');
      const singlePointGeomsResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
        ${whereClause} AND ST_NPoints(geometry) < 2
      `);
      result.tooShortGeometries = parseInt(singlePointGeomsResult.rows[0].count);

      if (result.tooShortGeometries > 0) {
        await this.pgClient.query(`
          DELETE FROM ${schemaName}.${tableName} 
          ${whereClause} AND ST_NPoints(geometry) < 2
        `);
        console.log(`   ✅ Removed ${result.tooShortGeometries} single-point geometries`);
      }
    }

    // Step 6: Remove geometries that are not LineString
    console.log('   🔧 Step 6: Removing non-LineString geometries...');
    await this.pgClient.query(`
      DELETE FROM ${schemaName}.${tableName} 
      ${whereClause} AND ST_GeometryType(geometry) != 'ST_LineString'
    `);

    // Step 7: Remove exact duplicates
    console.log('   🔧 Step 7: Removing duplicate geometries...');
    const duplicatesResult = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM (
        SELECT geometry, COUNT(*) as cnt 
        FROM ${schemaName}.${tableName} 
        ${whereClause}
        GROUP BY geometry 
        HAVING COUNT(*) > 1
      ) dupes
    `);
    result.duplicateGeometries = parseInt(duplicatesResult.rows[0].count);

    if (result.duplicateGeometries > 0) {
      await this.pgClient.query(`
        DELETE FROM ${schemaName}.${tableName} a
        USING ${schemaName}.${tableName} b
        WHERE a.ctid < b.ctid
          AND ST_Equals(a.geometry, b.geometry)
          ${region ? `AND a.region = '${region}' AND b.region = '${region}'` : ''}
      `);
      console.log(`   ✅ Removed ${result.duplicateGeometries} duplicate geometries`);
    }

    return result;
  }

  /**
   * Validate that all geometries in a table are clean and ready for routing
   */
  async validateGeometryCleanliness(schemaName: string, tableName: string = 'trails'): Promise<{
    isValid: boolean;
    issues: string[];
    summary: {
      total: number;
      valid: number;
      simple: number;
      nonEmpty: number;
      lineStrings: number;
      reasonableLength: number;
    };
  }> {
    const result = {
      isValid: true,
      issues: [] as string[],
      summary: {
        total: 0,
        valid: 0,
        simple: 0,
        nonEmpty: 0,
        lineStrings: 0,
        reasonableLength: 0
      }
    };

    try {
      // Get overall counts
      const totalResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName} WHERE geometry IS NOT NULL
      `);
      result.summary.total = parseInt(totalResult.rows[0].count);

      // Check each validation criterion
      const validResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
        WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
      `);
      result.summary.valid = parseInt(validResult.rows[0].count);

      const simpleResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
        WHERE geometry IS NOT NULL AND ST_IsSimple(geometry)
      `);
      result.summary.simple = parseInt(simpleResult.rows[0].count);

      const nonEmptyResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
        WHERE geometry IS NOT NULL AND NOT ST_IsEmpty(geometry)
      `);
      result.summary.nonEmpty = parseInt(nonEmptyResult.rows[0].count);

      const lineStringsResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
        WHERE geometry IS NOT NULL AND ST_GeometryType(geometry) = 'ST_LineString'
      `);
      result.summary.lineStrings = parseInt(lineStringsResult.rows[0].count);

      const reasonableLengthResult = await this.pgClient.query(`
        SELECT COUNT(*) as count FROM ${schemaName}.${tableName} 
        WHERE geometry IS NOT NULL AND ST_Length(geometry) >= 1.0
      `);
      result.summary.reasonableLength = parseInt(reasonableLengthResult.rows[0].count);

      // Check for issues
      if (result.summary.valid < result.summary.total) {
        result.issues.push(`${result.summary.total - result.summary.valid} invalid geometries found`);
        result.isValid = false;
      }

      if (result.summary.simple < result.summary.total) {
        result.issues.push(`${result.summary.total - result.summary.simple} non-simple geometries found`);
        result.isValid = false;
      }

      if (result.summary.nonEmpty < result.summary.total) {
        result.issues.push(`${result.summary.total - result.summary.nonEmpty} empty geometries found`);
        result.isValid = false;
      }

      if (result.summary.lineStrings < result.summary.total) {
        result.issues.push(`${result.summary.total - result.summary.lineStrings} non-LineString geometries found`);
        result.isValid = false;
      }

      if (result.summary.reasonableLength < result.summary.total) {
        result.issues.push(`${result.summary.total - result.summary.reasonableLength} geometries that are too short found`);
        result.isValid = false;
      }

      return result;

    } catch (error) {
      result.issues.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
      result.isValid = false;
      return result;
    }
  }
}

/**
 * Create a GeometryPreprocessor instance
 */
export function createGeometryPreprocessor(pgClient: Pool | Client): GeometryPreprocessor {
  return new GeometryPreprocessor(pgClient);
} 