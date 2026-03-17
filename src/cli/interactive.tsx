import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { loadConfig } from '../server/config.js';
import { RoxyProxyServer } from '../server/index.js';
import { Database } from '../storage/db.js';
import { enableSystemProxy, disableSystemProxy, installCaCert } from './system-proxy.js';
import type { RequestRecord } from '../shared/types.js';

// ── API helpers ──

function apiGet(port: number, urlPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}

function apiPost(port: number, urlPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      res.resume();
      res.on('end', () => res.statusCode === 200 ? resolve() : reject());
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Screens ──

type Screen = 'menu' | 'status' | 'requests' | 'request-detail' | 'starting' | 'stopping';

function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">roxyproxy</Text>
      <Text dimColor>─────────────────────────────────</Text>
    </Box>
  );
}

function StatusView({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet(8081, '/api/status')
      .then(body => setStatus(JSON.parse(body)))
      .catch(() => setError('Proxy is not running.'));
  }, []);

  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });

  if (error) return <Text color="red">  {error}</Text>;
  if (!status) return <Text dimColor>  Loading...</Text>;

  const running = status.running as boolean;
  const bytes = status.dbSizeBytes as number;
  const size = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

  return (
    <Box flexDirection="column">
      <Box><Text color={running ? 'green' : 'red'}>● </Text><Text bold>Status     </Text><Text color={running ? 'green' : 'red'}>{running ? 'Running' : 'Stopped'}</Text></Box>
      <Box><Text>  </Text><Text dimColor>Proxy      </Text><Text>port </Text><Text color="cyan">{String(status.proxyPort)}</Text></Box>
      <Box><Text>  </Text><Text dimColor>Requests   </Text><Text bold>{String(status.requestCount)}</Text></Box>
      <Box><Text>  </Text><Text dimColor>DB Size    </Text><Text>{size}</Text></Box>
      <Box marginTop={1}><Text dimColor>Press Enter or Esc to go back</Text></Box>
    </Box>
  );
}

function RequestsView({ onBack, onSelect }: { onBack: () => void; onSelect: (id: string) => void }) {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const config = loadConfig();
    let db: Database;
    try {
      db = new Database(config.dbPath);
      const result = db.query({ limit: 20 });
      setRequests(result.data);
      db.close();
    } catch {
      setError('Could not read database.');
    }
  }, []);

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow && cursor > 0) setCursor(c => c - 1);
    if (key.downArrow && cursor < requests.length - 1) setCursor(c => c + 1);
    if (key.return && requests[cursor]) onSelect(requests[cursor].id);
  });

  if (error) return <Text color="red">  {error}</Text>;
  if (requests.length === 0) return (
    <Box flexDirection="column">
      <Text dimColor>  No requests captured yet.</Text>
      <Box marginTop={1}><Text dimColor>Press Esc to go back</Text></Box>
    </Box>
  );

  const methodColor = (m: string) => {
    if (m === 'GET') return 'blue';
    if (m === 'POST') return 'green';
    if (m === 'PUT') return 'yellow';
    if (m === 'DELETE') return 'red';
    return 'white';
  };

  const statusColor = (s: number | null) => {
    if (!s) return 'gray';
    if (s < 300) return 'green';
    if (s < 400) return 'yellow';
    if (s < 500) return 'magenta';
    return 'red';
  };

  return (
    <Box flexDirection="column">
      <Box><Text dimColor>{'  METHOD  STATUS  HOST                     PATH                      TIME'}</Text></Box>
      <Text dimColor>{'  ' + '─'.repeat(70)}</Text>
      {requests.map((r, i) => (
        <Box key={r.id}>
          <Text>{i === cursor ? '▸ ' : '  '}</Text>
          <Text color={methodColor(r.method)}>{r.method.padEnd(8)}</Text>
          <Text color={statusColor(r.status)}>{String(r.status ?? '-').padEnd(8)}</Text>
          <Text>{r.host.slice(0, 24).padEnd(25)}</Text>
          <Text dimColor>{r.path.slice(0, 25).padEnd(26)}</Text>
          <Text dimColor>{r.duration ? `${r.duration}ms` : '-'}</Text>
        </Box>
      ))}
      <Box marginTop={1}><Text dimColor>↑↓ navigate  Enter select  Esc back</Text></Box>
    </Box>
  );
}

function RequestDetailView({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  const [record, setRecord] = useState<RequestRecord | null>(null);

  useEffect(() => {
    const config = loadConfig();
    try {
      const db = new Database(config.dbPath);
      setRecord(db.getById(requestId));
      db.close();
    } catch {}
  }, [requestId]);

  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });

  if (!record) return <Text dimColor>  Loading...</Text>;

  const parseHeaders = (raw: string | null): Record<string, string> => {
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  };

  const reqHeaders = parseHeaders(record.request_headers);
  const resHeaders = parseHeaders(record.response_headers);

  return (
    <Box flexDirection="column">
      <Box><Text dimColor>URL       </Text><Text color="cyan">{record.url}</Text></Box>
      <Box><Text dimColor>Method    </Text><Text color="blue">{record.method}</Text></Box>
      <Box><Text dimColor>Status    </Text><Text>{String(record.status)}</Text></Box>
      <Box><Text dimColor>Duration  </Text><Text>{record.duration}ms</Text></Box>
      <Box><Text dimColor>Protocol  </Text><Text>{record.protocol}</Text></Box>
      <Box><Text dimColor>Time      </Text><Text>{new Date(record.timestamp).toISOString()}</Text></Box>

      <Box marginTop={1}><Text bold>Request Headers</Text></Box>
      {Object.entries(reqHeaders).map(([k, v]) => (
        <Box key={k}><Text color="magenta">  {k}</Text><Text dimColor>: </Text><Text>{v}</Text></Box>
      ))}

      <Box marginTop={1}><Text bold>Response Headers</Text></Box>
      {Object.entries(resHeaders).map(([k, v]) => (
        <Box key={k}><Text color="magenta">  {k}</Text><Text dimColor>: </Text><Text>{v}</Text></Box>
      ))}

      {record.response_body && (
        <>
          <Box marginTop={1}><Text bold>Response Body</Text></Box>
          <Text>{formatBodyStr(record.response_body, record.content_type)}</Text>
        </>
      )}

      <Box marginTop={1}><Text dimColor>Press Enter or Esc to go back</Text></Box>
    </Box>
  );
}

