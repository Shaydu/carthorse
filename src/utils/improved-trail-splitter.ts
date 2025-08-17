import { Pool } from 'pg';

export interface ImprovedTrailSplitterConfig {
  toleranceMeters: number;
  verbose?: boolean;
  analyzeIntersections?: boolean;
}

export interface ImprovedTrailSplitResult {
  success: boolean;
  originalCount: number;
  splitCount: number;
  message: string;
  intersectionAnalysis?: IntersectionAnalysis[];
}

export interface IntersectionAnalysis {
  intersectionType: string;
  count: number;
  examples: string;
}

export class ImprovedTrailSplitter {
  constructor(
    private pgClient: Pool,
    private stagingSchema: string,
    private config: ImprovedTrailSplitterConfig
  ) {}

  /**
   * Main method to split trails using the improved approach
   */
  async splitTrails(): Promise<ImprovedTrailSplitResult> {
    console.log('🔧 Starting improved trail splitting...');
    console.log(`📊 Configuration:
   - Tolerance: ${this.config.toleranceMeters}m
   - Staging schema: ${this.stagingSchema}
   - Analyze intersections: ${this.config.analyzeIntersections || false}`);
    
    try {
      // Step 1: Analyze intersection types if requested
      let intersectionAnalysis: IntersectionAnalysis[] | undefined;
      if (this.config.analyzeIntersections) {
        console.log('🔍 Analyzing intersection types...');
        intersectionAnalysis = await this.analyzeIntersectionTypes();
        
        console.log('📊 Intersection Analysis Results:');
        intersectionAnalysis.forEach(analysis => {
          console.log(`   - ${analysis.intersectionType}: ${analysis.count} instances`);
          if (analysis.examples) {
            console.log(`     Examples: ${analysis.examples}`);
          }
        });
      }
      
      // Step 2: Run improved trail splitting
      console.log('🔧 Running improved trail splitting...');
      const result = await this.pgClient.query(`
        SELECT * FROM improved_trail_splitting($1, $2)
      `, [this.stagingSchema, this.config.toleranceMeters]);
      
      const splitResult = result.rows[0];
      
      console.log('📊 Improved Trail Splitting Results:');
      console.log(`   - Success: ${splitResult.success}`);
      console.log(`   - Original count: ${splitResult.original_count}`);
      console.log(`   - Split count: ${splitResult.split_count}`);
      console.log(`   - Message: ${splitResult.message}`);
      
      return {
        success: splitResult.success,
        originalCount: splitResult.original_count,
        splitCount: splitResult.split_count,
        message: splitResult.message,
        intersectionAnalysis
      };
      
    } catch (error) {
      console.error('❌ Improved trail splitting failed:', error);
      return {
        success: false,
        originalCount: 0,
        splitCount: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
        intersectionAnalysis: undefined
      };
    }
  }

  /**
   * Analyze intersection types in the current trail set
   */
  private async analyzeIntersectionTypes(): Promise<IntersectionAnalysis[]> {
    const result = await this.pgClient.query(`
      SELECT * FROM analyze_intersection_types($1, $2)
    `, [this.stagingSchema, this.config.toleranceMeters]);
    
    return result.rows.map(row => ({
      intersectionType: row.intersection_type,
      count: row.count,
      examples: row.examples
    }));
  }

  /**
   * Test the improved splitting with specific trails
   */
  async testSplitting(trailNames?: string[]): Promise<ImprovedTrailSplitResult> {
    console.log('🧪 Testing improved trail splitting...');
    
    try {
      const result = await this.pgClient.query(`
        SELECT * FROM test_improved_splitting($1, $2, $3)
      `, [this.stagingSchema, trailNames, this.config.toleranceMeters]);
      
      const testResult = result.rows[0];
      
      console.log('📊 Test Results:');
      console.log(`   - Test name: ${testResult.test_name}`);
      console.log(`   - Original count: ${testResult.original_count}`);
      console.log(`   - Split count: ${testResult.split_count}`);
      console.log(`   - Success: ${testResult.success}`);
      console.log(`   - Details: ${testResult.details}`);
      
      return {
        success: testResult.success,
        originalCount: testResult.original_count,
        splitCount: testResult.split_count,
        message: testResult.details
      };
      
    } catch (error) {
      console.error('❌ Test failed:', error);
      return {
        success: false,
        originalCount: 0,
        splitCount: 0,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get detailed information about split segments
   */
  async getSplitSegmentDetails(): Promise<any[]> {
    const result = await this.pgClient.query(`
      SELECT 
        app_uuid,
        original_trail_uuid,
        name,
        region,
        length_km,
        ST_Length(geometry::geography) as geom_length_meters,
        ST_NDims(geometry) as dimensions,
        ST_AsText(ST_StartPoint(geometry)) as start_point,
        ST_AsText(ST_EndPoint(geometry)) as end_point,
        ST_NumPoints(geometry) as num_points
      FROM ${this.stagingSchema}.trails
      ORDER BY original_trail_uuid, length_km DESC
    `);
    
    return result.rows;
  }

  /**
   * Validate that splitting was successful
   */
  async validateSplitting(): Promise<{
    valid: boolean;
    issues: string[];
    segmentCount: number;
    validGeometryCount: number;
    threeDimensionalCount: number;
  }> {
    const issues: string[] = [];
    
    // Check total segment count
    const segmentCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails
    `);
    const count = parseInt(segmentCount.rows[0].count);
    
    // Check valid geometry count
    const validGeometryCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails 
      WHERE geometry IS NOT NULL AND ST_IsValid(geometry)
    `);
    const validCount = parseInt(validGeometryCount.rows[0].count);
    
    // Check 3D geometry count
    const threeDimensionalCount = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails 
      WHERE ST_NDims(geometry) = 3
    `);
    const threeDCount = parseInt(threeDimensionalCount.rows[0].count);
    
    // Validate results
    if (count === 0) {
      issues.push('No trails found after splitting');
    }
    
    if (validCount < count) {
      issues.push(`${count - validCount} trails have invalid geometry`);
    }
    
    if (threeDCount < count) {
      issues.push(`${count - threeDCount} trails are not 3D`);
    }
    
    // Check for very short segments
    const shortSegments = await this.pgClient.query(`
      SELECT COUNT(*) as count FROM ${this.stagingSchema}.trails 
      WHERE ST_Length(geometry::geography) < 5
    `);
    const shortCount = parseInt(shortSegments.rows[0].count);
    
    if (shortCount > 0) {
      issues.push(`${shortCount} segments are shorter than 5 meters`);
    }
    
    return {
      valid: issues.length === 0,
      issues,
      segmentCount: count,
      validGeometryCount: validCount,
      threeDimensionalCount: threeDCount
    };
  }
}
