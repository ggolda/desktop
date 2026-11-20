#!/usr/bin/env node
/**
 * List composited layers of the main window (each has its own GPU tiles/shared images).
 *   node scripts/bench/layers.mjs [--fixture .bench/fixtures/typical] [--scenario S2] [--settle 45]
 *   node scripts/bench/layers.mjs --analyze <layers-*.json>
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function record() {
  const fixture = path.resolve(repo, opt('fixture', '.bench/fixtures/typical'));
  const runDir = path.join(repo, '.bench', 'runs', 'layers');
  const outDir = path.join(runDir, 'out');
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(fixture, path.join(runDir, 'appdata'), { recursive: true });
  const app = spawn(
    path.join(repo, 'node_modules/electron/dist/electron.exe'),
    [repo, '--skip-update', '--local-bundles'],
    {
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        SLOBS_CACHE_DIR: path.join(runDir, 'appdata'),
        SLOBS_BENCH_OUT: outDir,
        SLOBS_BENCH_SCENARIO: opt('scenario', 'S2'),
      },
      stdio: 'ignore',
    },
  );
  const events = () => {
    try {
      return fs
        .readFileSync(path.join(outDir, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l));
    } catch (e) {
      return [];
    }
  };
  const wait = async (ev, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const all = events();
      const err = all.find(e => e.event === 'layers-error');
      if (err) throw new Error(err.message);
      const hit = all.find(e => e.event === ev);
      if (hit) return hit;
      await sleep(250);
    }
    throw new Error('timeout ' + ev);
  };
  let file = null;
  try {
    await wait('main-window-shown', 240000);
    await sleep(Number(opt('settle', 45)) * 1000);
    fs.writeFileSync(path.join(outDir, 'control'), 'layers main');
    file = (await wait('layers-done', 60000)).file;
  } finally {
    fs.writeFileSync(path.join(outDir, 'control'), 'quit');
    await sleep(8000);
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' });
    } catch (e) {}
  }
  return file;
}

function analyze(file) {
  const layers = JSON.parse(fs.readFileSync(file, 'utf8'));
  const drawing = layers.filter(l => l.drawsContent);
  const area = l => (l.w * l.h) / 1e6;
  const totalArea = drawing.reduce((s, l) => s + area(l), 0);
  console.log(
    `layers: ${layers.length} total, ${drawing.length} draw content, ${totalArea.toFixed(2)} Mpx (CSS px) of content`,
  );
  const reasons = {};
  for (const l of drawing)
    for (const r of l.reasons.length ? l.reasons : ['(root/none)'])
      reasons[r] = (reasons[r] || 0) + 1;
  console.log(
    'compositing reasons (drawing layers):',
    Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ×${v}`)
      .join(', '),
  );
  console.log('largest drawing layers:');
  for (const l of [...drawing].sort((a, b) => area(b) - area(a)).slice(0, 30))
    console.log(
      `  ${String(l.w).padStart(5)}×${String(l.h).padEnd(5)} ${area(l).toFixed(3).padStart(6)} Mpx paints=${String(l.paintCount).padStart(4)}  ${l.reasons.join(',') || '-'}  ${l.node}`,
    );
}

const file = argv.includes('--analyze') ? opt('analyze') : await record();
if (file) analyze(file);
