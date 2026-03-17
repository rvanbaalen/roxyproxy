import type { Command } from 'commander';
import { Database } from '../../storage/db.js';
import { loadConfig } from '../../server/config.js';
import { formatRequests } from '../format.js';
import type { RequestFilter } from '../../shared/types.js';

export function registerRequests(program: Command): void {
  program
    .command('requests')
    .description('Query captured requests')
    .option('--host <pattern>', 'Filter by hostname')
    .option('--status <code>', 'Filter by status code')
    .option('--method <method>', 'Filter by HTTP method')
    .option('--search <pattern>', 'Search URL')
    .option('--since <time>', 'Requests after this time')
    .option('--until <time>', 'Requests before this time')
    .option('--limit <n>', 'Max results', '100')
    .option('--format <format>', 'Output format (json|table)', 'json')
    .option('--db-path <path>', 'Database path')
    .action((opts) => {
      const config = loadConfig(opts.dbPath ? { dbPath: opts.dbPath } : {});
      const db = new Database(config.dbPath);

      const filter: RequestFilter = {
        limit: parseInt(opts.limit, 10),
      };
      if (opts.host) filter.host = opts.host;
      if (opts.status) filter.status = parseInt(opts.status, 10);
      if (opts.method) filter.method = opts.method;
      if (opts.search) filter.search = opts.search;
      if (opts.since) filter.since = parseTime(opts.since);
      if (opts.until) filter.until = parseTime(opts.until);

      const result = db.query(filter);
      console.log(formatRequests(result, opts.format));
      db.close();
    });
}

function parseTime(value: string): number {
  const num = Number(value);
  if (!isNaN(num)) return num;
  return new Date(value).getTime();
}
