// Runs the API (:4000) and the web app (:5173) together, with prefixed output. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', color: '\x1b[33m', args: ['run', 'dev', '-w', 'apps/api'] },
  { name: 'web', color: '\x1b[36m', args: ['run', 'dev', '-w', 'apps/web'] },
].map(({ name, color, args }) => {
  // Run npm's own CLI through this Node binary: no shell, so nothing is re-parsed.
  const npmCli = process.env.npm_execpath;
  const p = npmCli
    ? spawn(process.execPath, [npmCli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const out = (buf) =>
    buf
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((l) => console.log(`${color}[${name}]\x1b[0m ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => {
    console.log(`${color}[${name}]\x1b[0m exited with ${code}`);
    stop(code ?? 0);
  });
  return p;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log('\n  Shastra Connect → http://localhost:5173  (API on :4100)\n');
