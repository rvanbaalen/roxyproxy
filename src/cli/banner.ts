import pc from 'picocolors';

export function printBanner(): void {
  console.log('');
  console.log(`  ${pc.bold(pc.cyan('roxyproxy'))} ${pc.dim('v0.1.0')}`);
  console.log(pc.dim('  ' + '─'.repeat(40)));
  console.log('');
}

export function printStartInfo(proxyPort: number, uiPort: number): void {
  console.log(`  ${pc.green('●')} Proxy    ${pc.cyan(`http://127.0.0.1:${proxyPort}`)}`);
  console.log(`  ${pc.green('●')} Web UI   ${pc.cyan(`http://127.0.0.1:${uiPort}`)}`);
  console.log('');
  console.log(pc.dim('  Ctrl+C to stop'));
  console.log('');
}

export function printSuccess(msg: string): void {
  console.log(`  ${pc.green('✔')} ${msg}`);
}

export function printError(msg: string): void {
  console.log(`  ${pc.red('✖')} ${msg}`);
}

export function printInfo(msg: string): void {
  console.log(`  ${pc.cyan('›')} ${msg}`);
}

export function printWarn(msg: string): void {
  console.log(`  ${pc.yellow('!')} ${msg}`);
}
