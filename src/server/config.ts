import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Config } from '../shared/types.js';
import { DEFAULT_CONFIG } from '../shared/types.js';

function expandHome(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function parseSize(value: string): number {
  const match = value.match(/^(\d+)\s*(MB|GB|KB|B)?$/i);
  if (!match) return parseInt(value, 10);
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'B').toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024,
  };
  return num * (multipliers[unit] || 1);
}

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!match) return parseInt(value, 10);
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'ms').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000,
  };
  return num * (multipliers[unit] || 1);
}

export function loadConfig(cliFlags: Partial<Config> = {}): Config {
  let fileConfig: Partial<Config> = {};

  const configPath = expandHome('~/.laurel-proxy/config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      fileConfig = {
        proxyPort: raw.proxyPort,
        uiPort: raw.uiPort,
        dbPath: raw.dbPath,
        maxAge: typeof raw.maxAge === 'string' ? parseDuration(raw.maxAge) : raw.maxAge,
        maxDbSize: typeof raw.maxDbSize === 'string' ? parseSize(raw.maxDbSize) : raw.maxDbSize,
        maxBodySize: typeof raw.maxBodySize === 'string' ? parseSize(raw.maxBodySize) : raw.maxBodySize,
        certCacheSize: raw.certCacheSize,
      };
      for (const key of Object.keys(fileConfig) as (keyof Config)[]) {
        if (fileConfig[key] === undefined) delete fileConfig[key];
      }
    } catch {
      // Ignore invalid config file
    }
  }

  const merged: Config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...cliFlags,
  };

  merged.dbPath = expandHome(merged.dbPath);

  return merged;
}

export { expandHome, parseSize, parseDuration };
