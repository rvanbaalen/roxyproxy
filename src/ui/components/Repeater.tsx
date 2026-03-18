import { useState, useCallback, useEffect } from 'react';
import { replayRequest } from '../api.ts';
import type { ReplayResponse } from '../api.ts';

export interface RepeaterTabData {
  id: string;
  name: string;
  request: { url: string; method: string; headers: string; body: string };
  response: ReplayResponse | null;
  error: string | null;
  loading: boolean;
}

interface RepeaterProps {
  tabs: RepeaterTabData[];
  activeTabId: string | null;
  onTabsChange: (tabs: RepeaterTabData[]) => void;
  onActiveTabChange: (id: string | null) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

let tabCounter = 0;

export function createTab(init?: { url: string; method: string; headers: string; body: string }): RepeaterTabData {
  tabCounter++;
  let name = `New Request ${tabCounter}`;
  if (init) {
    try { name = new URL(init.url).hostname || name; } catch {}
  }
  return {
    id: crypto.randomUUID(),
    name,
    request: init || { url: '', method: 'GET', headers: '', body: '' },
    response: null,
    error: null,
    loading: false,
  };
}

function parseHeadersText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    headers[key] = value;
  }
  return headers;
}

export function Repeater({ tabs, activeTabId, onTabsChange, onActiveTabChange }: RepeaterProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  const updateTab = useCallback((id: string, updates: Partial<RepeaterTabData>) => {
    onTabsChange(tabs.map((t) => t.id === id ? { ...t, ...updates } : t));
  }, [tabs, onTabsChange]);

  const updateRequest = useCallback((id: string, field: string, value: string) => {
    onTabsChange(tabs.map((t) =>
      t.id === id ? { ...t, request: { ...t.request, [field]: value } } : t
    ));
  }, [tabs, onTabsChange]);

  const closeTab = useCallback((id: string) => {
    const newTabs = tabs.filter((t) => t.id !== id);
    onTabsChange(newTabs);
    if (activeTabId === id) {
      onActiveTabChange(newTabs.length > 0 ? newTabs[0].id : null);
    }
  }, [tabs, activeTabId, onTabsChange, onActiveTabChange]);

  const addTab = useCallback(() => {
    const tab = createTab();
    onTabsChange([...tabs, tab]);
    onActiveTabChange(tab.id);
  }, [tabs, onTabsChange, onActiveTabChange]);

  const sendRequest = useCallback(async () => {
    if (!activeTab || activeTab.loading) return;
    updateTab(activeTab.id, { loading: true, error: null });
    try {
      const headers = parseHeadersText(activeTab.request.headers);
      const body = activeTab.request.body
        ? btoa(activeTab.request.body)
        : undefined;
      const result = await replayRequest({
        url: activeTab.request.url,
        method: activeTab.request.method,
        headers,
        body,
      });
      updateTab(activeTab.id, { response: result, loading: false });
    } catch (err) {
      updateTab(activeTab.id, { error: (err as Error).message, loading: false });
    }
  }, [activeTab, updateTab]);

  // Cmd/Ctrl+Enter to send
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        sendRequest();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sendRequest]);

  if (tabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <p className="mb-4">No repeater tabs open</p>
        <button onClick={addTab} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">
          New Request
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-800 bg-gray-900 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-2 text-sm cursor-pointer border-r border-gray-800 shrink-0 ${
              tab.id === activeTabId ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            onClick={() => onActiveTabChange(tab.id)}
          >
            <span className="truncate max-w-32">{tab.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="text-gray-600 hover:text-gray-300 ml-1"
            >&times;</button>
          </div>
        ))}
        <button onClick={addTab} className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm shrink-0">+</button>
      </div>

      {/* Split pane */}
      {activeTab && (
        <div className="flex flex-1 overflow-hidden">
          {/* Request editor */}
          <div className="flex flex-col w-1/2 border-r border-gray-800 overflow-auto">
            <div className="flex gap-2 p-3 border-b border-gray-800">
              <select
                value={activeTab.request.method}
                onChange={(e) => updateRequest(activeTab.id, 'method', e.target.value)}
                className="bg-gray-800 text-white px-2 py-1.5 rounded text-sm border border-gray-700"
              >
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input
                type="text"
                value={activeTab.request.url}
                onChange={(e) => updateRequest(activeTab.id, 'url', e.target.value)}
                placeholder="https://example.com/api/endpoint"
                className="flex-1 bg-gray-800 text-white px-3 py-1.5 rounded text-sm border border-gray-700 font-mono"
              />
              <button
                onClick={sendRequest}
                disabled={activeTab.loading || !activeTab.request.url}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-sm font-medium shrink-0"
              >
                {activeTab.loading ? 'Sending...' : 'Send'}
              </button>
            </div>
            <div className="flex flex-col flex-1 p-3 gap-3">
              <div className="flex flex-col flex-1 min-h-0">
                <label className="text-xs font-semibold text-gray-500 uppercase mb-1">Headers</label>
                <textarea
                  value={activeTab.request.headers}
                  onChange={(e) => updateRequest(activeTab.id, 'headers', e.target.value)}
                  placeholder={"Content-Type: application/json\nAuthorization: Bearer token"}
                  className="flex-1 bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded border border-gray-800 resize-none"
                />
              </div>
              <div className="flex flex-col flex-1 min-h-0">
                <label className="text-xs font-semibold text-gray-500 uppercase mb-1">Body</label>
                <textarea
                  value={activeTab.request.body}
                  onChange={(e) => updateRequest(activeTab.id, 'body', e.target.value)}
                  placeholder='{"key": "value"}'
                  className="flex-1 bg-gray-950 text-gray-300 font-mono text-xs p-3 rounded border border-gray-800 resize-none"
                />
              </div>
            </div>
          </div>

          {/* Response viewer */}
          <div className="flex flex-col w-1/2 overflow-auto">
            {activeTab.loading && (
              <div className="flex items-center justify-center h-full text-gray-500">
                Sending request...
              </div>
            )}
            {activeTab.error && !activeTab.loading && (
              <div className="flex items-center justify-center h-full text-red-400 p-4 text-center">
                {activeTab.error}
              </div>
            )}
            {activeTab.response && !activeTab.loading && (
              <ResponseView response={activeTab.response} />
            )}
            {!activeTab.response && !activeTab.loading && !activeTab.error && (
              <div className="flex items-center justify-center h-full text-gray-600">
                Send a request to see the response
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResponseView({ response }: { response: ReplayResponse }) {
  const statusColor = response.status < 300 ? 'text-green-400' :
    response.status < 400 ? 'text-yellow-400' :
    response.status < 500 ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-4 px-3 py-2 text-xs text-gray-500 border-b border-gray-800">
        <span className={`font-mono font-bold ${statusColor}`}>{response.status}</span>
        <span>Duration: {response.duration}ms</span>
        <span>Size: {response.size}B</span>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Headers</h3>
          <div className="font-mono text-xs space-y-0.5">
            {Object.entries(response.headers).map(([key, value]) => {
              const vals = Array.isArray(value) ? value : [value];
              return vals.map((v, i) => (
                <div key={`${key}-${i}`}>
                  <span className="text-purple-400">{key}</span>
                  <span className="text-gray-600">: </span>
                  <span className="text-gray-300">{v}</span>
                </div>
              ));
            })}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Body</h3>
          <pre className="font-mono text-xs text-gray-300 bg-gray-950 rounded p-3 overflow-auto whitespace-pre-wrap">
            {formatResponseBody(response.body)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function formatResponseBody(base64Body: string): string {
  try {
    const raw = atob(base64Body);
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch {}
    return raw;
  } catch {
    return base64Body;
  }
}
