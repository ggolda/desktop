/* global process, console */
// Right-clicks the preview with real OS input and captures the desktop while the native menu is open.
//   node scripts/overlay/menu-shot.mjs <out.png> <x> <y>      (client px; run after start-new.sh)
import { execFileSync } from 'node:child_process';
import { calibrate, connect, mouse } from './lib.mjs';

const [out, x, y] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const { browser, page } = await connect();
const c = await calibrate(page);
const [sx, sy] = c.toScreen(x, y);
mouse(`m ${sx} ${sy}; sleep 150; rd; sleep 60; ru; sleep 900`);
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=New-Object Drawing.Bitmap 1500,1000; $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save('${out}')`,
  ],
  { stdio: 'pipe' },
);
mouse('kd 27; sleep 50; ku 27; sleep 300');
console.log('saved', out);
await browser.close();
