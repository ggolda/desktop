import fetch from 'node-fetch';
import * as electron from 'electron';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as stream from 'stream';
import * as crypto from 'crypto';
import AbortController from 'abort-controller';

interface IManifest {
  [logicalName: string]: any; // logicalName -> fileName, except `checksums`
  checksums?: {
    [fileName: string]: string;
  };
}

type TExecutor = () => [Promise<unknown>, () => void];

/** Result handed to the main process. */
interface IBundleSet {
  /** True when the set shipped in the app is used (no hotfix active). */
  useLocal: boolean;
  /** Directory that holds EVERY file of `manifest` (app bundles dir or the completed cache dir). */
  setDir: string;
  manifest: IManifest;
}

const SCHEME = 'slbundle';
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; " +
  "worker-src 'self' blob:";

const MIME: { [ext: string]: string } = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

/** A set is only usable if it can start the app: core, preload and the main window. */
function isUsableManifest(m: any): m is IManifest {
  return (
    !!m &&
    typeof m['core.js'] === 'string' &&
    typeof m['preload.js'] === 'string' &&
    typeof m['main.html'] === 'string'
  );
}

/** File names of a manifest that make up the set (no checksums, no source maps). */
function setFiles(manifest: IManifest): string[] {
  const out: string[] = [];
  Object.keys(manifest).forEach(key => {
    const value = manifest[key];
    if (key === 'checksums' || typeof value !== 'string' || /\.map$/.test(value)) return;
    if (out.indexOf(value) === -1) out.push(value);
  });
  return out;
}

