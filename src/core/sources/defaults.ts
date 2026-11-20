// Settings the legacy "Add source" flow applies when it creates a source (m1-dialogs-design 1.2):
// `getObsSourceCreateSettings` + the default properties manager's `setupAutomaticGameCapture`.
// Everything not listed is left to OBS (color source white 400x400, window capture automatic, ...).
import path from 'node:path';

export interface DefaultsEnv {
  /** userData directory (`game_capture_list.json` lives there). */
  userData: string;
  /** Directory of `shared-resources` (`capture-placeholder.png`). */
  sharedResources: string;
}

/** `shared-resources`: next to the app root in dev, next to the install root when packaged. */
export function sharedResourcesDir(appPath: string): string {
  return /app\.asar$/i.test(appPath)
    ? path.resolve(appPath, '../../shared-resources')
    : path.resolve(appPath, 'shared-resources');
}

export function defaultsFor(
  type: string,
  name: string,
  env?: DefaultsEnv,
): Record<string, unknown> {
  switch (type) {
    case 'browser_source':
      return { shutdown: true, url: 'https://streamlabs.com/browser-source' };
    case 'text_gdiplus':
      // version 3 fixes the blurry text of the older implementation (legacy comment, OBS b230290)
      return { text: name, version: 3 };
    case 'ffmpeg_source':
      return { is_media_flag: false };
    case 'game_capture':
    case 'screen_capture': {
      if (!env) return {};
      const placeholder = path.join(env.sharedResources, 'capture-placeholder.png');
      return {
        auto_capture_rules_path: path.join(env.userData, 'game_capture_list.json'),
        auto_placeholder_image: placeholder,
        auto_placeholder_message: 'Looking for a game to capture',
        window_placeholder_image: placeholder,
        window_placeholder_waiting_message: 'Looking for a game to capture',
        window_placeholder_missing_message: 'Specified window is not a game',
        capture_overlays: true,
      };
    }
    default:
      return {};
  }
}