function formatBodyStr(body: Buffer | null, contentType: string | null): string {
  if (!body) return '(empty)';
  const str = Buffer.isBuffer(body) ? body.toString('utf-8') : String(body);
  if (contentType?.includes('json')) {
    try { return JSON.stringify(JSON.parse(str), null, 2); } catch {}
  }
  return str.slice(0, 500);
}

// ── Main App ──

function App() {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('menu');
  const [message, setMessage] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [server, setServer] = useState<RoxyProxyServer | null>(null);

  const menuItems = [
    { label: 'Start proxy', value: 'start' },
    { label: 'Stop proxy', value: 'stop' },
    { label: 'Status', value: 'status' },
    { label: 'View requests', value: 'requests' },
    { label: 'Clear traffic', value: 'clear' },
    { label: 'Open web UI', value: 'open-ui' },
    { label: 'Trust CA certificate', value: 'trust-ca' },
    { label: 'Set system proxy', value: 'proxy-on' },
    { label: 'Remove system proxy', value: 'proxy-off' },
    { label: 'Quit', value: 'quit' },
  ];

  const handleSelect = async (item: { value: string }) => {
    setMessage('');
    switch (item.value) {
      case 'start': {
        setScreen('starting');
        try {
          const config = loadConfig();
          const pidPath = path.join(os.homedir(), '.roxyproxy', 'pid');
          fs.mkdirSync(path.dirname(pidPath), { recursive: true });
          fs.writeFileSync(pidPath, process.pid.toString());
          const s = new RoxyProxyServer(config);
          const ports = await s.start();
          setServer(s);
          setMessage(`Proxy running on :${ports.proxyPort}, UI on :${ports.uiPort}`);
        } catch (e) {
          setMessage(`Failed: ${(e as Error).message}`);
        }
        setScreen('menu');
        break;
      }
      case 'stop': {
        setScreen('stopping');
        try {
          if (server) {
            await server.stop();
            setServer(null);
            setMessage('Proxy stopped.');
          } else {
            await apiPost(8081, '/api/shutdown');
            setMessage('Server shutting down.');
          }
        } catch {
          setMessage('Proxy is not running.');
        }
        setScreen('menu');
        break;
      }
      case 'status':
        setScreen('status');
        break;
      case 'requests':
        setScreen('requests');
        break;
      case 'clear': {
        try {
          await new Promise<void>((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port: 8081, path: '/api/requests', method: 'DELETE' }, (res) => {
              res.resume();
              res.on('end', () => res.statusCode === 200 ? resolve() : reject());
            });
            req.on('error', reject);
            req.end();
          });
          setMessage('Traffic cleared.');
        } catch {
          // Try direct DB clear
          try {
            const config = loadConfig();
            const db = new Database(config.dbPath);
            db.deleteAll();
            db.close();
            setMessage('Traffic cleared.');
          } catch {
            setMessage('Could not clear traffic.');
          }
        }
        break;
      }
      case 'open-ui': {
        const uiUrl = 'http://127.0.0.1:8081';
        const cmd = os.platform() === 'darwin' ? 'open' : os.platform() === 'win32' ? 'start' : 'xdg-open';
        execFile(cmd, [uiUrl], () => {});
        setMessage(`Opening ${uiUrl}`);
        break;
      }
      case 'trust-ca': {
        setMessage('Installing CA certificate...');
        const caResult = await installCaCert();
        setMessage(caResult.message);
        break;
      }
      case 'proxy-on': {
        setMessage('Configuring system proxy...');
        const onResult = await enableSystemProxy();
        setMessage(onResult.message);
        break;
      }
      case 'proxy-off': {
        setMessage('Removing system proxy...');
        const offResult = await disableSystemProxy();
        setMessage(offResult.message);
        break;
      }
      case 'quit':
        if (server) {
          await server.stop();
        }
        exit();
        break;
    }
  };

  if (screen === 'status') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <StatusView onBack={() => setScreen('menu')} />
      </Box>
    );
  }

  if (screen === 'requests') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <RequestsView
          onBack={() => setScreen('menu')}
          onSelect={(id) => { setSelectedRequestId(id); setScreen('request-detail'); }}
        />
      </Box>
    );
  }

  if (screen === 'request-detail' && selectedRequestId) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <RequestDetailView requestId={selectedRequestId} onBack={() => setScreen('requests')} />
      </Box>
    );
  }

  if (screen === 'starting') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Text color="cyan">Starting proxy...</Text>
      </Box>
    );
  }

  if (screen === 'stopping') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Text color="yellow">Stopping proxy...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header />
      {server && <Box marginBottom={1}><Text color="green">● Proxy running</Text></Box>}
      <SelectInput items={menuItems} onSelect={handleSelect} />
      {message && <Box marginTop={1}><Text color="cyan">  {message}</Text></Box>}
    </Box>
  );
}

export async function launchInteractive(): Promise<void> {
  render(<App />);
}
