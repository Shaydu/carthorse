import * as fs from 'fs';
import * as path from 'path';

/**
 * Extract schema version from SQL schema file
 * Reads the version from the header comment in the SQL file
 */
export function getSchemaVersionFromFile(schemaFilePath: string): number {
  try {
    const content = fs.readFileSync(schemaFilePath, 'utf8');
    
    // Look for version in header comment
    const versionMatch = content.match(/-- CARTHORSE SQLITE SCHEMA v(\d+)/);
    if (versionMatch) {
      return parseInt(versionMatch[1]);
    }
    
    // Fallback: look for any vXX pattern in the file
    const fallbackMatch = content.match(/v(\d+)/);
    if (fallbackMatch) {
      return parseInt(fallbackMatch[1]);
    }
    
    throw new Error(`Could not extract schema version from ${schemaFilePath}`);
  } catch (error) {
    console.error(`Error reading schema version from ${schemaFilePath}:`, error);
    throw error;
  }
}

/**
 * Get the current SQLite schema version by reading from the schema file
 */
export function getCurrentSqliteSchemaVersion(): number {
  // Try multiple possible paths for the schema file
  const possiblePaths = [
    path.join(__dirname, '../../sql/schemas/carthorse-sqlite-schema-v14.sql'),
    path.join(__dirname, '../../../sql/schemas/carthorse-sqlite-schema-v14.sql'),
    path.join(process.cwd(), 'sql/schemas/carthorse-sqlite-schema-v14.sql'),
    path.join(process.cwd(), 'dist/sql/schemas/carthorse-sqlite-schema-v14.sql')
  ];
  
  for (const schemaFilePath of possiblePaths) {
    try {
      return getSchemaVersionFromFile(schemaFilePath);
    } catch (error) {
      // Continue to next path
      continue;
    }
  }
  
  // If all paths fail, return a default version
  console.warn('Could not find schema file, using default version 14');
  return 14;
}

/**
 * Get schema description from SQL file
 */
export function getSchemaDescriptionFromFile(schemaFilePath: string): string {
  try {
    const content = fs.readFileSync(schemaFilePath, 'utf8');
    
    // Look for description in header comment
    const descMatch = content.match(/--\s*(.+)/);
    if (descMatch) {
      return descMatch[1].trim();
    }
    
    return 'Carthorse SQLite Export';
  } catch (error) {
    console.error(`Error reading schema description from ${schemaFilePath}:`, error);
    return 'Carthorse SQLite Export';
  }
} 