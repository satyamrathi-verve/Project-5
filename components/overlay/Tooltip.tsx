"use client";

/*
  Tooltip — portal hover/focus tooltip with viewport-aware placement.
  Wrap any element: <Tooltip label="Delete"><button>…</button></Tooltip>.
  Opens below by default, flips above near the bottom edge, and clamps
  horizontally so it never leaves the window. Native `title` attributes also
  render above everything; use this when you want a themed tooltip.
*/

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z } from "./zIndex";

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const tip = tipRef.current;
      if (!a || !tip) return;
      const margin = 8;
      const gap = 6;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      // vertical: below, flip up if it would overflow the bottom
      let top = a.bottom + gap;
      if (top + th > window.innerHeight - margin && a.top - gap - th >= margin) top = a.top - gap - th;
      // horizontal: centered on the anchor, clamped inside the viewport
      let left = a.left + a.width / 2 - tw / 2;
      left = Math.min(Math.max(margin, left), window.innerWidth - margin - tw);
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex"
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: Z.tooltip }}
            className="pointer-events-none max-w-xs rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-soft animate-fade-in dark:bg-slate-700"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
