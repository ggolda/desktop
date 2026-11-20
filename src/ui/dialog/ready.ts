import { nextTick } from 'vue';

/**
 * Dialog windows are created hidden; main shows them when the page signals `dialog:ready`
 * (`window.reborn.dialog.ready()`). The signal is sent once, only after the FIRST COMPLETE render:
 * data in the DOM (the layout is mounted only when the snapshot is there), every font the page uses
 * loaded, images decoded and the frame painted. (The native source preview display is not awaited: its
 * area is reserved at final size and core reveals the display once it has drawn, see `settleMs`.) Nothing here is a timer except the short frame guards.
 */
let sent = false;

/** Resolves after the next frame was produced (guarded: a throttled window never stalls the signal). */
const frame = () =>
  new Promise<void>(resolve => {
    const guard = setTimeout(resolve, 60);
    requestAnimationFrame(() => {
      clearTimeout(guard);
      resolve();
    });
  });

/** The fonts of the dialog chrome, loaded for sure (not only when the first layout happens to use them). */
const FONTS = [
  '400 14px Roboto',
  '500 14px Roboto',
  '700 14px Roboto',
  '14px icomoon',
  '900 14px "Font Awesome 5 Free"',
  '400 14px "Font Awesome 5 Free"',
];

/** Called by the layout when it is mounted with its data. Idempotent. */
export async function signalDialogReady() {
  if (sent) return;
  sent = true;
  try {
    await nextTick();
    await frame(); // style + layout happened: the fonts the content really uses are now requested
    const fonts = document.fonts;
    await Promise.all([
      ...(fonts ? FONTS.map(f => fonts.load(f).catch(() => [])) : []),
      ...Array.from(document.images ?? [], i => i.decode?.().catch(() => undefined)),
    ]);
    await fonts?.ready;
    await frame(); // painted with everything above
  } finally {
    window.reborn?.dialog?.ready();
    // transitions (focus ring, hover) only run for the live dialog, never for the opening frame
    document.documentElement.classList.add('dlg-live');
  }
}
