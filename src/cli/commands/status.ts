import type { Command } from 'commander';
import http from 'node:http';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show proxy status')
    .option('--ui-port <number>', 'UI/API port', '8081')
    .action(async (opts) => {
      const port = parseInt(opts.uiPort, 10);
      try {
        const body = await apiGet(port, '/api/status');
        const status = JSON.parse(body);
        console.log(`Running:  ${status.running}`);
        console.log(`Proxy:    port ${status.proxyPort}`);
        console.log(`Requests: ${status.requestCount}`);
        console.log(`DB Size:  ${(status.dbSizeBytes / (1024 * 1024)).toFixed(1)}MB`);
      } catch {
        console.error('Proxy is not running.');
        process.exit(1);
      }
    });
}

function apiGet(port: number, urlPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}
