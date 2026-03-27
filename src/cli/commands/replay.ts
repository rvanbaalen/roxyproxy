import type { Command } from 'commander';
import { Database } from '../../storage/db.js';
import { loadConfig } from '../../server/config.js';
import { replay, recordToReplayRequest } from '../../server/replay.js';
import { formatReplayResponse, formatDiff } from '../format.js';

export function registerReplay(program: Command): void {
  program
    .command('replay <id>')
    .description('Replay a captured request')
    .option('--method <method>', 'Override HTTP method')
    .option('--url <url>', 'Override URL')
    .option('--header <header...>', 'Override/add header (format: "Key: Value")')
    .option('--body <body>', 'Override body (raw string)')
    .option('--diff', 'Show diff between original and replay response')
    .option('--format <format>', 'Output format (json|table)', 'json')
    .option('--db-path <path>', 'Database path')
    .action(async (id, opts) => {
      const config = loadConfig(opts.dbPath ? { dbPath: opts.dbPath } : {});
      const db = new Database(config.dbPath);

      const record = db.getById(id);
      if (!record) {
        console.error(`Request ${id} not found.`);
        db.close();
        process.exit(1);
      }

      const request = recordToReplayRequest(record);

      // Apply overrides
      if (opts.method) request.method = opts.method;
      if (opts.url) request.url = opts.url;
      if (opts.header) {
        for (const h of opts.header as string[]) {
          const colonIdx = h.indexOf(':');
          if (colonIdx > 0) {
            const key = h.slice(0, colonIdx).trim();
            const value = h.slice(colonIdx + 1).trim();
            request.headers[key] = value;
          }
        }
      }
      if (opts.body) {
        request.body = Buffer.from(opts.body).toString('base64');
      }

      try {
        const response = await replay(request);
        if (opts.diff) {
          console.log(formatDiff(record, response, opts.format));
          // Exit code: 0 if replay is 2xx, 1 if 4xx/5xx
          if (response.status >= 400) {
            db.close();
            process.exit(1);
          }
        } else {
          console.log(formatReplayResponse(response, opts.format));
        }
      } catch (err) {
        console.error(`Replay failed: ${(err as Error).message}`);
        db.close();
        process.exit(2);
      } finally {
        db.close();
      }
    });
}
