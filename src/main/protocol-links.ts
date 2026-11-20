import { app } from 'electron';
import type { CoreProcess } from './core-process';

const isLink = (s: string) => /^slobs:\/\//.test(s);

let core: CoreProcess | null = null;
const pending: string[] = [];

function deliver(url: string) {
  console.log(`[main] protocol link: ${url}`);
  if (core) core.sendProtocolLink(url);
  else pending.push(url);
}

/** Registers the slobs:// client and collects links until core exists. Call before 'ready'. */
export function initProtocolLinks() {
  app.setAsDefaultProtocolClient('slobs');
  process.argv.filter(isLink).forEach(deliver);
  // macOS: fired when a link is opened
  app.on('open-url', (e, url) => {
    e.preventDefault();
    deliver(url);
  });
}

/** Links from another instance's argv (second-instance event). */
export function deliverLinksFromArgv(argv: string[]) {
  argv.filter(isLink).forEach(deliver);
}

export function attachCore(c: CoreProcess) {
  core = c;
  pending.splice(0).forEach(url => c.sendProtocolLink(url));
}
