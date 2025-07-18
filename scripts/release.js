#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

const releaseType = process.argv[2]; // 'patch', 'minor', or 'major'

if (!releaseType || !['patch', 'minor', 'major'].includes(releaseType)) {
  console.error('Usage: node scripts/release.js <patch|minor|major>');
  console.error('Example: node scripts/release.js patch');
  process.exit(1);
}

try {
  console.log(`🚀 Starting ${releaseType} release...`);
  
  // Check if working directory is clean
  const status = execSync('git status --porcelain', { encoding: 'utf8' });
  if (status.trim()) {
    console.error('❌ Working directory is not clean. Please commit or stash changes first.');
    process.exit(1);
  }
  
  // Update changelog
  console.log('📝 Updating changelog...');
  execSync('node scripts/update-changelog.js', { stdio: 'inherit' });
  
  // Bump version
  console.log(`📦 Bumping version (${releaseType})...`);
  execSync(`npm version ${releaseType} --no-git-tag-version`, { stdio: 'inherit' });
  
  // Get new version
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const newVersion = packageJson.version;
  
  // Build the package
  console.log('🔨 Building package...');
  execSync('npm run build', { stdio: 'inherit' });
  
  // Run tests
  console.log('🧪 Running tests...');
  execSync('npm test', { stdio: 'inherit' });
  
  // Commit changes
  console.log('💾 Committing changes...');
  execSync('git add .', { stdio: 'inherit' });
  execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: 'inherit' });
  
  // Create git tag
  console.log(`🏷️  Creating git tag v${newVersion}...`);
  execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
  
  // Push changes and tag
  console.log('📤 Pushing changes and tag...');
  execSync('git push', { stdio: 'inherit' });
  execSync(`git push origin v${newVersion}`, { stdio: 'inherit' });
  
  // Publish to npm
  console.log('📦 Publishing to npm...');
  execSync('npm publish', { stdio: 'inherit' });
  
  console.log(`✅ Successfully released v${newVersion}!`);
  console.log(`📋 Next steps:`);
  console.log(`   - Review the release on GitHub`);
  console.log(`   - Update documentation if needed`);
  console.log(`   - Notify users of the new release`);
  
} catch (error) {
  console.error('❌ Release failed:', error.message);
  process.exit(1);
} 