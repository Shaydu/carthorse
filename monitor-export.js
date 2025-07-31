#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}

const logFile = `logs/export-${Date.now()}.log`;
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

console.log(`📝 Logging export to: ${logFile}`);
console.log('🚀 Starting export with monitoring...\n');

// Start the export process
const exportProcess = spawn('npx', [
  'ts-node', 
  'src/index.ts', 
  '--region', 'boulder', 
  '--out', './test-output/boulder-monitored.db', 
  '--skip-validation', 
  '--verbose'
], {
  stdio: ['inherit', 'pipe', 'pipe']
});

// Monitor stdout
exportProcess.stdout.on('data', (data) => {
  const output = data.toString();
  
  // Write to log file
  logStream.write(`[${new Date().toISOString()}] ${output}`);
  
  // Show key progress indicators
  if (output.includes('copyRegionDataToStaging')) {
    console.log('🔄 Copying region data to staging...');
  }
  if (output.includes('generateRoutingGraph')) {
    console.log('🛤️  Generating routing graph...');
  }
  if (output.includes('generateRouteRecommendations')) {
    console.log('🎯 Generating route recommendations...');
  }
  if (output.includes('exportDatabase')) {
    console.log('📦 Exporting to SQLite...');
  }
  if (output.includes('✅')) {
    console.log(`✅ ${output.trim()}`);
  }
  if (output.includes('❌')) {
    console.log(`❌ ${output.trim()}`);
  }
  if (output.includes('Error')) {
    console.log(`🚨 ERROR: ${output.trim()}`);
  }
});

// Monitor stderr
exportProcess.stderr.on('data', (data) => {
  const output = data.toString();
  logStream.write(`[${new Date().toISOString()}] ERROR: ${output}`);
  console.log(`🚨 ${output.trim()}`);
});

// Handle process completion
exportProcess.on('close', (code) => {
  logStream.end();
  
  if (code === 0) {
    console.log('\n✅ Export completed successfully!');
    console.log(`📝 Full log available at: ${logFile}`);
    
    // Run validation
    console.log('\n🔍 Running validation...');
    const validateProcess = spawn('node', ['validate-boulder-export.js'], {
      stdio: 'inherit'
    });
    
    validateProcess.on('close', (validateCode) => {
      if (validateCode === 0) {
        console.log('\n✅ Validation completed!');
      } else {
        console.log('\n❌ Validation failed!');
      }
    });
  } else {
    console.log(`\n❌ Export failed with code: ${code}`);
    console.log(`📝 Check log file: ${logFile}`);
  }
});

// Handle process errors
exportProcess.on('error', (error) => {
  logStream.write(`[${new Date().toISOString()}] PROCESS ERROR: ${error.message}\n`);
  logStream.end();
  console.log(`🚨 Process error: ${error.message}`);
});

console.log('Press Ctrl+C to stop monitoring...\n'); 