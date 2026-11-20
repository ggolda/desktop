/**
 * Performance-rework PoC build for internal testing (docs/rework).
 *   npm run package:poc   →  dist/Streamlabs Desktop PoC Setup <version>.exe (unsigned)
 *
 * - separate appId / product name: installs side by side with the official app
 * - force-local-bundles: the bundle updater uses the PoC bundles, never the release CDN bundles
 * - extraMetadata.poc: main.js skips the app updater and uses its own profile folder
 *   (%APPDATA%\slobs-client-poc), so the tester's real Streamlabs profile is untouched
 */
const base = require('./base.config');

base.appId = 'com.streamlabs.slobs.poc';
base.productName = 'Streamlabs Desktop PoC';
base.win.executableName = 'Streamlabs Desktop PoC';
base.win.extraFiles.push({
  from: 'electron-builder/force-local-bundles',
  to: 'force-local-bundles',
});
base.extraMetadata = { ...base.extraMetadata, poc: true };
// No publish/auto-update configuration for the PoC
base.publish = null;

module.exports = base;
