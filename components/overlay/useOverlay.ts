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

export interface OverlayPlacement {
  top: number;
  left: number;
  /** Cap so the menu always fits the viewport; content scrolls beyond it. */
  maxHeight: number;
  maxWidth: number;
  /** Which side it actually opened on (for optional origin styling). */
  placement: "top" | "bottom";
}
/** @deprecated use OverlayPlacement */
export type Position = OverlayPlacement;

/**
 * Viewport-aware placement (Figma / GitHub / Notion style):
 *   • measure the space above and below the anchor,
 *   • open downward when the menu fits below, else flip up when it fits above,
 *   • otherwise open on the side with more room and scroll within maxHeight,
 *   • align to the requested edge, shifting left/right to stay fully on screen,
 *   • never render outside the window.
 * `menuH` should be the natural (scroll) height so the fit test is honest.
 */
export function computePosition(
  anchor: DOMRect,
  menuW: number,
  menuH: number,
  align: "left" | "right",
  gap = 6,
  margin = 8,
): OverlayPlacement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ── vertical: choose the side with the best fit ─────────────────────────────
  const spaceBelow = vh - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  let placement: "top" | "bottom";
  if (menuH <= spaceBelow) placement = "bottom"; // fits below → open down
  else if (menuH <= spaceAbove) placement = "top"; // doesn't fit below but fits above → open up
  else placement = spaceBelow >= spaceAbove ? "bottom" : "top"; // fits neither → larger side (scrolls)

  const maxHeight = Math.max(120, placement === "bottom" ? spaceBelow : spaceAbove);
  const usedH = Math.min(menuH, maxHeight);
  const top = placement === "bottom" ? anchor.bottom + gap : Math.max(margin, anchor.top - gap - usedH);

  // ── horizontal: align to the requested edge, then shift to stay on screen ────
  const maxWidth = vw - 2 * margin;
  const w = Math.min(menuW, maxWidth);
  let left = align === "right" ? anchor.right - w : anchor.left;
  if (left + w > vw - margin) left = vw - margin - w; // near right edge → shift left
  if (left < margin) left = margin; // near left edge → shift right

  return { top, left, maxHeight, maxWidth, placement };
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

function samePlacement(a: OverlayPlacement | null, b: OverlayPlacement): boolean {
  return (
    a != null &&
    a.top === b.top &&
    a.left === b.left &&
    a.maxHeight === b.maxHeight &&
    a.maxWidth === b.maxWidth &&
    a.placement === b.placement
  );
}

export function useOverlay({ open, getAnchorEl, onClose, width, align = "left", register = true }: UseOverlayOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<OverlayPlacement | null>(null);

  // Keep the latest callbacks in refs so the effects below don't depend on their
  // (per-render) identity — that identity churn is what caused the render loop.
  const getAnchorElRef = useRef(getAnchorEl);
  getAnchorElRef.current = getAnchorEl;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // `place` only depends on width/align (stable), so the layout effect runs on
  // open — not every render. setPos bails when the position is unchanged, so a
  // re-measure that yields the same result never triggers another render.
  const place = useCallback(() => {
    const el = getAnchorElRef.current();
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    const node = ref.current;
    const menuW = width ?? node?.offsetWidth ?? 220;
    // scrollHeight = natural content height even when capped by maxHeight, so the
    // fit test stays honest and placement can't oscillate.
    const menuH = node?.scrollHeight ?? 260;
    const next = computePosition(rect, menuW, menuH, align);
    setPos((prev) => (samePlacement(prev, next) ? prev : next));
  }, [width, align]);

  // measure + place before paint (no flicker)
  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = () => onCloseRef.current();
    if (register) acquireOverlay(close);

    const reflow = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return; // click inside the overlay
      const anchor = getAnchorElRef.current();
      if (anchor && anchor.contains(t)) return; // click on the trigger (let it toggle)
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };

    // capture-phase scroll re-anchors the overlay inside scrolling containers
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      if (register) releaseOverlay(close);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, place, register]);

  return { ref, pos };
}
