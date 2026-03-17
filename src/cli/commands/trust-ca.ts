import type { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function registerTrustCa(program: Command): void {
  program
    .command('trust-ca')
    .description('Show CA certificate path and trust instructions')
    .action(() => {
      const certPath = path.join(os.homedir(), '.roxyproxy', 'ca', 'ca.crt');

      if (!fs.existsSync(certPath)) {
        console.error('CA certificate not found. Start the proxy first to generate it.');
        process.exit(1);
      }

      console.log(`CA Certificate: ${certPath}`);
      console.log('');
      console.log('To trust this certificate:');
      console.log('');
      console.log('macOS:');
      console.log(`  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`);
      console.log('');
      console.log('Linux (Debian/Ubuntu):');
      console.log(`  sudo cp "${certPath}" /usr/local/share/ca-certificates/roxyproxy.crt`);
      console.log('  sudo update-ca-certificates');
      console.log('');
      console.log('Firefox:');
      console.log('  Settings > Privacy & Security > Certificates > Import');
    });
}
