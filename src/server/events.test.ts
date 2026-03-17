import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventManager } from './events.js';
import type { RequestRecord } from '../shared/types.js';

function makeRequest(id: string): RequestRecord {
  return {
    id,
    timestamp: Date.now(),
    method: 'GET',
    url: 'http://example.com',
    host: 'example.com',
    path: '/',
    protocol: 'http',
    request_headers: '{}',
    request_body: null,
    request_size: 0,
    status: 200,
    response_headers: '{}',
    response_body: null,
    response_size: 0,
    duration: 50,
    content_type: 'text/html',
    truncated: 0,
  };
}

describe('EventManager', () => {
  let em: EventManager;

  beforeEach(() => {
    vi.useFakeTimers();
    em = new EventManager();
  });

  afterEach(() => {
    em.stop();
    vi.useRealTimers();
  });

  it('emits events to subscribers', () => {
    const received: RequestRecord[] = [];
    em.subscribe((events) => received.push(...events));
    em.push(makeRequest('r1'));
    vi.advanceTimersByTime(150);
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('r1');
  });

  it('batches events within 100ms window', () => {
    let callCount = 0;
    em.subscribe(() => { callCount++; });
    em.push(makeRequest('r1'));
    em.push(makeRequest('r2'));
    em.push(makeRequest('r3'));
    vi.advanceTimersByTime(150);
    expect(callCount).toBe(1);
  });

  it('removes subscriber on unsubscribe', () => {
    const received: RequestRecord[] = [];
    const unsub = em.subscribe((events) => received.push(...events));
    unsub();
    em.push(makeRequest('r1'));
    vi.advanceTimersByTime(150);
    expect(received).toHaveLength(0);
  });
});
