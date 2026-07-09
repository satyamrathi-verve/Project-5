"use client";

import { useState } from "react";
import { FormField, inputClass } from "@/components/FormField";
import { changeRole, defaultPermissionsForRole, ROLE_DEFS, type Permissions, type PublicUser, type RoleId } from "@/lib/users";
import { Btn, ModalHeader, ModalShell } from "./ui";
import { PermissionMatrix } from "./PermissionMatrix";

export function ChangeRoleModal({
  user,
  performedBy,
  onClose,
  onDone,
}: {
  user: PublicUser;
  performedBy: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [role, setRole] = useState<RoleId>(user.role);
  const [permissions, setPermissions] = useState<Permissions>(user.permissions);
  const [saving, setSaving] = useState(false);

  const onRoleChange = (r: RoleId) => {
    setRole(r);
    if (r !== "custom") setPermissions(defaultPermissionsForRole(r));
  };

  const submit = async () => {
    setSaving(true);
    await changeRole(user.id, role, permissions, performedBy);
    setSaving(false);
    onDone(`${user.fullName}'s role changed to ${ROLE_DEFS.find((r) => r.id === role)?.label ?? role}.`);
    onClose();
  };

  return (
    <ModalShell onClose={onClose} wide>
      <ModalHeader title="Change Role" subtitle={`Update ${user.fullName}'s role and access.`} onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-6">
        <FormField label="Role">
          <select value={role} onChange={(e) => onRoleChange(e.target.value as RoleId)} className={`${inputClass} max-w-xs`}>
            {ROLE_DEFS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </FormField>
        <p className="mt-1 text-xs text-slate-400">{ROLE_DEFS.find((r) => r.id === role)?.description}</p>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Permissions</span>
            {role !== "custom" && <span className="text-[11px] text-slate-400">Set by role — choose Custom Role to edit</span>}
          </div>
          <PermissionMatrix permissions={permissions} onChange={role === "custom" ? setPermissions : undefined} disabled={role !== "custom"} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" icon="check" disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving…" : "Save Role"}
        </Btn>
      </div>
    </ModalShell>
  );
}
