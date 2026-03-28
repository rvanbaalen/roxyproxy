import type { Command } from 'commander';
import { disableSystemProxy } from '../system-proxy.js';
import { printSuccess, printError } from '../banner.js';

export function registerProxyOff(program: Command): void {
  program
    .command('proxy-off')
    .description('Remove Laurel Proxy as system-wide proxy (macOS)')
    .option('--service <name>', 'Network service name (default: auto-detect)')
    .action(async (opts) => {
      const result = await disableSystemProxy(opts.service);
      if (result.ok) {
        printSuccess(result.message);
      } else {
        printError(result.message);
        process.exit(1);
      }
    });
}
