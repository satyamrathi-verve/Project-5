"use client";

/*
  ReasonDialog — reusable "confirm this change" modal.
  ====================================================
  Shown before any record modification is saved. It captures an optional or
  required reason for the change and shows who is making it (the signed-in user,
  captured automatically — never typed). Returns the reason to the caller, which
  logs it to the Activity Center. Dark-theme consistent; portaled above all UI.
*/

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { currentUserName } from "@/lib/activity";

export function ReasonDialog({
  open,
  title = "Confirm change",
  message,
  confirmLabel = "Save change",
  requireReason = false,
  tone = "brand",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  requireReason?: boolean;
  tone?: "brand" | "danger";
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const user = currentUserName();

  useEffect(() => {
    if (open) {
      setReason("");
      setTimeout(() => areaRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;
  const canConfirm = !requireReason || reason.trim().length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-drawer animate-scale-in dark:bg-slate-900">
        <div className="p-6">
          <div className={`mb-3 grid h-11 w-11 place-items-center rounded-full ${tone === "danger" ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400" : "bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-light"}`}>
            <Icon name={tone === "danger" ? "trash" : "pencil"} size={20} />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
          {message && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>}

          <label className="mt-4 block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Reason for change {requireReason ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optional)</span>}
            </span>
            <textarea
              ref={areaRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Corrected account name per finance review"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canConfirm) onConfirm(reason.trim());
              }}
            />
          </label>

          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <Icon name="users" size={13} />
            Recorded as <span className="font-medium text-slate-500 dark:text-slate-300">{user}</span> · {new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={() => canConfirm && onConfirm(reason.trim())}
              disabled={!canConfirm}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-brand hover:bg-brand-dark"
              }`}
            >
              <Icon name="check" size={15} />
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
