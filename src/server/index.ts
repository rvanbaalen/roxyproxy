import express from 'express';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import type { Config } from '../shared/types.js';
import { Database } from '../storage/db.js';
import { CertificateAuthority } from './ssl.js';
import { ProxyServer } from './proxy.js';
import { EventManager } from './events.js';
import { Cleanup } from '../storage/cleanup.js';
import { createApiRouter } from './api.js';
import type { ProxyControl } from './api.js';

export class RoxyProxyServer {
  private db: Database;
  private ca: CertificateAuthority;
  private proxy: ProxyServer;
  private events: EventManager;
  private cleanup: Cleanup;
  private apiServer: http.Server | null = null;
  private connections: Set<net.Socket> = new Set();
  private proxyRunning = false;
  private actualProxyPort = 0;

  constructor(private config: Config) {
    const caDir = path.join(path.dirname(config.dbPath), 'ca');
    this.db = new Database(config.dbPath);
    this.ca = new CertificateAuthority(caDir, config.certCacheSize);
    this.events = new EventManager();
    this.proxy = new ProxyServer(this.db, this.ca, this.events, config);
    this.cleanup = new Cleanup(this.db, config);
  }

  async start(): Promise<{ proxyPort: number; uiPort: number }> {
    this.ca.init();
    this.actualProxyPort = await this.proxy.start();
    this.proxyRunning = true;
    this.cleanup.start();

    const app = express();
    app.use(express.json());

    const proxyControl: ProxyControl = {
      getProxyRunning: () => this.proxyRunning,
      getProxyPort: () => this.actualProxyPort,
      startProxy: async () => {
        if (!this.proxyRunning) {
          this.actualProxyPort = await this.proxy.start();
          this.proxyRunning = true;
        }
      },
      stopProxy: async () => {
        if (this.proxyRunning) {
          await this.proxy.stop();
          this.proxyRunning = false;
        }
      },
    };

    app.use('/api', createApiRouter(this.db, this.events, proxyControl));

    const uiDistPath = path.join(import.meta.dirname, '..', '..', 'dist', 'ui');
    app.use(express.static(uiDistPath));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(uiDistPath, 'index.html'));
    });

    const uiPort = await new Promise<number>((resolve) => {
      this.apiServer = app.listen(this.config.uiPort, () => {
        const addr = this.apiServer!.address() as net.AddressInfo;
        resolve(addr.port);
      });
      this.apiServer!.on('connection', (socket) => {
        this.connections.add(socket);
        socket.on('close', () => this.connections.delete(socket));
      });
    });

    return { proxyPort: this.actualProxyPort, uiPort };
  }

  get isProxyRunning(): boolean {
    return this.proxyRunning;
  }

  async stop(): Promise<void> {
    this.cleanup.stop();
    this.events.stop();
    if (this.proxyRunning) {
      await this.proxy.stop();
      this.proxyRunning = false;
    }
    if (this.apiServer) {
      // Destroy lingering connections (SSE keep-alive, etc.)
      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
      await new Promise<void>((resolve) => this.apiServer!.close(() => resolve()));
    }
    this.db.close();
  }
}
