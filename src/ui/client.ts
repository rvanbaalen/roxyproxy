import { useState, useEffect } from 'react';

export interface RequestRecord {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  protocol: string;
  request_headers: string;
  request_body: string | null;
  request_size: number;
  status: number | null;
  response_headers: string | null;
  response_body: string | null;
  response_size: number;
  duration: number | null;
  content_type: string | null;
  truncated: number;
}

export interface ProxyStatus {
  running: boolean;
  proxyPort: number;
  requestCount: number;
  dbSizeBytes: number;
  hostname?: string;
}

export interface PaginatedResponse {
  data: RequestRecord[];
  total: number;
  limit: number;
  offset: number;
}

const API_BASE = '/api';

export async function fetchRequests(params: Record<string, string> = {}): Promise<PaginatedResponse> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/requests?${query}`);
  return res.json();
}

export async function fetchRequest(id: string): Promise<RequestRecord> {
  const res = await fetch(`${API_BASE}/requests/${id}`);
  return res.json();
}

export async function fetchStatus(): Promise<ProxyStatus> {
  const res = await fetch(`${API_BASE}/status`);
  return res.json();
}

export async function clearRequests(): Promise<void> {
  await fetch(`${API_BASE}/requests`, { method: 'DELETE' });
}

export async function startProxy(): Promise<void> {
  await fetch(`${API_BASE}/proxy/start`, { method: 'POST' });
}

export async function stopProxy(): Promise<void> {
  await fetch(`${API_BASE}/proxy/stop`, { method: 'POST' });
}

export async function fetchSystemProxyStatus(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/system-proxy`);
  const data = await res.json();
  return data.enabled;
}

export async function enableSystemProxy(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/system-proxy/enable`, { method: 'POST' });
  return res.json();
}

export async function disableSystemProxy(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/system-proxy/disable`, { method: 'POST' });
  return res.json();
}

export interface ReplayRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ReplayResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  duration: number;
  size: number;
}

export async function replayRequest(request: ReplayRequest): Promise<ReplayResponse> {
  const res = await fetch(`${API_BASE}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Replay failed');
  }
  return res.json();
}

export interface SSEState {
  requests: RequestRecord[];
  statusEvent: { running: boolean; proxyPort: number } | null;
  clearLocal: () => void;
}

export function useSSE(maxItems = 500): SSEState {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [statusEvent, setStatusEvent] = useState<SSEState['statusEvent']>(null);
  const clearLocal = () => setRequests([]);

  useEffect(() => {
    let cancelled = false;

    // Load existing traffic from the database first
    fetchRequests({ limit: String(maxItems) }).then((result) => {
      if (!cancelled) {
        setRequests(result.data);
      }
    }).catch(() => {
      // Ignore fetch errors — SSE will still work
    });

    const es = new EventSource(`${API_BASE}/events`);

    es.addEventListener('request', (event) => {
      const record: RequestRecord = JSON.parse(event.data);
      setRequests((prev) => {
        if (prev.some((r) => r.id === record.id)) return prev;
        const next = [record, ...prev];
        return next.slice(0, maxItems);
      });
    });

    es.addEventListener('status', (event) => {
      setStatusEvent(JSON.parse(event.data));
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, [maxItems]);

  return { requests, statusEvent, clearLocal };
}
