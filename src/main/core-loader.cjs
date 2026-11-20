/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Entry of the core utilityProcess (copied next to build/main/index.js by vite.main.config.ts).
// Electron's utility process ignores NODE_PATH at startup, and the core bundle may live outside
// the app (hotfix cache in userData), so its bare require()s of native modules (obs-studio-node,
// ...) would not resolve. Make the app's node_modules resolvable, then load the real core bundle.
const path = require('node:path');
const Module = require('node:module');

const nodeModules = process.env.SLOBS_NODE_MODULES;
const entry = process.env.SLOBS_CORE_ENTRY;
if (!entry) throw new Error('SLOBS_CORE_ENTRY is not set');

if (nodeModules) {
  process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}
require(entry);
