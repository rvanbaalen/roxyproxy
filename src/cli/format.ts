import type { RequestRecord, PaginatedResponse } from '../shared/types.js';

export function formatRequests(result: PaginatedResponse<RequestRecord>, format: string): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  if (result.data.length === 0) {
    return 'No requests found.';
  }

  const header = ['METHOD', 'STATUS', 'HOST', 'PATH', 'DURATION', 'SIZE'].map(h => h.padEnd(12)).join('');
  const rows = result.data.map((r) => {
    return [
      (r.method || '').padEnd(12),
      String(r.status ?? '-').padEnd(12),
      (r.host || '').slice(0, 30).padEnd(12),
      (r.path || '').slice(0, 30).padEnd(12),
      (r.duration ? `${r.duration}ms` : '-').padEnd(12),
      formatBytes(r.response_size || 0).padEnd(12),
    ].join('');
  });

  const footer = `\n${result.total} total (showing ${result.data.length}, offset ${result.offset})`;
  return [header, ...rows, footer].join('\n');
}

export function formatRequest(record: RequestRecord, format: string): string {
  if (format === 'json') {
    return JSON.stringify(record, null, 2);
  }

  const lines: string[] = [
    `ID:       ${record.id}`,
    `URL:      ${record.url}`,
    `Method:   ${record.method}`,
    `Status:   ${record.status}`,
    `Duration: ${record.duration}ms`,
    `Protocol: ${record.protocol}`,
    `Time:     ${new Date(record.timestamp).toISOString()}`,
    '',
    '--- Request Headers ---',
    formatHeaders(record.request_headers),
    '',
    '--- Response Headers ---',
    formatHeaders(record.response_headers),
  ];

  if (record.request_body) {
    lines.push('', '--- Request Body ---', formatBody(record.request_body, record.content_type));
  }
  if (record.response_body) {
    lines.push('', '--- Response Body ---', formatBody(record.response_body, record.content_type));
  }

  return lines.join('\n');
}

function formatHeaders(headersJson: string | null): string {
  if (!headersJson) return '(none)';
  try {
    const headers = JSON.parse(headersJson);
    return Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  } catch {
    return headersJson;
  }
}

function formatBody(body: Buffer | null, contentType: string | null): string {
  if (!body) return '(empty)';
  const str = Buffer.isBuffer(body) ? body.toString('utf-8') : String(body);
  if (contentType?.includes('json')) {
    try { return JSON.stringify(JSON.parse(str), null, 2); } catch {}
  }
  return str;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
