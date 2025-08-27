import { Pool } from 'pg';

export interface RequiredFunction {
  name: string;
  description: string;
  critical: boolean; // If true, export will fail if missing
  expectedSignature?: string; // Optional: check function signature
  expectedReturnType?: string; // Optional: check return type
}

export interface FunctionValidationResult {
  functionName: string;
  exists: boolean;
  signature?: string;
  returnType?: string;
  error?: string;
}

export interface DatabaseValidationResult {
  isValid: boolean;
  missingFunctions: string[];
  criticalMissingFunctions: string[];
  validationResults: FunctionValidationResult[];
  errors: string[];
}

export class DatabaseFunctionValidator {
  private pgClient: Pool;

  constructor(pgClient: Pool) {
    this.pgClient = pgClient;
  }

  /**
   * List of all required functions for route generation
   */
  private getRequiredFunctions(): RequiredFunction[] {
    return [
      // Core route generation functions
      {
        name: 'calculate_route_similarity_score',
        description: 'Calculates similarity score between actual and target route metrics',
        critical: true,
        expectedReturnType: 'double precision'
      },
      {
        name: 'find_routes_recursive_configurable',
        description: 'Core recursive route finding function',
        critical: true
      },
      {
        name: 'find_routes_recursive_configurable_uuid',
        description: 'UUID-based recursive route finding function',
        critical: true
      },
      {
        name: 'find_routes_recursive_pgrouting',
        description: 'pgRouting-based route finding function',
        critical: false
      },
      {
        name: 'find_routes_recursive_pgrouting_simple',
        description: 'Simple pgRouting route finding function',
        critical: false
      },
      {
        name: 'find_routes_spatial',
        description: 'Spatial route finding function',
        critical: false
      },
      {
        name: 'find_out_and_back_spatial',
        description: 'Out-and-back route finding function',
        critical: false
      },
      {
        name: 'find_simple_loops_spatial',
        description: 'Simple loop finding function',
        critical: false
      },
      {
        name: 'find_simple_routes_with_logging',
        description: 'Simple route finding with logging',
        critical: false
      },

      // Route generation orchestration functions
      {
        name: 'generate_route_recommendations',
        description: 'Main route recommendation generator',
        critical: true
      },
      {
        name: 'generate_route_recommendations_configurable',
        description: 'Configurable route recommendation generator',
        critical: true
      },
      {
        name: 'generate_route_recommendations_deterministic',
        description: 'Deterministic route recommendation generator',
        critical: false
      },
      {
        name: 'generate_route_recommendations_uuid',
        description: 'UUID-based route recommendation generator',
        critical: false
      },
      {
        name: 'generate_route_recommendations_large_dataset',
        description: 'Large dataset route recommendation generator',
        critical: false
      },

      // Configuration functions
      {
        name: 'get_route_patterns',
        description: 'Returns available route patterns',
        critical: true
      },
      {
        name: 'get_route_distance_limits',
        description: 'Returns distance limits for route generation',
        critical: true,
        expectedReturnType: 'json'
      },
      {
        name: 'get_elevation_gain_limits',
        description: 'Returns elevation gain limits for route generation',
        critical: true,
        expectedReturnType: 'json'
      },
      {
        name: 'get_max_routes_per_bin',
        description: 'Returns maximum routes per pattern',
        critical: true,
        expectedReturnType: 'integer'
      },
      {
        name: 'get_min_route_score',
        description: 'Returns minimum route score threshold',
        critical: true,
        expectedReturnType: 'double precision'
      },

      // Utility functions
      {
        name: 'generate_route_name',
        description: 'Generates route names',
        critical: false
      },
      {
        name: 'generate_route_name_from_edges',
        description: 'Generates route names from edges',
        critical: false
      },
      {
        name: 'generate_route_name_from_trails',
        description: 'Generates route names from trails',
        critical: false
      },
      {
        name: 'generate_deterministic_route_uuid',
        description: 'Generates deterministic route UUIDs',
        critical: false
      },

      // Route analysis functions
      {
        name: 'calculate_route_connectivity_score',
        description: 'Calculates route connectivity score',
        critical: false
      },
      {
        name: 'calculate_route_cost',
        description: 'Calculates route cost',
        critical: false
      },
      {
        name: 'calculate_route_difficulty',
        description: 'Calculates route difficulty',
        critical: false
      },
      {
        name: 'calculate_route_elevation_stats',
        description: 'Calculates route elevation statistics',
        critical: false
      },
      {
        name: 'calculate_route_estimated_time',
        description: 'Calculates estimated route time',
        critical: false
      },
      {
        name: 'calculate_route_gain_rate',
        description: 'Calculates elevation gain rate',
        critical: false
      },
      {
        name: 'calculate_route_parametric_metrics',
        description: 'Calculates parametric route metrics',
        critical: false
      },

      // Testing functions
      {
        name: 'test_route_finding',
        description: 'Tests route finding functionality',
        critical: false
      },
      {
        name: 'test_route_finding_configurable',
        description: 'Tests configurable route finding',
        critical: false
      },
      {
        name: 'test_route_strategies',
        description: 'Tests different route strategies',
        critical: false
      }
    ];
  }

