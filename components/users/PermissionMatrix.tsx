"use client";

/*
  PermissionMatrix — the module × action checkbox grid.
  =======================================================
  Reused by the Add/Edit User modal, Change Role modal, and View Profile
  (read-only). When `disabled`, it still shows exactly what a built-in role
  grants — informational, not editable — flip to Custom Role to unlock it.
*/

import { Icon } from "@/components/icons";
import { MODULE_DEFS, PERMISSION_ACTIONS, PERMISSION_ACTION_LABELS, type Permissions, type PermissionAction } from "@/lib/users";

export function PermissionMatrix({
  permissions,
  onChange,
  disabled,
}: {
  permissions: Permissions;
  onChange?: (next: Permissions) => void;
  disabled?: boolean;
}) {
  const toggle = (moduleKey: (typeof MODULE_DEFS)[number]["key"], action: PermissionAction) => {
    if (!onChange || disabled) return;
    onChange({
      ...permissions,
      [moduleKey]: { ...permissions[moduleKey], [action]: !permissions[moduleKey][action] },
    });
  };

  const toggleAllForModule = (moduleKey: (typeof MODULE_DEFS)[number]["key"]) => {
    if (!onChange || disabled) return;
    const row = permissions[moduleKey];
    const allOn = PERMISSION_ACTIONS.every((a) => row[a]);
    const next = { ...row };
    for (const a of PERMISSION_ACTIONS) next[a] = !allOn;
    onChange({ ...permissions, [moduleKey]: next });
  };

  return (
    <div className={`overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 ${disabled ? "opacity-70" : ""}`}>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs dark:bg-slate-800/60">
          <tr className="text-left text-slate-500 dark:text-slate-400">
            <th className="px-3 py-2.5 font-semibold">Module</th>
            {PERMISSION_ACTIONS.map((a) => (
              <th key={a} className="px-2 py-2.5 text-center font-semibold">
                {PERMISSION_ACTION_LABELS[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULE_DEFS.map((m) => {
            const row = permissions[m.key];
            const anyOn = PERMISSION_ACTIONS.some((a) => row[a]);
            return (
              <tr key={m.key} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                  <button
                    type="button"
                    disabled={!onChange || disabled}
                    onClick={() => toggleAllForModule(m.key)}
                    className={`flex items-center gap-1.5 ${!disabled && onChange ? "hover:text-brand dark:hover:text-brand-light" : ""}`}
                    title={!disabled && onChange ? "Toggle all actions for this module" : undefined}
                  >
                    {!anyOn && <span className="h-1.5 w-1.5 flex-none rounded-full bg-slate-300 dark:bg-slate-600" />}
                    {m.label}
                  </button>
                </td>
                {PERMISSION_ACTIONS.map((a) => (
                  <td key={a} className="px-2 py-2 text-center">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={row[a]}
                      disabled={disabled || !onChange}
                      onClick={() => toggle(m.key, a)}
                      className={`grid h-5 w-5 place-items-center rounded border transition-colors disabled:cursor-not-allowed ${
                        row[a]
                          ? "border-brand bg-brand text-white"
                          : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                      }`}
                    >
                      {row[a] && <Icon name="check" size={12} />}
                    </button>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
