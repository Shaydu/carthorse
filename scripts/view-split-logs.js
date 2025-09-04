#!/usr/bin/env node

/**
 * Split Log Viewer
 * Shows which trails were split and which were deleted during the splitting process
 * 
 * Usage:
 *   node scripts/view-split-logs.js [log-file-name]
 *   node scripts/view-split-logs.js carthorse_1756927516034.split.log
 */

const fs = require('fs');
const path = require('path');

function viewSplitLog(logFileName = null) {
  const logsDir = path.join(process.cwd(), 'logs');
  
  if (!fs.existsSync(logsDir)) {
    console.log('❌ No logs directory found');
    return;
  }

  // If no specific log file provided, find the most recent one
  if (!logFileName) {
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.split.log'))
      .map(file => ({ name: file, path: path.join(logsDir, file) }))
      .sort((a, b) => {
        const statsA = fs.statSync(a.path);
        const statsB = fs.statSync(b.path);
        return statsB.mtime.getTime() - statsA.mtime.getTime();
      });
    
    if (logFiles.length === 0) {
      console.log('❌ No split log files found');
      return;
    }
    
    logFileName = logFiles[0].name;
    console.log(`📁 Using most recent log: ${logFileName}`);
  }

  const logPath = path.join(logsDir, logFileName);
  
  if (!fs.existsSync(logPath)) {
    console.log(`❌ Log file not found: ${logFileName}`);
    return;
  }

  console.log(`\n📖 Reading split log: ${logFileName}`);
  console.log('=' .repeat(60));

  const logContent = fs.readFileSync(logPath, 'utf8');
  const lines = logContent.split('\n');

  // Parse the log content
  const summary = {
    timestamp: '',
    schema: '',
    totalSegments: 0,
    crossSplits: 0,
    selfSplits: 0,
    totalLength: 0,
    avgSegmentLength: 0,
    trailsToDelete: [],
    trailsDeleted: [],
    finalTrailCount: 0
  };

  let currentSection = '';
  
  for (const line of lines) {
    if (line.includes('Timestamp:')) {
      summary.timestamp = line.replace('Timestamp:', '').trim();
    } else if (line.includes('Staging Schema:')) {
      summary.schema = line.replace('Staging Schema:', '').trim();
    } else if (line.includes('Total segments to insert:')) {
      summary.totalSegments = parseInt(line.match(/\d+/)?.[0] || '0');
    } else if (line.includes('Cross-intersection splits:')) {
      summary.crossSplits = parseInt(line.match(/\d+/)?.[0] || '0');
    } else if (line.includes('Self-intersection splits:')) {
      summary.selfSplits = parseInt(line.match(/\d+/)?.[0] || '0');
    } else if (line.includes('Total length of all segments:')) {
      const match = line.match(/(\d+\.\d+)km/);
      summary.totalLength = match ? parseFloat(match[1]) : 0;
    } else if (line.includes('Average segment length:')) {
      const match = line.match(/(\d+\.\d+)m/);
      summary.avgSegmentLength = match ? parseFloat(match[1]) : 0;
    } else if (line.includes('=== DELETION ANALYSIS ===')) {
      currentSection = 'deletion';
    } else if (line.includes('Trails to be deleted:')) {
      currentSection = 'trailsToDelete';
    } else if (line.includes('DELETE:')) {
      const match = line.match(/DELETE: (.+?) \((\d+\.\d+)m\) - (.+)/);
      if (match) {
        summary.trailsToDelete.push({
          name: match[1].trim(),
          length: parseFloat(match[2]),
          uuid: match[3].trim()
        });
      }
    } else if (line.includes('Successfully deleted')) {
      currentSection = 'deleted';
    } else if (line.includes('Final trail count:')) {
      summary.finalTrailCount = parseInt(line.match(/\d+/)?.[0] || '0');
    }
  }

  // Display the summary
  console.log(`\n📊 SPLITTING SUMMARY`);
  console.log(`   Schema: ${summary.schema}`);
  console.log(`   Timestamp: ${summary.timestamp}`);
  console.log(`   Total segments created: ${summary.totalSegments}`);
  console.log(`   Cross-intersection splits: ${summary.crossSplits}`);
  console.log(`   Self-intersection splits: ${summary.selfSplits}`);
  console.log(`   Total length: ${summary.totalLength}km`);
  console.log(`   Average segment length: ${summary.avgSegmentLength}m`);
  console.log(`   Final trail count: ${summary.finalTrailCount}`);

  if (summary.trailsToDelete.length > 0) {
    console.log(`\n🗑️ TRAILS DELETED (${summary.trailsToDelete.length}):`);
    summary.trailsToDelete.forEach((trail, index) => {
      console.log(`   ${index + 1}. ${trail.name} (${trail.length}m) - ${trail.uuid}`);
    });
  } else {
    console.log(`\n✅ No trails were deleted`);
  }

  // Show what happened to each original trail
  console.log(`\n🔄 SPLITTING BREAKDOWN:`);
  if (summary.crossSplits > 0) {
    console.log(`   • ${summary.crossSplits} trails were split due to intersections with other trails`);
  }
  if (summary.selfSplits > 0) {
    console.log(`   • ${summary.selfSplits} trails were split due to self-intersections (loops)`);
  }
  
  const unsplitTrails = summary.finalTrailCount - summary.totalSegments;
  if (unsplitTrails > 0) {
    console.log(`   • ${unsplitTrails} trails remained unsplit`);
  }

  console.log('\n' + '=' .repeat(60));
  console.log(`📝 Full log: ${logPath}`);
}

// Main execution
if (require.main === module) {
  const logFile = process.argv[2];
  viewSplitLog(logFile);
}

module.exports = { viewSplitLog };
