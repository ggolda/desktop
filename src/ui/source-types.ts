/** Display names of the source types (legacy `SourceDisplayData` / `getAvailableSourcesTypesList`), for window titles. */
const NAMES: Record<string, string> = {
  image_source: 'Image',
  color_source: 'Color Block',
  browser_source: 'Browser Source',
  ffmpeg_source: 'Media File',
  slideshow: 'Image Slide Show',
  text_gdiplus: 'Text (GDI+)',
  text_ft2_source: 'Text (FreeType 2)',
  monitor_capture: 'Display Capture',
  window_capture: 'Window Capture',
  game_capture: 'Game Capture',
  dshow_input: 'Video Capture',
  wasapi_input_capture: 'Audio Input Capture',
  wasapi_output_capture: 'Audio Output Capture',
  wasapi_process_output_capture: 'Application Audio',
  'decklink-input': 'Blackmagic Device',
  ndi_source: 'NDI source',
  openvr_capture: 'OpenVR Capture',
  screen_capture: 'Screen Capture',
  liv_capture: 'LIV Client Capture',
  ovrstream_dc_source: 'OvrStream',
  vlc_source: 'VLC Source',
  soundtrack_source: 'Twitch Soundtrack',
  spout_capture: 'Spout2 capture',
  scene: 'Scene',
  mediasoupconnector: 'Collab Cam',
  smart_browser_source: 'Reactive Source',
};

export function sourceTypeName(type: string): string {
  return NAMES[type] ?? type;
}

/** Title of the Source Properties window (legacy `Settings for %{sourceName}`). */
export const propertiesTitle = (type: string) => `Settings for ${sourceTypeName(type)}`;
