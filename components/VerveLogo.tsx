"use client";

import { useState } from "react";
import { LOGO_SRC } from "@/lib/logo";

/*
  Verve Advisory wordmark — the letterhead on printable documents (invoices,
  statements) and the sidebar brand.

  It renders the official logo from /public/verve-logo.png. If that file isn't
  present, it falls back to the drawn recreation so no screen ever breaks.

  Scale it by setting a text size on the element, e.g.:
    <VerveLogo className="text-[26px]" />

  The official artwork is the full "verve Advisory" lockup, so `subtitle` only
  affects the fallback.
*/
export function VerveLogo({
  className = "",
  subtitle = true,
  onLight = false,
}: {
  className?: string;
  subtitle?: boolean;
  /** Set when the logo sits on a permanently white surface (e.g. a chip on the
   *  dark sidebar). Keeps "Advisory" dark instead of following the app theme. */
  onLight?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={LOGO_SRC}
        alt="Verve Advisory"
        onError={() => setFailed(true)}
        className={`inline-block h-[3.4em] w-auto object-contain ${className}`}
      />
    );
  }

  return (
    <span className={`inline-block leading-none ${className}`} aria-label="Verve Advisory">
      <span
        className="block font-black tracking-[-0.045em] text-[#2b4c9c]"
        style={{ fontSize: "2.4em" }}
      >
        verve
      </span>
      {subtitle && (
        <span
          className={`block text-right font-bold tracking-[0.03em] ${
            onLight ? "text-slate-800" : "text-slate-800 dark:text-slate-200"
          }`}
          style={{ fontSize: "0.95em", marginTop: "-0.12em" }}
        >
          Advisory
        </span>
      )}
    </span>
  );
}
