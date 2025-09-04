/**
 * Validation utilities for trail splitting operations
 * Ensures that split segments preserve the original trail geometry and length
 */

export interface TrailSplitValidationResult {
  isValid: boolean;
  originalLength: number;
  splitLengths: number[];
  totalSplitLength: number;
  lengthDifference: number;
  lengthDifferencePercentage: number;
  errorMessage?: string;
}

export class TrailSplitValidation {
  private readonly toleranceMeters: number;
  private readonly tolerancePercentage: number;

  constructor(toleranceMeters: number = 1.0, tolerancePercentage: number = 0.1) {
    this.toleranceMeters = toleranceMeters;
    this.tolerancePercentage = tolerancePercentage;
  }

  /**
   * Validate that split segments preserve the original trail length
   * @param originalLength Original trail length in meters
   * @param splitLengths Array of split segment lengths in meters
   * @param trailName Name of the trail for error reporting
   * @returns Validation result with detailed metrics
   */
  validateSplitLengths(
    originalLength: number,
    splitLengths: number[],
    trailName: string
  ): TrailSplitValidationResult {
    const totalSplitLength = splitLengths.reduce((sum, length) => sum + length, 0);
    const lengthDifference = Math.abs(originalLength - totalSplitLength);
    const lengthDifferencePercentage = (lengthDifference / originalLength) * 100;

    const isValid = this.isLengthValid(lengthDifference, lengthDifferencePercentage);

    const result: TrailSplitValidationResult = {
      isValid,
      originalLength,
      splitLengths,
      totalSplitLength,
      lengthDifference,
      lengthDifferencePercentage
    };

    if (!isValid) {
      result.errorMessage = this.generateErrorMessage(
        trailName,
        originalLength,
        totalSplitLength,
        lengthDifference,
        lengthDifferencePercentage,
        splitLengths
      );
    }

    return result;
  }

  /**
   * Check if the length difference is within acceptable tolerance
   */
  private isLengthValid(lengthDifference: number, lengthDifferencePercentage: number): boolean {
    return lengthDifference <= this.toleranceMeters && 
           lengthDifferencePercentage <= this.tolerancePercentage;
  }

  /**
   * Generate detailed error message for validation failures
   */
  private generateErrorMessage(
    trailName: string,
    originalLength: number,
    totalSplitLength: number,
    lengthDifference: number,
    lengthDifferencePercentage: number,
    splitLengths: number[]
  ): string {
    const splitDetails = splitLengths.map((length, index) => 
      `  Segment ${index + 1}: ${(length / 1000).toFixed(3)}km`
    ).join('\n');

    let issueDescription = '';
    if (lengthDifference > 0) {
      if (totalSplitLength < originalLength) {
        issueDescription = 'GEOMETRY LOSS: Split segments are shorter than original trail - some trail geometry was lost during splitting.';
      } else {
        issueDescription = 'GEOMETRY EXPANSION: Split segments are longer than original trail - this may indicate duplicate geometry or incorrect splitting.';
      }
    } else {
      issueDescription = 'LENGTH MISMATCH: Split segments do not preserve the original trail length within tolerance.';
    }

    return `TRAIL SPLIT VALIDATION FAILED for "${trailName}":
    
${issueDescription}

Original trail length: ${(originalLength / 1000).toFixed(3)}km
Total split length: ${(totalSplitLength / 1000).toFixed(3)}km
Length difference: ${(lengthDifference / 1000).toFixed(3)}km (${lengthDifferencePercentage.toFixed(2)}%)

Split segments:
${splitDetails}

Tolerance: ±${this.toleranceMeters}m (±${this.tolerancePercentage}%)

This indicates the sum of split trail lengths does not equal the original trail length within acceptable tolerance.`;
  }

  /**
   * Validate split segments and throw an error if validation fails
   * @param originalLength Original trail length in meters
   * @param splitLengths Array of split segment lengths in meters
   * @param trailName Name of the trail for error reporting
   * @throws Error if validation fails
   */
  validateAndThrow(
    originalLength: number,
    splitLengths: number[],
    trailName: string
  ): void {
    const result = this.validateSplitLengths(originalLength, splitLengths, trailName);
    
    if (!result.isValid) {
      throw new Error(result.errorMessage);
    }
  }

  /**
   * Validate split segments and log a warning if validation fails
   * @param originalLength Original trail length in meters
   * @param splitLengths Array of split segment lengths in meters
   * @param trailName Name of the trail for error reporting
   * @returns true if valid, false if invalid
   */
  validateAndWarn(
    originalLength: number,
    splitLengths: number[],
    trailName: string
  ): boolean {
    const result = this.validateSplitLengths(originalLength, splitLengths, trailName);
    
    if (!result.isValid) {
      console.warn(`⚠️ ${result.errorMessage}`);
      return false;
    }
    
    return true;
  }

  /**
   * Get validation statistics for multiple trail splits
   */
  getValidationStatistics(validationResults: TrailSplitValidationResult[]): {
    totalTrails: number;
    validTrails: number;
    invalidTrails: number;
    averageLengthDifference: number;
    maxLengthDifference: number;
    trailsWithIssues: string[];
  } {
    const validTrails = validationResults.filter(r => r.isValid).length;
    const invalidTrails = validationResults.filter(r => !r.isValid).length;
    const averageLengthDifference = validationResults.reduce((sum, r) => sum + r.lengthDifference, 0) / validationResults.length;
    const maxLengthDifference = Math.max(...validationResults.map(r => r.lengthDifference));
    const trailsWithIssues = validationResults.filter(r => !r.isValid).map(r => r.errorMessage?.split('"')[1] || 'Unknown');

    return {
      totalTrails: validationResults.length,
      validTrails,
      invalidTrails,
      averageLengthDifference,
      maxLengthDifference,
      trailsWithIssues
    };
  }
}

/**
 * Default validation instance with standard tolerances
 */
export const defaultTrailSplitValidation = new TrailSplitValidation(1.0, 0.1);

/**
 * Strict validation instance with tighter tolerances
 */
export const strictTrailSplitValidation = new TrailSplitValidation(0.5, 0.05);

/**
 * Lenient validation instance with looser tolerances
 */
export const lenientTrailSplitValidation = new TrailSplitValidation(2.0, 0.2);
