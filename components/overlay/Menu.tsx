"use client";

/*
  Menu — portal action/context menu with keyboard navigation.
  ===========================================================
  Anchored to the clicked trigger element, rendered to document.body. Full
  keyboard support (↑/↓/Home/End to move, Enter to select, Esc to close),
  viewport collision + outside-click + single-open from useOverlay. Use for row
  action menus, right-click menus and any icon-triggered menu.
*/

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { Z, type OverlayLayer } from "./zIndex";
import { useOverlay } from "./useOverlay";

export type MenuItem =
  | { icon?: IconName; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
  | { separator: true };

export function Menu({
  anchorEl,
  items,
  onClose,
  width = 220,
  align = "right",
  layer = "contextMenu",
}: {
  anchorEl: HTMLElement;
  items: MenuItem[];
  onClose: () => void;
  width?: number;
  align?: "left" | "right";
  layer?: OverlayLayer;
}) {
  const { ref, pos } = useOverlay({ open: true, getAnchorEl: () => anchorEl, onClose, width, align });

  // keyboard navigation across menu items
  useEffect(() => {
    const menuItems = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    menuItems()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      const btns = menuItems();
      if (!btns.length) return;
      const idx = btns.findIndex((b) => b === document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        btns[(idx + 1) % btns.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        btns[(idx - 1 + btns.length) % btns.length].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        btns[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        btns[btns.length - 1].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        maxHeight: pos?.maxHeight,
        zIndex: Z[layer],
      }}
      className="overflow-y-auto overflow-x-hidden overscroll-contain rounded-[10px] border border-slate-200 bg-white p-1 shadow-[0_12px_44px_-8px_rgba(15,23,42,0.4)] animate-scale-in dark:border-slate-700 dark:bg-slate-800"
    >
      {items.map((it, i) =>
        "separator" in it ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-slate-100 dark:bg-slate-700" />
        ) : (
          <button
            key={it.label}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors focus:bg-slate-100 disabled:opacity-40 dark:focus:bg-slate-700 ${
              it.danger
                ? "text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 dark:focus:bg-red-500/10"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            {it.icon && <Icon name={it.icon} size={16} className="flex-none text-slate-400" />}
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
