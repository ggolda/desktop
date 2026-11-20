// Helper: connect to the running NEW app (CDP 9223) and run a snippet. Used by overlay checks.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const PW_DIR = process.env.PW_DIR || path.join(os.tmpdir(), 'pw');
const { chromium } = createRequire(path.join(PW_DIR, 'x.js'))('playwright-core');
export async function connectNew(port = 9223) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const page = browser
    .contexts()[0]
    .pages()
    .find(p => p.url().includes('main'));
  return { browser, page: page ?? browser.contexts()[0].pages()[0] };
}
