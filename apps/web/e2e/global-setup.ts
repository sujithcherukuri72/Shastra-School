import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fresh demo school before every run, so results are repeatable. */
export default function globalSetup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  execSync('npm run seed --silent', { cwd: root, stdio: 'inherit' });
}
