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
    // Delete by age
    const cutoff = Date.now() - this.config.maxAge;
    this.db.deleteOlderThan(cutoff);

    // Delete oldest in batches until under size limit
    while (this.db.getDbSize() > this.config.maxDbSize) {
      const deleted = this.db.deleteOldest(100);
      if (deleted === 0) break;
    }

    // Reclaim disk space
    this.db.incrementalVacuum();
  }
}
