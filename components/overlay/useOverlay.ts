/*
  useOverlay — the shared floating-layer engine.
  ==============================================
  Powers every portal overlay (Popover / Menu). Handles:
    • viewport-aware positioning (flip up near the bottom, shift left/right near
      the edges, always clamped inside the window),
    • re-anchoring on scroll/resize (works inside scrolling containers),
    • outside-click dismissal (document mousedown, so clicking another trigger
      switches menus in a single click — no click-catching backdrop),
    • Esc to close,
    • single-open registry (opening one closes the previous).
  Callers render the returned `ref`'d element into a portal at the returned `pos`.
*/

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { acquireOverlay, releaseOverlay } from "./registry";

export interface Position {
  top: number;
  left: number;
}

/** Compute a viewport-clamped position for a floating element next to `anchor`. */
export function computePosition(
  anchor: DOMRect,
  menuW: number,
  menuH: number,
  align: "left" | "right",
  gap = 6,
  margin = 8,
): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // horizontal: align to the requested edge, then shift to stay on screen
  let left = align === "right" ? anchor.right - menuW : anchor.left;
  if (left + menuW > vw - margin) left = vw - menuW - margin; // near right edge → shift left
  if (left < margin) left = margin; // near left edge → shift right

  // vertical: open downward; flip up if it would overflow the bottom
  let top = anchor.bottom + gap;
  if (top + menuH > vh - margin && anchor.top - gap - menuH >= margin) {
    top = anchor.top - menuH - gap;
  }
  if (top < margin) top = margin;
  if (top + menuH > vh - margin) top = Math.max(margin, vh - menuH - margin);

  return { top, left };
}

export interface UseOverlayOptions {
  open: boolean;
  /** Returns the trigger element (positioning + outside-click ignore anchor). */
  getAnchorEl: () => HTMLElement | null;
  onClose: () => void;
  width?: number;
  align?: "left" | "right";
  /** Participate in the single-open registry (default true). */
  register?: boolean;
}

export function useOverlay({ open, getAnchorEl, onClose, width, align = "left", register = true }: UseOverlayOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  const place = useCallback(() => {
    const el = getAnchorEl();
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    const node = ref.current;
    const menuW = width ?? node?.offsetWidth ?? 220;
    const menuH = node?.offsetHeight ?? 260;
    setPos(computePosition(rect, menuW, menuH, align));
  }, [getAnchorEl, width, align]);

  // measure + place before paint (no flicker)
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    if (register) acquireOverlay(onClose);

    const reflow = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return; // click inside the overlay
      const anchor = getAnchorEl();
      if (anchor && anchor.contains(t)) return; // click on the trigger (let it toggle)
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    // capture-phase scroll re-anchors the overlay inside scrolling containers
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      if (register) releaseOverlay(onClose);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, place, onClose, register, getAnchorEl]);

  return { ref, pos };
}
