// Utility for backing up PostgreSQL database
import * as fs from 'fs';
import * as path from 'path';

export async function backupDatabase(pgConfig: any): Promise<void> {
  console.log('💾 Backing up PostgreSQL database...');
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `db_backup_${timestamp}.dump`);
  const { spawn } = require('child_process');
  const pgDump = spawn('pg_dump', [
    '-h', pgConfig.host || process.env.PGHOST || 'localhost',
    '-U', pgConfig.user || process.env.PGUSER || 'postgres',
    '-d', pgConfig.database || process.env.PGDATABASE || 'postgres',
    '--format=custom',
    '--file', backupFile
  ]);
  return new Promise((resolve, reject) => {
    pgDump.on('close', (code: number) => {
      if (code === 0) {
        console.log(`✅ Database backup completed: ${backupFile}`);
        resolve();
      } else {
        reject(new Error(`pg_dump failed with code ${code}`));
      }
    });
  });
} 