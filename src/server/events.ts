import type { RequestRecord } from '../shared/types.js';

type Subscriber = (events: RequestRecord[]) => void;

export class EventManager {
  private subscribers: Set<Subscriber> = new Set();
  private buffer: RequestRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  push(record: RequestRecord): void {
    this.buffer.push(record);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 100);
    }
  }

  private flush(): void {
    this.timer = null;
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    for (const sub of this.subscribers) {
      try { sub(batch); } catch {}
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}
