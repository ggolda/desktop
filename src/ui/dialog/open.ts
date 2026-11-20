import type { DialogOpenRequest } from '@/shared/contracts';
import { commands } from '@/ui/core';
import { run } from '@/ui/lib/run';

/**
 * Opens a dialog window through core (`dialogs.open`). Dialogs are separate top-level windows
 * (legacy child window): the main window keeps running and its native preview is untouched.
 */
export function openDialog(request: DialogOpenRequest) {
  run(commands.dialogs.open(request), `dialogs.open ${request.kind}`);
}
