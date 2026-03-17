import type { Database } from './db.js';
import type { Config } from '../shared/types.js';

export class Cleanup {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database,
    private config: Config,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.run(), 5 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  run(): void {
    const cutoff = Date.now() - this.config.maxAge;
    this.db.deleteOlderThan(cutoff);

    while (this.db.getDbSize() > this.config.maxDbSize) {
      const deleted = this.db.deleteOlderThan(Date.now());
      if (deleted === 0) break;
    }
  }
}
