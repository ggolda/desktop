#!/usr/bin/env node
// Per-process allocator breakdown from a Chromium memory-infra trace.
//   node scripts/bench/memdump.mjs <trace.json> [pid=label ...]   (labels optional)
// Without labels, processes are named by their trace process_name metadata.
import fs from 'node:fs';
const [file, ...labelArgs] = process.argv.slice(2);
const labels = new Map(labelArgs.map(a => { const [p, l] = a.split('='); return [Number(p), l]; }));
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const evs = Array.isArray(raw) ? raw : raw.traceEvents;
const names = new Map();
for (const e of evs) if (e.ph === 'M' && e.name === 'process_name') names.set(e.pid, e.args.name);
for (const e of evs) if (e.ph === 'M' && e.name === 'process_labels' && e.args?.labels) names.set(e.pid, (names.get(e.pid) || '') + ' ' + e.args.labels);
const dumps = new Map();
for (const e of evs) {
  if (e.ph !== 'v' || !e.args?.dumps) continue;
  const c = dumps.get(e.pid) || {};
  if (e.args.dumps.allocators) c.a = e.args.dumps.allocators;
  if (e.args.dumps.process_totals) c.t = e.args.dumps.process_totals;
  dumps.set(e.pid, c);
}
const mb = v => (v ? parseInt(v, 16) / 1048576 : 0);
const want = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
for (const [pid, d] of dumps) {
  const l = labels.get(pid) || names.get(pid) || 'pid ' + pid;
  if (want && !want.test(l)) continue;
  const t = d.t || {};
  console.log(`\n[${l}] (pid ${pid}) private_footprint=${mb(t.private_footprint_bytes).toFixed(1)}MB`);
  const depth = Number(process.env.DEPTH || 2);
  const rows = Object.entries(d.a || {})
    .filter(([n]) => n.split('/').length <= depth)
    .map(([n, a]) => [n, mb(a.attrs?.size?.value)])
    .filter(([, v]) => v >= 0.5)
    .sort((x, y) => y[1] - x[1])
    .slice(0, Number(process.env.TOP || 20));
  for (const [n, v] of rows) console.log(`   ${v.toFixed(1).padStart(7)} MB  ${n}`);
}
