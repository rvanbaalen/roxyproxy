import { execFile } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, (error, stdout) => {
      resolve({ code: error ? 1 : 0, stdout: stdout?.trim() || '' });
    });
  });
}

interface PortProcess {
  pid: number;
  isRoxyProxy: boolean;
}

/**
 * Find which process is using a port. Returns null if detection fails.
 */
async function getProcessOnPort(port: number): Promise<PortProcess | null> {
  const result = await run('lsof', ['-ti', `:${port}`]);
  if (result.code !== 0 || !result.stdout) return null;

  const pid = parseInt(result.stdout.split('\n')[0], 10);
  if (isNaN(pid)) return null;

  const ps = await run('ps', ['-p', String(pid), '-o', 'command=']);
  const isRoxyProxy = ps.stdout.includes('roxyproxy');
  return { pid, isRoxyProxy };
}

/**
 * Try to gracefully shut down a roxyproxy instance on a given port
 * by calling its shutdown API endpoint.
 */
function shutdownViaApi(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/shutdown', method: 'POST', timeout: 2000 },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode === 200)); },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function waitForPortFree(port: number, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const socket = new net.Socket();
      socket.once('connect', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) { resolve(false); return; }
        setTimeout(check, 200);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(true); // port is free
      });
      socket.connect(port, '127.0.0.1');
    };
    check();
  });
}

export interface ListenResult {
  port: number;
  killedPrevious: boolean;
}

/**
 * Try to listen on a port. If EADDRINUSE:
 * 1. Check if it's another roxyproxy — if so, shut it down and retry
 * 2. Otherwise, try the next port (up to maxRetries)
 */
export function listenWithRetry(
  server: http.Server,
  port: number,
  maxRetries = 10,
): Promise<ListenResult> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let killedPrevious = false;

    const tryPort = (p: number) => {
      const onError = async (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') { reject(err); return; }

        // First attempt on the original port — check if it's another roxyproxy
        if (p === port && !killedPrevious) {
          const proc = await getProcessOnPort(p);
          if (proc?.isRoxyProxy) {
            const shutdown = await shutdownViaApi(p);
            if (shutdown) {
              const freed = await waitForPortFree(p);
              if (freed) {
                killedPrevious = true;
                server.removeListener('error', onError);
                tryPort(p); // retry same port
                return;
              }
            }
            // API shutdown failed — try SIGTERM
            try { process.kill(proc.pid, 'SIGTERM'); } catch {}
            const freed = await waitForPortFree(p, 2000);
            if (freed) {
              killedPrevious = true;
              server.removeListener('error', onError);
              tryPort(p);
              return;
            }
          }
        }

        if (attempt < maxRetries) {
          attempt++;
          server.removeListener('error', onError);
          tryPort(p + 1);
        } else {
          reject(new Error(`Ports ${port}-${p} are all in use`));
        }
      };
      server.once('error', onError);
      server.listen(p, () => {
        server.removeListener('error', onError);
        const addr = server.address() as net.AddressInfo;
        resolve({ port: addr.port, killedPrevious });
      });
    };
    tryPort(port);
  });
}
