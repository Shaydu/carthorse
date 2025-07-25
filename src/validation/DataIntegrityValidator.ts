import { Client } from 'pg';
import chalk from 'chalk';
import type { ValidationResult, ValidationIssue, ValidationSummary } from '../types';

export class DataIntegrityValidator {
  private client: Client;

  constructor(databaseConfig: any) {
    this.client = new Client(databaseConfig);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  /**
   * Comprehensive validation for a specific region with enhanced spatial checks
   */
  async validateRegion(region: string): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    let summary: ValidationSummary = {
      totalTrails: 0,
      validTrails: 0,
      invalidTrails: 0,
      missingElevation: 0,
      missingGeometry: 0,
      invalidGeometry: 0,
      not3DGeometry: 0,
      zeroElevation: 0,
      spatialContainmentIssues: 0
    };

    try {
      // 1. Check total trails in region
      const totalResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE region = $1 OR name ILIKE $2
      `, [region, `%${region}%`]);
      summary.totalTrails = parseInt(totalResult.rows[0].count);

      // 2. Check for missing geometry
      const missingGeometryResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE (region = $1 OR name ILIKE $2) AND geometry IS NULL
      `, [region, `%${region}%`]);
      summary.missingGeometry = parseInt(missingGeometryResult.rows[0].count);

      if (summary.missingGeometry > 0) {
        issues.push({
          type: 'error',
          message: `${summary.missingGeometry} trails missing geometry`,
          count: summary.missingGeometry
        });
      }

      // 3. Check for non-3D geometries
      const not3DResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE (region = $1 OR name ILIKE $2) 
          AND (ST_GeometryType(geometry) != 'ST_LineString' OR ST_NDims(geometry) != 3)
      `, [region, `%${region}%`]);
      summary.not3DGeometry = parseInt(not3DResult.rows[0].count);

      if (summary.not3DGeometry > 0) {
        issues.push({
          type: 'error',
          message: `${summary.not3DGeometry} trails are not 3D LINESTRINGs`,
          count: summary.not3DGeometry
        });
      }

      // 4. Check for trails with all Z=0 (missing elevation)
      const zeroZResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE (region = $1 OR name ILIKE $2)
          AND ST_NDims(geometry) = 3
          AND NOT EXISTS (
            SELECT 1 FROM (
              SELECT (ST_DumpPoints(geometry)).geom as pt
            ) AS pts
            WHERE ST_Z(pt) != 0
          )
      `, [region, `%${region}%`]);
      summary.zeroElevation = parseInt(zeroZResult.rows[0].count);

      if (summary.zeroElevation > 0) {
        issues.push({
          type: 'warning',
          message: `${summary.zeroElevation} trails have all Z=0 (missing elevation data)`,
          count: summary.zeroElevation
        });
      }

