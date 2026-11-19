// node shot.mjs <fw> <page> : screenshot of a page (results/shots/<fw>-<page>.png) for a visual check
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [fw, page = 'editor'] = process.argv.slice(2);
const file = path.join(here, 'results', 'shots', `${fw}-${page}.png`);
const app = spawn(path.join(here, '../../node_modules/electron/dist/electron.exe'), [path.join(here, 'electron/main.cjs'), '--fw', fw, '--page', page], {
  env: { ...process.env, BENCH_SCENARIO: 'idle', BENCH_SCREENSHOT: file, BENCH_ON_TOP: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
const t = setTimeout(() => { console.log('timeout'); kill(); }, 20000);
function kill() { try { execFileSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' }); } catch (e) {} clearTimeout(t); }
readline.createInterface({ input: app.stdout }).on('line', l => { console.log(l); if (l.includes('"screenshot"')) kill(); });
