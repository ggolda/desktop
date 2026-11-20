/*global SLOBS_BUNDLE_ID*/
/*global SLD_SENTRY_BACKEND_SERVER_URL, SLD_SENTRY_FRONTEND_DSN, SLD_SENTRY_BACKEND_SERVER_PREVIEW_URL*/

/**
 * Entry point of the worker window when it runs the worker-only bundle
 * (webpack.worker.config.js). It is the worker path of app/app.ts without any UI:
 * no root component, no UI plugins, no stylesheets. UI modules imported by services are
 * replaced with a stub in this bundle. See docs/rework (worker-only bundle).
 */

import { I18nService } from 'services/i18n';

// eslint-disable-next-line
window['eval'] = global.eval = () => {
  throw new Error('window.eval() is disabled for security');
};

import Vue from 'vue';
import VueI18n from 'vue-i18n';
import electron from 'electron';
import * as remote from '@electron/remote';
import * as Sentry from '@sentry/browser';
import path from 'path';
import util from 'util';
import process from 'process';
import { createStore } from './store';
import { WindowsService } from './services/windows';
import { ObsUserPluginsService } from 'services/obs-user-plugins';
import { AppService } from './services/app';
import Utils from './services/utils';
import { UserService, setSentryContext } from 'services/user';
import { getResource } from 'services';
import * as obs from '../obs-api';
import { RealmService } from 'app-services';

const { ipcRenderer } = electron;
const slobsVersion = Utils.env.SLOBS_VERSION;
const isProduction = Utils.env.NODE_ENV === 'production';
const isPreview = !!Utils.env.SLOBS_PREVIEW;
const windowId = Utils.getWindowId();

const logTypes = ['debug', 'error', 'info', 'log'] as const;
type TLogType = typeof logTypes[number];

if (isProduction) {
  electron.crashReporter.addExtraParameter('windowId', windowId);
}

function sendLogMsg(level: string, ...args: any[]) {
  const serialized = args.map(arg => (typeof arg === 'string' ? arg : util.inspect(arg))).join(' ');
  ipcRenderer.send('logmsg', { level, sender: windowId, message: serialized });
}

function wrapLogFn(fn: TLogType) {
  const old: Function = console[fn];
  console[fn] = (...args: any[]) => {
    old.apply(console, args);
    sendLogMsg(fn === 'log' ? 'info' : fn, ...args);
  };
}

logTypes.forEach(wrapLogFn);
console.log(`Bundle Id: ${SLOBS_BUNDLE_ID} (worker-only bundle)`);

window.addEventListener('error', e => sendLogMsg('error', e.message, e.error));
window.addEventListener('unhandledrejection', e => sendLogMsg('error', e.reason));

let usingSentry = false;
if (isProduction || process.env.SLOBS_REPORT_TO_SENTRY) {
  const sampleRate = isPreview || process.env.SLOBS_REPORT_TO_SENTRY ? 1.0 : 0.1;
  const isSampled = Math.random() < sampleRate;
  usingSentry = true;

  Sentry.init({
    dsn: SLD_SENTRY_FRONTEND_DSN,
    release: `${slobsVersion}-${SLOBS_BUNDLE_ID}`,
    beforeSend: (event, hint) => {
      // Local file URLs aren't public: send only the file name (see app.ts).
      const normalize = (filename: string) => filename.split('/').pop();
      if (hint.originalException) sendLogMsg('error', hint.originalException);
      if (event.exception && event.exception.values[0].stacktrace) {
        event.exception.values[0].stacktrace.frames.forEach(frame => {
          frame.filename = normalize(frame.filename);
        });
      }
      if (event.request) event.request.url = normalize(event.request.url);
      return isSampled ? event : null;
    },
  });

  const oldConsoleError = console.error;
  console.error = (msg: unknown, ...params: any[]) => {
    oldConsoleError(msg, ...params);
    Sentry.withScope(scope => {
      if (params[0] instanceof Error) scope.setExtra('exception', params[0].stack);
      scope.setExtra('console-args', JSON.stringify(params, null, 2));
      if (typeof msg === 'string') Sentry.captureMessage(msg, Sentry.Severity.Error);
      else if (msg instanceof Error) Sentry.captureException(msg);
      else Sentry.captureMessage('console.error was called with other type than string or Error', Sentry.Severity.Error);
    });
  };
}

function apiInitErrorResultToMessage(resultCode: obs.EVideoCodes) {
  switch (resultCode) {
    case obs.EVideoCodes.NotSupported:
      return 'Failed to initialize Streamlabs Desktop. Your video drivers may be out of date, or Streamlabs Desktop may not be supported on your system.';
    case obs.EVideoCodes.ModuleNotFound:
      return 'DirectX could not be found on your system. Please install the latest version of DirectX for your machine here <https://www.microsoft.com/en-us/download/details.aspx?id=35?> and try again.';
    default:
      return 'An unknown error was encountered while initializing Streamlabs Desktop.';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await RealmService.instance.connect();

  createStore();

  // Services translate strings through the shared vue-i18n instance.
  Vue.use(VueI18n);
  const i18n = new VueI18n({
    locale: 'en-US',
    fallbackLocale: 'en-US',
    messages: {},
    silentTranslationWarn: false,
    missing: (language: string, key: string) => {
      if (isProduction) return;
      console.error(`Missing translation found for ${language} -- "${key}"`);
    },
  });
  I18nService.setVuei18nInstance(i18n);

  if (!Utils.isDevMode()) {
    ipcRenderer.send('register-in-crash-handler', { pid: process.pid, critical: false });
  }

  const windowsService: WindowsService = WindowsService.instance;
  const appService: AppService = AppService.instance;
  const obsUserPluginsService: ObsUserPluginsService = ObsUserPluginsService.instance;

  // This is used for debugging
  (window as typeof window & { obs: typeof obs }).obs = obs;

  // Host a new OBS server instance
  obs.IPC.host(remote.process.env.IPC_UUID);
  obs.NodeObs.SetWorkingDirectory(
    path.join(
      remote.app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
      'node_modules',
      'obs-studio-node',
    ),
  );

  await obsUserPluginsService.initialize();

  const apiResult = obs.NodeObs.OBS_API_initAPI({
    language: 'en-US',
    appDataPath: appService.appDataDirectory,
    version: remote.process.env.SLOBS_VERSION,
    crashServerUrl: isPreview ? SLD_SENTRY_BACKEND_SERVER_PREVIEW_URL : SLD_SENTRY_BACKEND_SERVER_URL,
  });

  if (apiResult !== obs.EVideoCodes.Success) {
    remote.dialog.showErrorBox('Initialization Error', apiInitErrorResultToMessage(apiResult));
    ipcRenderer.send('unregister-in-crash-handler', { pid: process.pid });
    obs.NodeObs.InitShutdownSequence();
    obs.IPC.disconnect();
    electron.ipcRenderer.send('shutdownComplete');
    return;
  }

  ipcRenderer.on('closeWindow', () => windowsService.closeMainWindow());
  I18nService.instance.load();
  AppService.instance.load();

  ipcRenderer.on('initFinished', () => {
    if (usingSentry) {
      const userService = getResource<UserService>('UserService');
      const ctx = userService.getSentryContext();
      if (ctx) setSentryContext(ctx);
      userService.sentryContext.subscribe(setSentryContext);
    }
  });
});
