// Files of `userData/SceneCollections/` (m1-design 1.1, C7, C8): manifest.json, <id>.json,
// <id>.json.bak (the text of the last successful load), <id>.json.absolute.bak (pre-migration copy).
// Writes are atomic (tmp + rename) and never leave the directory; files are never deleted.
import fs from 'node:fs';
import path from 'node:path';
import { parseManifest, serializeJson } from './codec';
import type { Manifest } from './format';

const ID_RE = /^[A-Za-z0-9_.-]+$/;

export interface StoreFs {
  readFileSync(p: string, enc: 'utf8'): string;
  existsSync(p: string): boolean;
  mkdirSync(p: string, o: { recursive: true }): unknown;
  promises: {
    writeFile(p: string, data: string, enc: 'utf8'): Promise<void>;
    rename(a: string, b: string): Promise<void>;
    rm(p: string, o: { force: true }): Promise<void>;
  };
}

export class CollectionStore {
  readonly dir: string;
  private chains = new Map<string, Promise<void>>();

  constructor(
    userData: string,
    private readonly io: StoreFs = fs,
  ) {
    this.dir = path.join(userData, 'SceneCollections');
  }

  private safe(id: string): string {
    if (!ID_RE.test(id) || id === '.' || id === '..') throw new Error(`bad collection id: ${id}`);
    return id;
  }

  filePath(id: string, suffix = ''): string {
    return path.join(this.dir, `${this.safe(id)}.json${suffix}`);
  }

  ensureDir() {
    this.io.mkdirSync(this.dir, { recursive: true });
  }

  /** Null when there is no manifest or it cannot be used (the caller then starts fresh). */
  readManifest(): Manifest | null {
    const p = path.join(this.dir, 'manifest.json');
    if (!this.io.existsSync(p)) return null;
    try {
      return parseManifest(this.io.readFileSync(p, 'utf8'));
    } catch (e) {
      console.warn(`[collections] manifest unreadable: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** Text of `<id>.json` or its `.bak`; null when the file does not exist. */
  read(id: string, backup = false): string | null {
    const p = this.filePath(id, backup ? '.bak' : '');
    if (!this.io.existsSync(p)) return null;
    return this.io.readFileSync(p, 'utf8');
  }

  hasAbsoluteBackup(id: string): boolean {
    return this.io.existsSync(this.filePath(id, '.absolute.bak'));
  }

  /** Writes serialize per target path, so a later write never overtakes an earlier one. */
  private atomicWrite(target: string, data: string): Promise<void> {
    const prev = this.chains.get(target) ?? Promise.resolve();
    const run = prev
      .catch(() => undefined)
      .then(async () => {
        const tmp = `${target}.tmp`;
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await this.io.promises.writeFile(tmp, data, 'utf8');
            await this.io.promises.rename(tmp, target);
            return;
          } catch (e) {
            lastErr = e;
            await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
          }
        }
        await this.io.promises.rm(tmp, { force: true }).catch(() => undefined);
        throw lastErr;
      });
    this.chains.set(target, run);
    return run;
  }

  writeManifest(m: Manifest): Promise<void> {
    this.ensureDir();
    // the legacy manifest is the service state minus the top-level `auto`
    return this.atomicWrite(path.join(this.dir, 'manifest.json'), serializeJson(m));
  }

  write(id: string, text: string): Promise<void> {
    this.ensureDir();
    return this.atomicWrite(this.filePath(id), text);
  }

  writeBak(id: string, text: string): Promise<void> {
    this.ensureDir();
    return this.atomicWrite(this.filePath(id, '.bak'), text);
  }

  writeAbsoluteBak(id: string, text: string): Promise<void> {
    this.ensureDir();
    return this.atomicWrite(this.filePath(id, '.absolute.bak'), text);
  }

  /** Waits for every queued write. */
  async flush(): Promise<void> {
    await Promise.all([...this.chains.values()].map(p => p.catch(() => undefined)));
  }
}