module.exports = async (basePath: string): Promise<IBundleSet> => {
  // SLOBS_BUNDLE_CDN only overrides the CDN folder for tests (local HTTP server).
  const cdnBase = process.env.SLOBS_BUNDLE_CDN
    ? process.env.SLOBS_BUNDLE_CDN.replace(/\/?$/, '/')
    : `https://slobs-cdn.streamlabs.com/${process.env.SLOBS_VERSION}${
        process.platform === 'darwin' ? '-mac' : ''
      }/bundles/`;
  const localBase = path.join(basePath, 'bundles');
  const bundlesBaseDirectory = path.join(electron.app.getPath('userData'), 'bundles');
  const bundleDirectory = path.join(bundlesBaseDirectory, process.env.SLOBS_VERSION!);

  let updaterWindow: electron.BrowserWindow;
  let updaterWindowSuccessfulClose = false;

  function spawnUpdaterWindow() {
    updaterWindow = new electron.BrowserWindow({
      width: 400,
      height: 180,
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      // Plain static page (updater/index.html): no node access needed.
      webPreferences: { sandbox: true, contextIsolation: true },
    });

    updaterWindow.on('ready-to-show', () => {
      updaterWindow.show();
    });

    updaterWindow.on('close', () => {
      if (!updaterWindowSuccessfulClose) electron.app.quit();
    });

    updaterWindow.loadURL(`file://${basePath}/updater/index.html`);
  }

  function closeUpdaterWindow() {
    updaterWindowSuccessfulClose = true;
    if (updaterWindow) {
      // Closing the only window would normally quit the app, so ensure it doesn't.
      electron.app.once('will-quit', e => e.preventDefault());
      updaterWindow.close();
    }
  }

  async function retryWithTimeout(executor: TExecutor, retries = 2) {
    const [done, abort] = executor();
    const timeout = setTimeout(() => {
      console.log('Operation timed out...');
      abort();
    }, 60 * 1000);

    try {
      await done;
      if (timeout) clearTimeout(timeout);
    } catch (e: unknown) {
      if (timeout) clearTimeout(timeout);

      let timedOut = false;

      if (e instanceof Error) {
        timedOut = e.name === 'AbortError';
      }

      // We don't retry timed out requests because it's already taken 60 seconds
      if (retries && !timedOut) {
        console.log('Operation failed but will be retried in 3 seconds...');
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            retryWithTimeout(executor, retries - 1)
              .then(resolve)
              .catch(reject);
          }, 3 * 1000);
        });
      } else {
        throw e;
      }
    }
  }

  function downloadFile(srcUrl: string, dstPath: string): [Promise<void>, () => void] {
    const abortController = new AbortController();
    const tmpPath = `${dstPath}.tmp`;

    const result = new Promise<void>((resolve, reject) => {
      fetch(srcUrl, { signal: abortController.signal })
        .then(response => {
          if (response.ok) return response;

          console.log(`Got ${response.status} response from ${srcUrl}`);
          return Promise.reject(response);
        })
        .then(({ body }) => {
          const fileStream = fs.createWriteStream(tmpPath);

          stream.pipeline(body, fileStream, e => {
            if (e) {
              console.log(`Error downloading ${srcUrl}`, e);
              reject(e);
            } else {
              fs.rename(tmpPath, dstPath, e => {
                if (e) {
                  reject(e);
                  return;
                }

                console.log(`Successfully downloaded ${srcUrl}`);
                resolve();
              });
            }
          });
        })
        .catch(e => reject(e));
    });

    return [result, abortController.abort.bind(abortController)];
  }

  function getChecksum(filePath: string) {
    return new Promise<string>((resolve, reject) => {
      const file = fs.createReadStream(filePath);
      const hash = crypto.createHash('md5');

      stream.pipeline(file, hash, e => {
        if (e) {
          console.log(`Error reading checksum of ${filePath}`, e);
          reject(e);
        } else {
          try {
            const checksum = hash.read().toString('hex');
            console.log(`Got checksum: ${filePath} => ${checksum}`);
            resolve(checksum);
          } catch (e: unknown) {
            console.log(`Error reading checksum of ${filePath}`, e);
            reject(e);
          }
        }
      });
    });
  }

  async function validateFile(
    bundle: string,
    filePath: string,
    manifest: IManifest,
  ): Promise<boolean> {
    if (!manifest.checksums || !manifest.checksums[bundle]) {
      console.log(`Checksums not found in manifest, assuming ${bundle} is valid`);
      return true;
    }

    try {
      const expectedChecksum = manifest.checksums[bundle];
      const actualChecksum = await getChecksum(filePath);

      if (expectedChecksum === actualChecksum) {
        console.log(`${bundle} passed checksum validation`);
        return true;
      } else {
        console.log(
          `Got checksum mismatch on ${bundle}: ${expectedChecksum} =/= ${actualChecksum}`,
        );

        // Attempt to remove the file so it will re-download next time
        fs.unlinkSync(filePath);

        return false;
      }
    } catch (e: unknown) {
      console.log(`Error determining checksum for ${bundle}`);
      return false;
    }
  }

  /**
   * This ensures that if there isn't a directory for this specific container version,
   * we empty the bundles directory (to preserve HD space over time) and create a new
   * directory for this specific version.
   */
  function ensureBundlesDirectory() {
    if (!fs.existsSync(bundleDirectory)) {
      fs.emptyDirSync(bundlesBaseDirectory);
      fs.mkdirSync(bundleDirectory);
    }
  }

  /**
   * Stores a manifest on disk for future use.
   * Will fail silently, just makes a best attempt
   */
  function cacheManifest(manifest: IManifest) {
    try {
      ensureBundlesDirectory();
      fs.writeFileSync(path.join(bundleDirectory, 'manifest.json'), JSON.stringify(manifest));
    } catch (e: unknown) {
      console.log('Error caching manifest for offline use', e);
    }
  }

  /**
   * Attempts to load a cached manifest from disk. Will return undefined
   * if there are any errors while loading.
   */
  function loadCachedManifest(): IManifest | undefined {
    const manifestPath = path.join(bundleDirectory, 'manifest.json');

    try {
      if (!fs.existsSync(manifestPath)) {
        console.log('Cached manifest was not found');
        return;
      }
      const fromDisk = fs.readFileSync(manifestPath);
      const parsed = JSON.parse(fromDisk.toString());

      if (isUsableManifest(parsed)) {
        console.log('Found cached manifest:', parsed);
        return parsed;
      } else {
        console.log('Got malformed cached manifest.json', parsed);
      }
    } catch (e: unknown) {
      console.log('Error reading cached manifest from disk', e);
    }
  }

  /** Whether the copy of `file` shipped in the app is exactly the one `manifest` describes. */
  function localMatches(file: string, manifest: IManifest, localManifest: IManifest): boolean {
    if (!fs.existsSync(path.join(localBase, file))) return false;
    const wanted = manifest.checksums && manifest.checksums[file];
    // Without checksums we can only trust the (content-hashed) name, like before.
    if (!wanted) return true;
    // Unhashed names (e.g. main.html) can differ in content: compare against the local manifest.
    return !!localManifest.checksums && localManifest.checksums[file] === wanted;
  }

  async function getLocalOrCachedBundleFilePath(
    bundle: string,
    manifest: IManifest,
    localManifest: IManifest,
  ): Promise<string> {
    console.log(`Looking for bundle: ${bundle}`);

    // Check for bundle in this app package
    if (localMatches(bundle, manifest, localManifest)) {
      console.log(`Found local bundle ${bundle}`);
      return path.join(localBase, bundle);
    }

    // Fall back to checking the download directory
    const downloadPath = path.join(bundleDirectory, bundle);
    if (fs.existsSync(downloadPath)) {
      console.log(`Found existing downloaded bundle ${bundle}`);

      if (await validateFile(bundle, downloadPath, manifest)) {
        return downloadPath;
      }
    }

    return Promise.reject('Did not find local or cached bundle');
  }

  async function getBundleFilePath(
    bundle: string,
    manifest: IManifest,
    localManifest: IManifest,
  ): Promise<string> {
    const localOrCached = await getLocalOrCachedBundleFilePath(
      bundle,
      manifest,
      localManifest,
    ).catch(() => undefined);
    if (localOrCached) return localOrCached;

    // Check the server
    const serverPath = `${cdnBase}${bundle}`;
    const downloadPath = path.join(bundleDirectory, bundle);
    console.log(`Attempting to download bundle ${bundle}`);
    ensureBundlesDirectory();
    await retryWithTimeout(() => downloadFile(serverPath, downloadPath));

    if (!(await validateFile(bundle, downloadPath, manifest))) {
      return Promise.reject('File failed to validate');
    }

    return downloadPath;
  }

  /**
   * Makes the cache directory hold the COMPLETE set: files that are used from the app's own
   * bundles are copied next to the downloaded ones, so the core process and the preload can be
   * loaded from one folder by plain path.
   */
  function completeSetDirectory(files: string[], paths: { [file: string]: string }) {
    ensureBundlesDirectory();
    files.forEach(file => {
      const dst = path.join(bundleDirectory, file);
      const src = paths[file];
      if (src === dst) return;
      const srcStat = fs.statSync(src);
      try {
        // Already completed by an earlier start: same size and mtime means same copy.
        const dstStat = fs.statSync(dst);
        if (dstStat.size === srcStat.size && Math.floor(dstStat.mtimeMs) === Math.floor(srcStat.mtimeMs)) {
          return;
        }
      } catch (e: unknown) {
        // destination missing: copy below
      }
      fs.copyFileSync(src, dst);
      fs.utimesSync(dst, srcStat.atime, srcStat.mtime);
    });
  }

  /** Resolves every file of the set; with `download` missing files are fetched. */
  async function resolveSet(
    manifest: IManifest,
    localManifest: IManifest,
    download: boolean,
  ): Promise<void> {
    const files = setFiles(manifest);
    const paths: { [file: string]: string } = {};
    await Promise.all(
      files.map(file =>
        (download
          ? getBundleFilePath(file, manifest, localManifest)
          : getLocalOrCachedBundleFilePath(file, manifest, localManifest)
        ).then(p => {
          paths[file] = p;
        }),
      ),
    );
    completeSetDirectory(files, paths);
  }

  let useLocalBundles = false;

  if (process.argv.includes('--local-bundles')) {
    useLocalBundles = true;
  }

  if (process.env.NODE_ENV !== 'production') {
    useLocalBundles = true;
  }

  const forceLocalBundles = path.join(basePath, '../../force-local-bundles');
  if (fs.existsSync(forceLocalBundles)) {
    useLocalBundles = true;
  }

  const localManifest: IManifest = JSON.parse(
    fs.readFileSync(path.join(localBase, 'manifest.json'), 'utf8'),
  );

  console.log('Local bundle info:', localManifest);

  // Check if bundle updates are available
  let serverManifest: IManifest | undefined;

  if (!useLocalBundles) {
    try {
      const remoteManifestName = process.argv.includes('--bundle-qa')
        ? 'manifest-qa.json'
        : 'manifest.json';
      const response = await fetch(`${cdnBase}${remoteManifestName}`);

      if (response.status >= 400) {
        console.log(`Bundle manifest not available, got status: ${response.status}`);
      } else {
        const parsed = await response.json();
        console.log('Latest bundle info:', parsed);

        serverManifest = isUsableManifest(parsed) ? parsed : undefined;
      }
    } catch (e: unknown) {
      console.log('Bundle manifest fetch error', e);
    }
  }

  // The manifest of the active hotfix set (server or cached); undefined means "local".
  let activeManifest: IManifest | undefined;

  if (!useLocalBundles && serverManifest) {
    let timeout: NodeJS.Timeout | null = null;

    try {
      // Either all bundles need to successfully download, or we have to revert to local.
      // If this takes more than 10 seconds, we will spawn a window to let the user know
      // we are working on updates.
      timeout = setTimeout(() => {
        spawnUpdaterWindow();
      }, 10 * 1000);

      await resolveSet(serverManifest, localManifest, true);

      // Everything was successful, so cache the manifest for next time
      cacheManifest(serverManifest);
      activeManifest = serverManifest;

      clearTimeout(timeout);
      closeUpdaterWindow();
    } catch (e: unknown) {
      if (timeout) clearTimeout(timeout);
      closeUpdaterWindow();
      console.log('Failed to download 1 or more bundles', e);
    }
  }

  // Fall back to checking for cached bundles
  if (!useLocalBundles && !activeManifest) {
    const cached = loadCachedManifest();
    if (cached) {
      try {
        // We don't try to download when looking for these bundles
        await resolveSet(cached, localManifest, false);
        activeManifest = cached;
      } catch (e: unknown) {
        console.log('Failed to load cached bundles', e);
      }
    }
  }

  // If everything failed, use local bundles
  if (!activeManifest) useLocalBundles = true;

  const manifest: IManifest = activeManifest || localManifest;
  const setDir = activeManifest ? bundleDirectory : localBase;

  // Used for sending accurate stack traces to sentry: logical name -> file name
  electron.ipcMain.on('getBundleNames', (e: Electron.Event) => {
    const bundleNames: { [bundle: string]: string } = {};
    Object.keys(manifest).forEach(key => {
      if (key !== 'checksums') bundleNames[key] = manifest[key];
    });

    // @ts-ignore Electron types are wrong here
    e.returnValue = bundleNames;
  });

  // slbundle://app/<logical name or file name>, served from the active set's directory.
  const servable: { [name: string]: string } = {};
  Object.keys(manifest).forEach(key => {
    if (key !== 'checksums' && typeof manifest[key] === 'string') {
      servable[key] = manifest[key];
      servable[manifest[key]] = manifest[key];
    }
  });

  electron.session.defaultSession.protocol.handle(SCHEME, async request => {
    const url = new URL(request.url);
    let name = '';
    try {
      name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    } catch (e: unknown) {
      // malformed escape: treated as unknown below
    }

    // Requests for files not in the manifest (e.g. source maps fetched by DevTools)
    // fail with 404 rather than throw.
    const file = Object.prototype.hasOwnProperty.call(servable, name) ? servable[name] : undefined;
    if (!file) return new Response('Not found', { status: 404 });

    try {
      const data = await fs.promises.readFile(path.join(setDir, file));
      const ext = path.extname(file).toLowerCase();
      const headers: { [h: string]: string } = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
      };
      if (ext === '.html') headers['Content-Security-Policy'] = CSP;
      return new Response(data as unknown as BodyInit, { status: 200, headers });
    } catch (e: unknown) {
      console.log(`Error serving ${name}`, e);
      return new Response('Not found', { status: 404 });
    }
  });

  electron.ipcMain.on('startupError', (e, msg) => {
    console.log('Received startup error from worker window', msg);

    // Unregister the main process from the crash handler
    try {
      electron.ipcRenderer.send('unregister-in-crash-handler', { pid: process.pid });
    } catch (e: unknown) {
      console.log('Error unregistering main process from crash handler');
    }

    // Subscribing is what suppresses the default quit-on-last-window-closed.
    // At runtime this event does pass an Event, but it's undocumented and absent
    // from Electron's (doc-generated) types, and preventDefault() on it has no
    // effect on quit behavior here -- verified empirically on Electron 32.
    electron.app.on('window-all-closed', () => {
      // Wait a second for files to no longer be in use
      setTimeout(() => {
        console.log('Attempting to empty bundles directory');
        try {
          // Try clearing the bundles directory in case it got corrupted
          if (fs.existsSync(bundlesBaseDirectory)) {
            fs.emptyDirSync(bundlesBaseDirectory);
          }
        } catch (e: unknown) {
          console.log('Error clearing bundle directory', e);
        }

        console.log('The app will now shut down');
        electron.app.exit();
      }, 1000);
    });

    // Force close all windows
    electron.BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        console.log('Force closing window', w.id);
        // w.destroy();
      }
    });

    electron.dialog.showErrorBox(
      'Streamlabs Desktop',
      'Streamlabs Desktop failed to start. Please try launching Streamlabs Desktop again. If this issue persists, please visit support.streamlabs.com for help.',
    );
  });

  return { useLocal: useLocalBundles, setDir, manifest };
};

/** Must run before app 'ready': makes slbundle:// a standard, secure scheme (ES modules). */
module.exports.registerSchemes = () => {
  electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    },
  ]);
};