      // 5. Check for missing elevation data
      const missingElevationResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE (region = $1 OR name ILIKE $2)
          AND (elevation_gain IS NULL OR elevation_loss IS NULL 
               OR max_elevation IS NULL OR min_elevation IS NULL OR avg_elevation IS NULL)
      `, [region, `%${region}%`]);
      summary.missingElevation = parseInt(missingElevationResult.rows[0].count);

      if (summary.missingElevation > 0) {
        issues.push({
          type: 'error',
          message: `${summary.missingElevation} trails missing elevation data`,
          count: summary.missingElevation
        });
      }

      // 6. Check for invalid geometry (parse errors)
      try {
        const invalidGeometryResult = await this.client.query(`
          SELECT COUNT(*) as count FROM trails 
          WHERE (region = $1 OR name ILIKE $2) AND NOT ST_IsValid(geometry)
        `, [region, `%${region}%`]);
        summary.invalidGeometry = parseInt(invalidGeometryResult.rows[0].count);

        if (summary.invalidGeometry > 0) {
          issues.push({
            type: 'error',
            message: `${summary.invalidGeometry} trails have invalid geometry`,
            count: summary.invalidGeometry
          });
        }
      } catch (error) {
        issues.push({
          type: 'error',
          message: 'Geometry validation query failed - possible corrupt data',
          details: error
        });
      }

      // Calculate valid trails
      summary.validTrails = summary.totalTrails - summary.missingGeometry - summary.not3DGeometry - summary.invalidGeometry;
      summary.invalidTrails = summary.totalTrails - summary.validTrails;

    } catch (error) {
      issues.push({
        type: 'error',
        message: 'Database connection or query failed',
        details: error
      });
    }

    const passed = issues.filter(issue => issue.type === 'error').length === 0;

    return {
      passed,
      issues,
      summary
    };
  }

  /**
   * Enhanced spatial validation using PostGIS functions
   */
  async validateSpatialIntegrity(region: string): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    let summary: ValidationSummary = {
      totalTrails: 0,
      validTrails: 0,
      invalidTrails: 0,
      missingElevation: 0,
      missingGeometry: 0,
      invalidGeometry: 0,
      not3DGeometry: 0,
      zeroElevation: 0,
      spatialContainmentIssues: 0
    };

    try {
      // 1. Validate all geometries are valid using ST_IsValid()
      const invalidGeometryResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE (region = $1 OR name ILIKE $2) AND geometry IS NOT NULL AND NOT ST_IsValid(geometry)
      `, [region, `%${region}%`]);
      
      const invalidCount = parseInt(invalidGeometryResult.rows[0].count);
      if (invalidCount > 0) {
        issues.push({
          type: 'error',
          message: `${invalidCount} trails have invalid geometries (ST_IsValid failed)`,
          count: invalidCount
        });
      }

      // 2. Ensure coordinate system consistency (SRID 4326)
      const wrongSridResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE (region = $1 OR name ILIKE $2) AND geometry IS NOT NULL AND ST_SRID(geometry) != 4326
      `, [region, `%${region}%`]);
      
      const wrongSridCount = parseInt(wrongSridResult.rows[0].count);
      if (wrongSridCount > 0) {
        issues.push({
          type: 'error',
          message: `${wrongSridCount} trails have wrong coordinate system (not SRID 4326)`,
          count: wrongSridCount
        });
      }

      // 3. Validate spatial containment using ST_Within
      // Spatial containment validation (fix aggregate in WHERE)
      const spatialContainmentResult = await this.client.query(`
        WITH bbox AS (
          SELECT 
            MIN(bbox_min_lng) AS min_lng,
            MIN(bbox_min_lat) AS min_lat,
            MAX(bbox_max_lng) AS max_lng,
            MAX(bbox_max_lat) AS max_lat
          FROM trails
          WHERE region = $1
        )
        SELECT COUNT(*) as count FROM trails t, bbox
        WHERE t.region = $1 AND t.geometry IS NOT NULL AND NOT ST_Within(
          t.geometry, 
          ST_MakeEnvelope(bbox.min_lng, bbox.min_lat, bbox.max_lng, bbox.max_lat, 4326)
        )
      `, [region]);
      summary.spatialContainmentIssues = parseInt(spatialContainmentResult.rows[0].count);
      if (summary.spatialContainmentIssues > 0) {
        issues.push({
          type: 'warning',
          message: `${summary.spatialContainmentIssues} trails outside region bbox`,
          count: summary.spatialContainmentIssues
        });
      }

      // 4. Check for spatial proximity issues using ST_DWithin
      const proximityResult = await this.client.query(`
        SELECT COUNT(*) as count FROM (
          SELECT t1.id
          FROM trails t1
          JOIN trails t2 ON (
            t1.id < t2.id AND 
            (t1.region = $1 OR t1.name ILIKE $2) AND
            (t2.region = $1 OR t2.name ILIKE $2) AND
            t1.geometry IS NOT NULL AND t2.geometry IS NOT NULL AND
            ST_DWithin(t1.geometry, t2.geometry, 0.001) AND
            NOT ST_Intersects(t1.geometry, t2.geometry)
          )
        ) proximity_issues
      `, [region, `%${region}%`]);
      
      const proximityCount = parseInt(proximityResult.rows[0].count);
      if (proximityCount > 0) {
        issues.push({
          type: 'warning',
          message: `${proximityCount} trail pairs are very close but don't intersect`,
          count: proximityCount
        });
      }

      // 5. Validate elevation data consistency using spatial functions
      const elevationResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE (region = $1 OR name ILIKE $2) AND 
              geometry IS NOT NULL AND ST_NDims(geometry) = 3 AND
              (elevation_gain IS NULL OR elevation_loss IS NULL OR 
               max_elevation IS NULL OR min_elevation IS NULL)
      `, [region, `%${region}%`]);
      
      const elevationCount = parseInt(elevationResult.rows[0].count);
      if (elevationCount > 0) {
        issues.push({
          type: 'warning',
          message: `${elevationCount} 3D trails have inconsistent elevation metadata`,
          count: elevationCount
        });
      }

      // Calculate summary
      const totalResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE region = $1 OR name ILIKE $2
      `, [region, `%${region}%`]);
      summary.totalTrails = parseInt(totalResult.rows[0].count);

      const validResult = await this.client.query(`
        SELECT COUNT(*) as count FROM trails 
        WHERE (region = $1 OR name ILIKE $2) AND 
              geometry IS NOT NULL AND ST_IsValid(geometry) AND ST_SRID(geometry) = 4326
      `, [region, `%${region}%`]);
      summary.validTrails = parseInt(validResult.rows[0].count);

      summary.invalidTrails = summary.totalTrails - summary.validTrails;

    } catch (error) {
      issues.push({
        type: 'error',
        message: 'Spatial validation query failed',
        details: error
      });
    }

    const passed = issues.filter(issue => issue.type === 'error').length === 0;

    return {
      passed,
      issues,
      summary
    };
  }

  /**
   * Print validation results in a formatted way
   */
  printResults(result: ValidationResult, region: string): void {
    console.log(chalk.blue(`\n🔍 CARTHORSE Region Readiness Report for ${region}`));
    console.log(chalk.blue('=' .repeat(60)));

    // Summary
    console.log(chalk.white(`\n📊 Summary:`));
    console.log(`   Total trails: ${result.summary.totalTrails}`);
    console.log(`   Valid trails: ${result.summary.validTrails}`);
    console.log(`   Invalid trails: ${result.summary.invalidTrails}`);

    if (result.summary.missingElevation > 0) {
      console.log(`   Missing elevation: ${result.summary.missingElevation}`);
    }
    if (result.summary.missingGeometry > 0) {
      console.log(`   Missing geometry: ${result.summary.missingGeometry}`);
    }
    if (result.summary.not3DGeometry > 0) {
      console.log(`   Not 3D geometry: ${result.summary.not3DGeometry}`);
    }
    if (result.summary.zeroElevation > 0) {
      console.log(`   Zero elevation: ${result.summary.zeroElevation}`);
    }
    if (result.summary.spatialContainmentIssues > 0) {
      console.log(`   Spatial containment issues: ${result.summary.spatialContainmentIssues}`);
    }

    // Issues
    if (result.issues.length > 0) {
      console.log(chalk.white(`\n⚠️  Issues Found:`));
      result.issues.forEach(issue => {
        const icon = issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️';
        const color = issue.type === 'error' ? chalk.red : issue.type === 'warning' ? chalk.yellow : chalk.blue;
        console.log(`   ${icon} ${color(issue.message)}`);
      });
    } else {
      console.log(chalk.green(`\n✅ No issues found!`));
    }

    // Final status
    if (result.passed) {
      console.log(chalk.green(`\n🎉 Region ${region} is ready for export!`));
    } else {
      console.log(chalk.red(`\n❌ Region ${region} has critical issues that must be fixed before export.`));
    }
  }
} 