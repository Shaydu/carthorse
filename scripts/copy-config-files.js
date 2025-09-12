#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Copy config files from package to consumer's project
 * This script runs after npm install to set up default config files
 */

const configFiles = [
  'carthorse.config.yaml',
  'layer1-trail.config.yaml', 
  'layer2-node-edge.config.yaml',
  'layer3-routing.config.yaml'
];

function copyConfigFiles() {
  console.log('🔧 Setting up carthorse configuration files...');
  
  // Find the package directory
  const packageDir = path.dirname(__dirname);
  const configsSourceDir = path.join(packageDir, 'configs');
  const configsTargetDir = path.join(process.cwd(), 'configs');
  
  // Create configs directory if it doesn't exist
  if (!fs.existsSync(configsTargetDir)) {
    fs.mkdirSync(configsTargetDir, { recursive: true });
    console.log(`📁 Created configs directory: ${configsTargetDir}`);
  }
  
  let copiedCount = 0;
  
  for (const configFile of configFiles) {
    const sourcePath = path.join(configsSourceDir, configFile);
    const targetPath = path.join(configsTargetDir, configFile);
    
    // Only copy if source exists and target doesn't exist (don't overwrite existing configs)
    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      try {
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`✅ Copied ${configFile}`);
        copiedCount++;
      } catch (error) {
        console.warn(`⚠️  Failed to copy ${configFile}: ${error.message}`);
      }
    } else if (fs.existsSync(targetPath)) {
      console.log(`⏭️  Skipped ${configFile} (already exists - your custom config will be used)`);
    } else {
      console.warn(`⚠️  Source config file not found: ${configFile}`);
    }
  }
  
  if (copiedCount > 0) {
    console.log(`🎉 Successfully copied ${copiedCount} config files to ${configsTargetDir}`);
    console.log('📝 These are default configs - customize them for your environment');
    console.log('💡 Your custom configs will override the package defaults');
  } else {
    console.log('ℹ️  No new config files copied (all already exist)');
    console.log('💡 Your existing custom configs will override the package defaults');
  }
}

// Run the copy function
copyConfigFiles();
