/*
  Single-open registry for transient overlays (dropdowns / menus / popovers).
  ===========================================================================
  Guarantees at most ONE transient overlay is open at a time across the whole
  app: opening a new one auto-closes the previous. Modal dialogs, drawers and
  tooltips do NOT register (they aren't mutually exclusive with dropdowns).
*/

let current: (() => void) | null = null;

/** Register a newly-opened overlay; closes whichever was open before it. */
export function acquireOverlay(close: () => void): void {
  if (current && current !== close) {
    const prev = current;
    current = close;
    prev();
  } else {
    current = close;
  }
}

/** Release on close/unmount. */
export function releaseOverlay(close: () => void): void {
  if (current === close) current = null;
}
