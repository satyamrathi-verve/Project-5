"use client";

/*
  Tooltip — portal hover/focus tooltip (never clipped, above all content).
  Wrap any element: <Tooltip label="Delete"><button>…</button></Tooltip>.
  Native `title` attributes also work and render above everything; use this when
  you want themed, richer tooltips.
*/

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z } from "./zIndex";

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} className="inline-flex">
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)", zIndex: Z.tooltip }}
            className="pointer-events-none whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-soft animate-fade-in dark:bg-slate-700"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
