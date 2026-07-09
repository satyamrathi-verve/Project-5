"use client";

/*
  UserFormModal — the "Add User" / "Edit User" modal.
  =====================================================
  One shared form for both modes. Create mode adds the Temporary Password /
  Confirm Password fields (password changes afterwards go through the
  dedicated Reset Password action, per spec); Edit mode omits them. Selecting
  a built-in role auto-fills the permission matrix below and locks it —
  switching to Custom Role unlocks it, seeded from whatever was showing.
*/

import { useEffect, useRef, useState } from "react";
import { FormField, inputClass, inputErrorClass } from "@/components/FormField";
import { Icon } from "@/components/icons";
import {
  createUser,
  updateUser,
  isEmailTaken,
  isUsernameTaken,
  defaultPermissionsForRole,
  ROLE_DEFS,
  type PublicUser,
  type RoleId,
  type UserStatus,
  type Permissions,
} from "@/lib/users";
import { Btn, ModalHeader, ModalShell, Avatar } from "./ui";
import { PermissionMatrix } from "./PermissionMatrix";

const DEPARTMENTS = ["Finance", "Accounts Receivable", "Accounting", "Sales", "Operations", "Management", "IT", "Customer Support"];
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;

export function UserFormModal({
  mode,
  initial,
  performedBy,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: PublicUser | null;
  performedBy: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [usernameTouched, setUsernameTouched] = useState(mode === "edit");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [designation, setDesignation] = useState(initial?.designation ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(initial?.photoDataUrl ?? null);
  const [role, setRole] = useState<RoleId>(initial?.role ?? "viewer");
  const [status, setStatus] = useState<UserStatus>(initial?.status ?? "active");
  const [permissions, setPermissions] = useState<Permissions>(initial?.permissions ?? defaultPermissionsForRole("viewer"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Create mode: default the username to the email until the admin edits it directly.
  useEffect(() => {
    if (mode === "create" && !usernameTouched) setUsername(email.trim());
  }, [email, usernameTouched, mode]);

  const onRoleChange = (r: RoleId) => {
    setRole(r);
    if (r !== "custom") setPermissions(defaultPermissionsForRole(r));
    // switching TO custom keeps whatever permissions were already showing as a starting point
  };

  const onPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((e) => ({ ...e, photo: "Please choose an image file." }));
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setErrors((e) => ({ ...e, photo: "Image must be under 1.5 MB." }));
      return;
    }
    setErrors((e) => ({ ...e, photo: "" }));
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  async function validate(): Promise<Record<string, string>> {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = "Full name is required.";
    if (!email.trim()) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Enter a valid email address.";
    if (!username.trim()) errs.username = "Username is required.";
    else if (username.trim().length < 3 || /\s/.test(username.trim())) errs.username = "At least 3 characters, no spaces.";

    if (mode === "create") {
      if (!password) errs.password = "Temporary password is required.";
      else if (password.length < 8) errs.password = "Must be at least 8 characters.";
      if (confirmPassword !== password) errs.confirmPassword = "Passwords don't match.";
    }
    if (!errs.email && (await isEmailTaken(email.trim(), mode === "edit" ? initial?.id : undefined))) {
      errs.email = "This email is already in use.";
    }
    if (!errs.username && (await isUsernameTaken(username.trim(), mode === "edit" ? initial?.id : undefined))) {
      errs.username = "This username is already taken.";
    }
    return errs;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const errs = await validate();
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setSaving(false);
      return;
    }
    try {
      if (mode === "create") {
        await createUser(
          {
            fullName: fullName.trim(),
            email: email.trim(),
            username: username.trim(),
            password,
            employeeId: employeeId || null,
            department: department || null,
            designation: designation || null,
            phone: phone || null,
            photoDataUrl,
            role,
            status,
            permissions,
          },
          performedBy,
        );
        onSaved(`${fullName.trim()} was added successfully.`);
      } else if (initial) {
        await updateUser(
          initial.id,
          {
            fullName: fullName.trim(),
            email: email.trim(),
            username: username.trim(),
            employeeId: employeeId || null,
            department: department || null,
            designation: designation || null,
            phone: phone || null,
            photoDataUrl,
            role,
            status,
            permissions,
          },
          performedBy,
        );
        onSaved(`${fullName.trim()} was updated.`);
      }
      onClose();
    } catch {
      setErrors({ _global: "Something went wrong saving this user. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} wide>
      <ModalHeader
        title={mode === "create" ? "Add User" : `Edit User — ${initial?.fullName ?? ""}`}
        subtitle={mode === "create" ? "Create a login and assign access." : "Update personal details and access."}
        onClose={onClose}
      />
      <form id="user-form-modal" onSubmit={submit} className="flex-1 overflow-y-auto p-6">
        {errors._global && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{errors._global}</p>
        )}

        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Personal Details</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 flex items-center gap-4">
            <Avatar name={fullName || "New User"} photoDataUrl={photoDataUrl} size={56} />
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
              <Btn icon="camera" onClick={() => fileRef.current?.click()}>
                {photoDataUrl ? "Change photo" : "Upload photo"}
              </Btn>
              {photoDataUrl && (
                <button type="button" onClick={() => setPhotoDataUrl(null)} className="ml-2 text-xs text-slate-400 hover:text-red-600">
                  Remove
                </button>
              )}
              {errors.photo && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{errors.photo}</p>}
            </div>
          </div>

          <FormField label="Full Name *" error={errors.fullName}>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={errors.fullName ? inputErrorClass : inputClass} placeholder="e.g. Priya Sharma" />
          </FormField>
          <FormField label="Email Address *" error={errors.email}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={errors.email ? inputErrorClass : inputClass} placeholder="name@company.com" />
          </FormField>
          <FormField label="Username *" error={errors.username}>
            <input
              value={username}
              onChange={(e) => {
                setUsernameTouched(true);
                setUsername(e.target.value);
              }}
              className={errors.username ? inputErrorClass : inputClass}
              placeholder="Used to sign in"
            />
          </FormField>
          <FormField label="Phone Number">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="phone" size={15} /></span>
              <input type="tel" value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} className={`${inputClass} pl-9 w-full`} placeholder="+91 98765 43210" />
            </div>
          </FormField>

          {mode === "create" && (
            <>
              <FormField label="Temporary Password *" error={errors.password}>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${errors.password ? inputErrorClass : inputClass} w-full pr-9`}
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand">
                    <Icon name={showPw ? "eyeOff" : "eye"} size={16} />
                  </button>
                </div>
              </FormField>
              <FormField label="Confirm Password *" error={errors.confirmPassword}>
                <input
                  type={showPw ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={errors.confirmPassword ? inputErrorClass : inputClass}
                  autoComplete="new-password"
                />
              </FormField>
            </>
          )}

          <FormField label="Employee ID">
            <input value={employeeId ?? ""} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass} placeholder="Optional" />
          </FormField>
          <FormField label="Department">
            <input list="user-departments" value={department ?? ""} onChange={(e) => setDepartment(e.target.value)} className={inputClass} placeholder="e.g. Finance" />
            <datalist id="user-departments">
              {DEPARTMENTS.map((d) => (<option key={d} value={d} />))}
            </datalist>
          </FormField>
          <FormField label="Designation">
            <input value={designation ?? ""} onChange={(e) => setDesignation(e.target.value)} className={inputClass} placeholder="e.g. Senior Accountant" />
          </FormField>
        </div>

        <p className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">Access</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Role">
            <select value={role} onChange={(e) => onRoleChange(e.target.value as RoleId)} className={inputClass}>
              {ROLE_DEFS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as UserStatus)} className={inputClass}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FormField>
        </div>
        <p className="mt-1 text-xs text-slate-400">{ROLE_DEFS.find((r) => r.id === role)?.description}</p>

        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Permissions</span>
            {role !== "custom" && <span className="text-[11px] text-slate-400">Set by role — choose Custom Role to edit</span>}
          </div>
          <PermissionMatrix permissions={permissions} onChange={role === "custom" ? setPermissions : undefined} disabled={role !== "custom"} />
        </div>
      </form>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" type="submit" form="user-form-modal" icon="check" disabled={saving}>
          {saving ? "Saving…" : mode === "create" ? "Create User" : "Save Changes"}
        </Btn>
      </div>
    </ModalShell>
  );
}
