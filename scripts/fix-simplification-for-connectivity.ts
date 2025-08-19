#!/usr/bin/env ts-node

/**
 * Fix Simplification for Connectivity
 * 
 * This script removes aggressive simplification from various processing scripts
 * to preserve maximum proximity for splitting and route generation.
 * 
 * The issue is that ST_SimplifyPreserveTopology with tolerance 0.00001 is too aggressive
 * and destroys connectivity between trail segments, preventing them from being
 * properly assimilated into routes.
 */

import * as fs from 'fs';
import * as path from 'path';

const SCRIPTS_DIR = path.join(__dirname);
const SRC_DIR = path.join(__dirname, '..', 'src');

// Files that need to be fixed (with hardcoded simplification)
const FILES_TO_FIX = [
  'scripts/test-minimal-nodenetwork.ts',
  'scripts/test-nodenetwork-bbox-clean.ts',
  'scripts/test-nodenetwork-bbox.ts',
  'scripts/process-networks-separately-fixed.ts',
  'scripts/find-geometrycollection-trail.ts',
  'scripts/process-networks-separately.ts',
  'scripts/process-networks-independently.ts',
  'scripts/process-networks-with-filtering.ts',
  'scripts/process-networks-final.ts',
  'scripts/hybrid-loop-preprocessing.ts',
  'scripts/pgnodenetwork-refinement/pgrouting-helpers-1-meter-tolerance.ts',
  'scripts/find-geometrycollection-threshold.ts',
  'scripts/find-geometrycollection-block.ts',
  'scripts/find-problematic-trail.ts',
  'scripts/split-loops-for-nodenetwork.ts',
  'scripts/test-improved-loop-splitting-complete.ts'
];

// Replacement patterns
const REPLACEMENTS = [
  // Replace ST_SimplifyPreserveTopology(geometry, 0.00001) with ST_Force2D(geometry)
  {
    pattern: /ST_SimplifyPreserveTopology\(geometry,\s*0\.00001\)/g,
    replacement: 'ST_Force2D(geometry)',
    description: 'Replace aggressive simplification with 2D conversion'
  },
  // Replace ST_SimplifyPreserveTopology(geometry, 0.0001) with ST_Force2D(geometry)
  {
    pattern: /ST_SimplifyPreserveTopology\(geometry,\s*0\.0001\)/g,
    replacement: 'ST_Force2D(geometry)',
    description: 'Replace moderate simplification with 2D conversion'
  },
  // Replace ST_SimplifyPreserveTopology(geometry, 0.001) with ST_Force2D(geometry)
  {
    pattern: /ST_SimplifyPreserveTopology\(geometry,\s*0\.001\)/g,
    replacement: 'ST_Force2D(geometry)',
    description: 'Replace light simplification with 2D conversion'
  },
  // Replace ST_SimplifyPreserveTopology(the_geom, 0.00001) with the_geom
  {
    pattern: /ST_SimplifyPreserveTopology\(the_geom,\s*0\.00001\)/g,
    replacement: 'the_geom',
    description: 'Remove simplification from the_geom column'
  },
  // Replace ST_SimplifyPreserveTopology(the_geom, 0.0001) with the_geom
  {
    pattern: /ST_SimplifyPreserveTopology\(the_geom,\s*0\.0001\)/g,
    replacement: 'the_geom',
    description: 'Remove simplification from the_geom column'
  },
  // Replace ST_SimplifyPreserveTopology(the_geom, 0.001) with the_geom
  {
    pattern: /ST_SimplifyPreserveTopology\(the_geom,\s*0\.001\)/g,
    replacement: 'the_geom',
    description: 'Remove simplification from the_geom column'
  }
];

function fixFile(filePath: string): { fixed: boolean; changes: number } {
  const fullPath = path.join(__dirname, '..', filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return { fixed: false, changes: 0 };
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  let totalChanges = 0;
  let hasChanges = false;
  
  for (const replacement of REPLACEMENTS) {
    const matches = content.match(replacement.pattern);
    if (matches) {
      const newContent = content.replace(replacement.pattern, replacement.replacement);
      const changes = content.length - newContent.length + (replacement.replacement.length * matches.length);
      content = newContent;
      totalChanges += matches.length;
      hasChanges = true;
      console.log(`  🔧 ${replacement.description}: ${matches.length} replacements`);
    }
  }
  
  if (hasChanges) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`  ✅ Fixed ${filePath} (${totalChanges} total changes)`);
  } else {
    console.log(`  ✅ No changes needed for ${filePath}`);
  }
  
  return { fixed: hasChanges, changes: totalChanges };
}

function main() {
  console.log('🔧 Fixing Simplification for Connectivity');
  console.log('==========================================');
  console.log('');
  console.log('This script removes aggressive simplification from processing scripts');
  console.log('to preserve maximum proximity for splitting and route generation.');
  console.log('');
  
  let totalFilesFixed = 0;
  let totalChanges = 0;
  
  for (const filePath of FILES_TO_FIX) {
    console.log(`📁 Processing: ${filePath}`);
    const result = fixFile(filePath);
    if (result.fixed) {
      totalFilesFixed++;
      totalChanges += result.changes;
    }
    console.log('');
  }
  
  console.log('📊 Summary');
  console.log('==========');
  console.log(`Files fixed: ${totalFilesFixed}/${FILES_TO_FIX.length}`);
  console.log(`Total changes: ${totalChanges}`);
  console.log('');
  console.log('✅ Simplification fixes completed!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Run your trail processing pipeline again');
  console.log('2. Check that trail segments maintain connectivity');
  console.log('3. Verify that routes are being generated properly');
  console.log('');
  console.log('The aggressive simplification has been disabled to preserve');
  console.log('maximum proximity for splitting and route generation.');
}

if (require.main === module) {
  main();
}

export { fixFile, REPLACEMENTS };