  /**
   * Validate all required database functions
   */
  async validateDatabaseFunctions(): Promise<DatabaseValidationResult> {
    console.log('🔍 Validating database functions...');
    
    const requiredFunctions = this.getRequiredFunctions();
    const validationResults: FunctionValidationResult[] = [];
    const missingFunctions: string[] = [];
    const criticalMissingFunctions: string[] = [];
    const errors: string[] = [];

    for (const requiredFunc of requiredFunctions) {
      try {
        const result = await this.validateFunction(requiredFunc);
        validationResults.push(result);
        
        if (!result.exists) {
          missingFunctions.push(requiredFunc.name);
          if (requiredFunc.critical) {
            criticalMissingFunctions.push(requiredFunc.name);
          }
        }
      } catch (error) {
        const errorMsg = `Error validating function ${requiredFunc.name}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        
        validationResults.push({
          functionName: requiredFunc.name,
          exists: false,
          error: errorMsg
        });
      }
    }

    const isValid = criticalMissingFunctions.length === 0 && errors.length === 0;

    console.log(`📊 Database function validation complete:`);
    console.log(`   ✅ Valid functions: ${validationResults.filter(r => r.exists).length}`);
    console.log(`   ❌ Missing functions: ${missingFunctions.length}`);
    console.log(`   🚨 Critical missing: ${criticalMissingFunctions.length}`);
    console.log(`   ⚠️  Errors: ${errors.length}`);

    if (!isValid) {
      console.log('\n🚨 CRITICAL ISSUES FOUND:');
      if (criticalMissingFunctions.length > 0) {
        console.log('   Missing critical functions:');
        criticalMissingFunctions.forEach(func => console.log(`     - ${func}`));
      }
      if (errors.length > 0) {
        console.log('   Validation errors:');
        errors.forEach(error => console.log(`     - ${error}`));
      }
    }

    return {
      isValid,
      missingFunctions,
      criticalMissingFunctions,
      validationResults,
      errors
    };
  }

  /**
   * Validate a single function
   */
  private async validateFunction(requiredFunc: RequiredFunction): Promise<FunctionValidationResult> {
    const result = await this.pgClient.query(`
      SELECT 
        proname,
        pg_get_function_identity_arguments(oid) as arguments,
        pg_get_function_result(oid) as return_type
      FROM pg_proc 
      WHERE proname = $1
    `, [requiredFunc.name]);

    if (result.rows.length === 0) {
      return {
        functionName: requiredFunc.name,
        exists: false
      };
    }

    const func = result.rows[0];
    const signature = `${requiredFunc.name}(${func.arguments})`;
    const returnType = func.return_type;

    // Check return type if specified
    if (requiredFunc.expectedReturnType && returnType !== requiredFunc.expectedReturnType) {
      return {
        functionName: requiredFunc.name,
        exists: true,
        signature,
        returnType,
        error: `Expected return type ${requiredFunc.expectedReturnType}, got ${returnType}`
      };
    }

    return {
      functionName: requiredFunc.name,
      exists: true,
      signature,
      returnType
    };
  }

  /**
   * Check if required tables exist
   */
  async validateRequiredTables(): Promise<{ isValid: boolean; missingTables: string[] }> {
    const requiredTables = [
      'route_patterns',
      'route_recommendations'
    ];

    const missingTables: string[] = [];
    
    for (const tableName of requiredTables) {
      const result = await this.pgClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )
      `, [tableName]);
      
      if (!result.rows[0].exists) {
        missingTables.push(tableName);
      }
    }

    return {
      isValid: missingTables.length === 0,
      missingTables
    };
  }

  /**
   * Comprehensive database validation
   */
  async validateDatabase(): Promise<{
    isValid: boolean;
    functionValidation: DatabaseValidationResult;
    tableValidation: { isValid: boolean; missingTables: string[] };
    errors: string[];
  }> {
    console.log('🔍 Starting comprehensive database validation...');
    
    const errors: string[] = [];
    
    // Validate functions
    const functionValidation = await this.validateDatabaseFunctions();
    
    // Validate tables
    const tableValidation = await this.validateRequiredTables();
    
    // Check for critical issues
    if (functionValidation.criticalMissingFunctions.length > 0) {
      errors.push(`Missing critical functions: ${functionValidation.criticalMissingFunctions.join(', ')}`);
    }
    
    if (tableValidation.missingTables.length > 0) {
      errors.push(`Missing required tables: ${tableValidation.missingTables.join(', ')}`);
    }
    
    const isValid = functionValidation.isValid && tableValidation.isValid && errors.length === 0;
    
    console.log(`\n📊 Database validation summary:`);
    console.log(`   ✅ Functions valid: ${functionValidation.isValid}`);
    console.log(`   ✅ Tables valid: ${tableValidation.isValid}`);
    console.log(`   ✅ Overall valid: ${isValid}`);
    
    if (!isValid) {
      console.log('\n🚨 VALIDATION FAILED - Export may not work correctly!');
    }
    
    return {
      isValid,
      functionValidation,
      tableValidation,
      errors
    };
  }
}
