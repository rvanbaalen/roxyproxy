import type { Command } from 'commander';
import { enableSystemProxy } from '../system-proxy.js';
import { printSuccess, printError } from '../banner.js';

export function registerProxyOn(program: Command): void {
  program
    .command('proxy-on')
    .description('Set Laurel Proxy as system-wide proxy (macOS)')
    .option('--port <number>', 'Proxy port', '8080')
    .option('--service <name>', 'Network service name (default: auto-detect)')
    .action(async (opts) => {
      const result = await enableSystemProxy(opts.port, opts.service);
      if (result.ok) {
        printSuccess(result.message);
      } else {
        printError(result.message);
        process.exit(1);
      }
    });
}
