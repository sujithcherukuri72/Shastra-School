// Runs the API (:4100) and the web app (:5173) together with prefixed output.
// If either one stops unexpectedly it is restarted (up to 5 times a minute), so the website
// never keeps running without its server. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const services = [
  { name: 'api', color: '\x1b[33m', args: ['run', 'dev', '-w', 'apps/api'] },
  { name: 'web', color: '\x1b[36m', args: ['run', 'dev', '-w', 'apps/web'] },
];
const children = new Map();
let stopping = false;

function log(svc, line) {
  console.log(`${svc.color}[${svc.name}]\x1b[0m ${line}`);
}

function start(svc) {
  const p = npmCli
    ? spawn(process.execPath, [npmCli, ...svc.args], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', svc.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const out = (buf) => buf.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log(svc, l));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => {
    children.delete(svc.name);
    if (stopping) return;
    const now = Date.now();
    svc.restarts = (svc.restarts ?? []).filter((t) => now - t < 60_000);
    if (svc.restarts.length >= 5) {
      log(svc, `\x1b[31mstopped ${svc.restarts.length + 1} times in a minute (exit ${code}) - giving up. Check the messages above.\x1b[0m`);
      return stop(1);
    }
    svc.restarts.push(now);
    log(svc, `\x1b[31mstopped (exit ${code}) - restarting in 2 s…\x1b[0m`);
    setTimeout(() => !stopping && start(svc), 2000);
  });
  children.set(svc.name, p);
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const p of children.values()) p.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

services.forEach(start);
console.log('\n  Shastra Connect → http://localhost:5173  (API on :4100)\n');
