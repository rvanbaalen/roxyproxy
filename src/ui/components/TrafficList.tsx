import { useState, useMemo, useCallback, useRef } from 'react';
import { CaretUp, CaretDown, CaretUpDown } from '@phosphor-icons/react';
import type { RequestRecord } from '../api.ts';

interface TrafficListProps {
  requests: RequestRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type SortKey = 'timestamp' | 'method' | 'status' | 'host' | 'path' | 'duration' | 'response_size';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; minPx: number; align?: 'right' }[] = [
  { key: 'timestamp', label: 'Time', minPx: 110 },
  { key: 'method', label: 'Method', minPx: 90 },
  { key: 'status', label: 'Status', minPx: 80 },
  { key: 'host', label: 'Host', minPx: 90 },
  { key: 'path', label: 'Path', minPx: 120 },
  { key: 'duration', label: 'Duration', minPx: 100, align: 'right' },
  { key: 'response_size', label: 'Size', minPx: 70, align: 'right' },
];

// Initial width fractions (sum to 1)
const INITIAL_WIDTHS = [0.13, 0.07, 0.06, 0.19, 0.37, 0.10, 0.08];

const statusColor = (status: number | null) => {
  if (!status) return 'text-gray-500';
  if (status < 300) return 'text-green-400';
  if (status < 400) return 'text-yellow-400';
  if (status < 500) return 'text-orange-400';
  return 'text-red-400';
};

const methodColor = (method: string) => {
  const colors: Record<string, string> = { GET: 'text-blue-400', POST: 'text-green-400', PUT: 'text-yellow-400', PATCH: 'text-orange-400', DELETE: 'text-red-400' };
  return colors[method] || 'text-gray-400';
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

const formatTimestamp = (ts: number) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
};

function compare(a: RequestRecord, b: RequestRecord, key: SortKey): number {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'string') return av.localeCompare(bv as string);
  return (av as number) - (bv as number);
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <CaretUpDown size={14} className="shrink-0 text-gray-700" />;
  const Icon = dir === 'asc' ? CaretUp : CaretDown;
  return <Icon size={14} weight="bold" className="shrink-0 text-blue-400" />;
}

const renderCell = (req: RequestRecord, key: SortKey) => {
  switch (key) {
    case 'timestamp':
      return <span className="font-mono text-gray-500 tabular-nums">{formatTimestamp(req.timestamp)}</span>;
    case 'method':
      return <span className={`font-mono ${methodColor(req.method)}`}>{req.method}</span>;
    case 'status':
      return <span className={`font-mono ${statusColor(req.status)}`}>{req.status ?? '-'}</span>;
    case 'host':
      return <span className="text-gray-300">{req.host}</span>;
    case 'path':
      return <span className="text-gray-400">{req.path}</span>;
    case 'duration':
      return <span className="text-gray-500">{req.duration ? `${req.duration}ms` : '-'}</span>;
    case 'response_size':
      return <span className="text-gray-500">{formatBytes(req.response_size)}</span>;
  }
};

export function TrafficList({ requests, selectedId, onSelect }: TrafficListProps) {
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [colWidths, setColWidths] = useState(INITIAL_WIDTHS);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ col: number; startX: number; widths: number[] } | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const sorted = useMemo(() => {
    const copy = [...requests];
    copy.sort((a, b) => {
      const c = compare(a, b, sortKey);
      return sortDir === 'asc' ? c : -c;
    });
    return copy;
  }, [requests, sortKey, sortDir]);

  const handleResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const cw = containerRef.current?.clientWidth ?? 1;
    dragRef.current = { col: colIndex, startX: e.clientX, widths: [...colWidths] };

    const onMove = (me: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = (me.clientX - drag.startX) / cw;
      const next = [...drag.widths];
      const maxGrow = drag.widths[colIndex + 1] - COLUMNS[colIndex + 1].minPx / cw;
      const maxShrink = drag.widths[colIndex] - COLUMNS[colIndex].minPx / cw;
      const clamped = Math.max(-maxShrink, Math.min(maxGrow, delta));
      next[colIndex] = drag.widths[colIndex] + clamped;
      next[colIndex + 1] = drag.widths[colIndex + 1] - clamped;
      setColWidths(next);
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths]);

  return (
    <div ref={containerRef} className="flex-1 overflow-auto">
      <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {colWidths.map((w, i) => (
            <col key={i} style={{ width: `${(w * 100).toFixed(2)}%`, minWidth: COLUMNS[i].minPx }} />
          ))}
        </colgroup>
        <thead className="bg-gray-900 sticky top-0">
          <tr className="text-left text-gray-400 border-b border-gray-800">
            {COLUMNS.map((col, i) => (
              <th
                key={col.key}
                className={`px-3 py-2 relative cursor-pointer select-none hover:text-gray-200 transition-colors ${col.align === 'right' ? 'text-right' : ''}`}
                onClick={() => handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </span>
                {i < COLUMNS.length - 1 && (
                  <div
                    className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize z-10 group"
                    onMouseDown={(e) => handleResizeStart(e, i)}
                  >
                    <div className="mx-auto w-px h-full group-hover:bg-blue-400/60" />
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((req) => (
            <tr
              key={req.id}
              onClick={() => onSelect(req.id)}
              className={`border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/50 ${selectedId === req.id ? 'bg-gray-800' : ''}`}
            >
              {COLUMNS.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-1.5 truncate ${col.align === 'right' ? 'text-right' : ''}`}
                >
                  {renderCell(req, col.key)}
                </td>
              ))}
            </tr>
          ))}
          {requests.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-gray-600">
                No requests captured yet. Configure your app to use the proxy.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
