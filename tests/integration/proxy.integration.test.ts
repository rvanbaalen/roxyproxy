import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { LaurelProxyServer } from '../../src/server/index.js';
import { DEFAULT_CONFIG } from '../../src/shared/types.js';
import type { Config } from '../../src/shared/types.js';

describe('Laurel Proxy Integration', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let proxy: LaurelProxyServer;
  let proxyPort: number;
  let uiPort: number;
  let tmpDir: string;

  beforeAll(async () => {
    targetServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: req.url }));
    });
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as net.AddressInfo).port;
        resolve();
      });
    });

    tmpDir = path.join(os.tmpdir(), `laurel-proxy-integration-${randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const config: Config = {
      ...DEFAULT_CONFIG,
      proxyPort: 0,
      uiPort: 0,
      dbPath: path.join(tmpDir, 'data.db'),
    };
    proxy = new LaurelProxyServer(config);
    const ports = await proxy.start();
    proxyPort = ports.proxyPort;
    uiPort = ports.uiPort;
  });

  afterAll(async () => {
    await proxy.stop();
    targetServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('proxies HTTP request and stores it', async () => {
    const url = `http://127.0.0.1:${targetPort}/test-path`;
    await httpGet(url, proxyPort);

    await new Promise(r => setTimeout(r, 300));

    const apiRes = await httpGet(`http://127.0.0.1:${uiPort}/api/requests`, 0);
    const body = JSON.parse(apiRes.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].path).toBe('/test-path');
    expect(body.data[0].status).toBe(200);
  });

  it('serves status endpoint', async () => {
    const res = await httpGet(`http://127.0.0.1:${uiPort}/api/status`, 0);
    const status = JSON.parse(res.body);
    expect(status.running).toBe(true);
  });
});

function httpGet(url: string, proxyPort: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = proxyPort > 0
      ? { host: '127.0.0.1', port: proxyPort, path: url, method: 'GET' }
      : { host: parsed.hostname, port: parseInt(parsed.port), path: parsed.pathname, method: 'GET' };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
