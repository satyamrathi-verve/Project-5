"use client";

/*
  Popover — portal dropdown/popover anchored to a trigger element.
  ===============================================================
  Renders into document.body so no parent's overflow can clip it. Drop-in
  replacement for the old per-module Popovers: same props (open / anchorRef /
  onClose / align / width / padded) plus a `layer` from the global z-scale.
  Positioning, collision, outside-click, Esc and single-open come from useOverlay.
*/

import { createPortal } from "react-dom";
import { Z, type OverlayLayer } from "./zIndex";
import { useOverlay } from "./useOverlay";

export function Popover({
  open,
  anchorRef,
  onClose,
  align = "right",
  width,
  padded = true,
  layer = "popover",
  children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: "left" | "right";
  width?: number;
  padded?: boolean;
  layer?: OverlayLayer;
  children: React.ReactNode;
}) {
  const { ref, pos } = useOverlay({ open, getAnchorEl: () => anchorRef.current, onClose, width, align });
  if (open === false) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        maxHeight: pos?.maxHeight,
        zIndex: Z[layer],
      }}
      className={`overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-slate-200 bg-white shadow-soft animate-scale-in dark:border-slate-700 dark:bg-slate-800 ${
        padded ? "p-2" : ""
      }`}
    >
      {children}
    </div>,
    document.body,
  );
}
