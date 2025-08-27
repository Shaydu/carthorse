import { execSync } from 'child_process';

export interface GitMetadata {
  branch: string;
  commit: string;
  command: string;
  timestamp: string;
  version: string;
}

/**
 * Get current git branch name
 */
export function getGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Get current git commit hash
 */
export function getGitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Get package version from package.json
 */
export function getPackageVersion(): string {
  try {
    const packageJson = require('../../package.json');
    return packageJson.version || 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Get the command that was executed (from process.argv)
 */
export function getExecutedCommand(): string {
  return process.argv.join(' ');
}

/**
 * Get comprehensive git metadata for embedding in exports
 */
export function getGitMetadata(): GitMetadata {
  return {
    branch: getGitBranch(),
    commit: getGitCommit(),
    command: getExecutedCommand(),
    timestamp: new Date().toISOString(),
    version: getPackageVersion()
  };
}
