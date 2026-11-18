/**
 * Worker-only bundle (docs/rework: worker without UI code).
 *
 * The worker window runs all services but renders nothing. This separate compilation builds
 * `bundles/worker.js` from app/worker.ts and replaces UI modules (Vue/React components,
 * styles) with app/util/worker-ui-stub.js, so the worker no longer parses/holds React, Vue
 * components, antd, themes etc. A few helper modules that live in UI folders but are used by
 * services at runtime are kept (KEEP).
 *
 * Run after the main build (it must not clean bundles/ or overwrite manifest.json); it adds
 * `worker.js` to bundles/manifest.json so the slbundle:// protocol can serve it.
 */
const path = require('path');
const fs = require('fs');
const prodConfig = require('./webpack.prod.config.js');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const { WebpackManifestPlugin } = require('webpack-manifest-plugin');

const OUTPUT_DIR = path.join(__dirname, 'bundles');
const STUB = path.resolve(__dirname, 'app/util/worker-ui-stub.js');

// UI code: anything under app/components*, plus styles and Vue single-file components.
const UI = [/\/app\/components(-react)?\//, /\.(vue|less|css)$/];
// Helpers inside UI folders that services use at runtime (types are erased anyway).
const KEEP = [
  /\/app\/components\/obs\/inputs\/ObsInput\.ts$/, // getPropertiesFormData & co.
  /\/app\/components\/shared\/inputs\/index\.ts$/, // InputMetadata / metadata / formMetadata
  /\/app\/components\/widgets\/inputs\/index\.ts$/, // WidgetInputMetadata / metadata
  /\/app\/components-react\/service-provider\.ts$/, // plain proxy over getResource, no React
];
// UI-only npm packages reached from non-UI code (e.g. util/slow-imports.ts → beaker)
const UI_PACKAGES = [/\/node_modules\/streamlabs-beaker\//];

class WorkerUiStubPlugin {
  apply(compiler) {
    const stubbed = new Set();
    compiler.hooks.normalModuleFactory.tap('WorkerUiStubPlugin', nmf => {
      nmf.hooks.afterResolve.tap('WorkerUiStubPlugin', data => {
        const cd = data.createData;
        if (!cd || !cd.resource) return;
        const file = cd.resource.split('?')[0].replace(/\\/g, '/');
        const uiPackage = UI_PACKAGES.some(r => r.test(file));
        if (file.includes('/node_modules/') && !uiPackage && !/\.(vue|less|css)$/.test(file)) return;
        if (!uiPackage && (!UI.some(r => r.test(file)) || KEEP.some(r => r.test(file)))) return;
        stubbed.add(path.relative(__dirname, file).replace(/\\/g, '/'));
        cd.resource = STUB;
        cd.request = STUB;
        cd.userRequest = STUB;
        cd.rawRequest = STUB;
        cd.matchResource = undefined;
        cd.loaders = [];
      });
    });
    compiler.hooks.done.tap('WorkerUiStubPlugin', () => {
      fs.writeFileSync(path.join(OUTPUT_DIR, 'worker-stubbed-modules.txt'), [...stubbed].sort().join('\n'));
      console.log(`worker bundle: ${stubbed.size} UI modules replaced by the stub`);
    });
  }
}

class AddToManifestPlugin {
  apply(compiler) {
    compiler.hooks.done.tap('AddToManifestPlugin', () => {
      const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest['worker.js'] = 'worker.js';
      manifest['worker.js.map'] = 'worker.js.map';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
  }
}

module.exports = {
  ...prodConfig,
  entry: { worker: './app/worker.ts' },
  output: { ...prodConfig.output, filename: '[name].js', chunkFilename: 'worker-[name].[contenthash].js' },
  optimization: { ...prodConfig.optimization, splitChunks: false },
  plugins: prodConfig.plugins
    .filter(
      p =>
        !(p instanceof CleanWebpackPlugin) &&
        !(p instanceof WebpackManifestPlugin) &&
        p.constructor.name !== 'WebpackManifestChecksumPlugin',
    )
    .concat([new WorkerUiStubPlugin(), new AddToManifestPlugin()]),
};
