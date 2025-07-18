import { Client } from 'pg';
import chalk from 'chalk';

export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  summary: ValidationSummary;
}

export interface ValidationIssue {
  type: 'error' | 'warning' | 'info';
  message: string;
  count?: number;
  details?: any;
}

export interface ValidationSummary {
  totalTrails: number;
  validTrails: number;
  invalidTrails: number;
  missingElevation: number;
  missingGeometry: number;
  invalidGeometry: number;
  not3DGeometry: number;
  zeroElevation: number;
}

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
   * Comprehensive validation for a specific region
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
      zeroElevation: 0
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