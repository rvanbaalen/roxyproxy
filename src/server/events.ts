import type { RequestRecord } from '../shared/types.js';

export interface StatusEvent {
  running: boolean;
  proxyPort: number;
}

type RequestSubscriber = (events: RequestRecord[]) => void;
type StatusSubscriber = (status: StatusEvent) => void;

export class EventManager {
  private requestSubscribers: Set<RequestSubscriber> = new Set();
  private statusSubscribers: Set<StatusSubscriber> = new Set();
  private buffer: RequestRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  push(record: RequestRecord): void {
    this.buffer.push(record);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 100);
    }
  }

  emitStatus(status: StatusEvent): void {
    for (const sub of this.statusSubscribers) {
      try { sub(status); } catch {}
    }
  }

  private flush(): void {
    this.timer = null;
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    for (const sub of this.requestSubscribers) {
      try { sub(batch); } catch {}
    }
  }

  subscribe(fn: RequestSubscriber): () => void {
    this.requestSubscribers.add(fn);
    return () => { this.requestSubscribers.delete(fn); };
  }

  subscribeStatus(fn: StatusSubscriber): () => void {
    this.statusSubscribers.add(fn);
    return () => { this.statusSubscribers.delete(fn); };
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}
