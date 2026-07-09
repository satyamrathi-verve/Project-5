"use client";

import { useState } from "react";
import { FormField, inputClass, inputErrorClass } from "@/components/FormField";
import { Icon } from "@/components/icons";
import { resetPassword, type PublicUser } from "@/lib/users";
import { Btn, ModalHeader, ModalShell } from "./ui";

export function ResetPasswordModal({
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("Must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setSaving(true);
    await resetPassword(user.id, password, performedBy);
    setSaving(false);
    onDone(`Password reset for ${user.fullName}.`);
    onClose();
  };

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader title="Reset Password" subtitle={`Set a new temporary password for ${user.fullName}.`} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4 p-6">
        <FormField label="New Temporary Password">
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              className={`${error ? inputErrorClass : inputClass} w-full pr-9`}
              placeholder="Min. 8 characters"
              autoFocus
            />
            <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand">
              <Icon name={showPw ? "eyeOff" : "eye"} size={16} />
            </button>
          </div>
        </FormField>
        <FormField label="Confirm Password" error={error ?? undefined}>
          <input
            type={showPw ? "text" : "password"}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError(null);
            }}
            className={error ? inputErrorClass : inputClass}
          />
        </FormField>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" type="submit" icon="key" disabled={saving}>
            {saving ? "Resetting…" : "Reset Password"}
          </Btn>
        </div>
      </form>
    </ModalShell>
  );
}
