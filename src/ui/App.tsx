import { useState, useMemo, useCallback } from 'react';
import { Controls } from './components/Controls.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { TrafficList } from './components/TrafficList.tsx';
import { RequestDetail } from './components/RequestDetail.tsx';
import { ResizeHandle } from './components/ResizeHandle.tsx';
import { useSSE } from './api.ts';

const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 900;
const DEFAULT_PANEL_WIDTH = 500;

export function App() {
  const { requests: liveRequests, statusEvent, clearLocal } = useSSE(500);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const filteredRequests = useMemo(() => {
    const status = filterStatus;
    const method = filterMethod;
    const search = filterSearch.toLowerCase();

    if (!status && !method && !search) return liveRequests;

    return liveRequests.filter((r) => {
      if (status && String(r.status) !== status) return false;
      if (method && r.method !== method) return false;
      if (search && !r.url.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [liveRequests, filterStatus, filterMethod, filterSearch]);

  const handleClear = useCallback(() => { setSelectedId(null); clearLocal(); }, [clearLocal]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id);
  }, []);

  const handleResize = useCallback((delta: number) => {
    setPanelWidth(prev => Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, prev + delta)));
  }, []);

  const clearFilters = useCallback(() => {
    setFilterStatus('');
    setFilterMethod('');
    setFilterSearch('');
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <Controls onClear={handleClear} statusEvent={statusEvent} />
      <FilterBar
        status={filterStatus} method={filterMethod} search={filterSearch}
        onStatusChange={setFilterStatus}
        onMethodChange={setFilterMethod} onSearchChange={setFilterSearch}
        onClearFilters={clearFilters}
        matchCount={filteredRequests.length} totalCount={liveRequests.length}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 min-w-0">
          <TrafficList requests={filteredRequests} selectedId={selectedId} onSelect={handleSelect} />
        </div>
        {selectedId && (
          <>
            <div className="hidden md:flex">
              <ResizeHandle onResize={handleResize} />
            </div>
            <div className="detail-panel fixed inset-0 z-50 md:static md:inset-auto md:z-auto md:flex-shrink-0 md:overflow-hidden" style={{ width: panelWidth }}>
              <RequestDetail requestId={selectedId} onClose={() => setSelectedId(null)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
