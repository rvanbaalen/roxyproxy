import type { Command } from 'commander';
import { loadConfig } from '../../server/config.js';
import { RoxyProxyServer } from '../../server/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start the proxy server')
    .option('--port <number>', 'Proxy port', '8080')
    .option('--ui-port <number>', 'UI/API port', '8081')
    .option('--db-path <path>', 'Database path')
    .action(async (opts) => {
      const config = loadConfig({
        proxyPort: parseInt(opts.port, 10),
        uiPort: parseInt(opts.uiPort, 10),
        ...(opts.dbPath ? { dbPath: opts.dbPath } : {}),
      });

      const pidPath = path.join(os.homedir(), '.roxyproxy', 'pid');
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      fs.writeFileSync(pidPath, process.pid.toString());

      const server = new RoxyProxyServer(config);
      const { proxyPort, uiPort } = await server.start();

      console.log(`RoxyProxy started`);
      console.log(`  Proxy:  http://127.0.0.1:${proxyPort}`);
      console.log(`  Web UI: http://127.0.0.1:${uiPort}`);
      console.log(`  Press Ctrl+C to stop`);

      const shutdown = async () => {
        console.log('\nShutting down...');
        await server.stop();
        try { fs.unlinkSync(pidPath); } catch {}
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
