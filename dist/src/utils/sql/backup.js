"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.backupDatabase = backupDatabase;
// Utility for backing up PostgreSQL database
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function backupDatabase(pgConfig) {
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
        pgDump.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ Database backup completed: ${backupFile}`);
                resolve();
            }
            else {
                reject(new Error(`pg_dump failed with code ${code}`));
            }
        });
    });
}
//# sourceMappingURL=backup.js.map