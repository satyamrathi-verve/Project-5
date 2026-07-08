"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass, inputErrorClass } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import {
  loadMetas,
  setMeta,
  deleteMeta,
  BLANK_META,
  type CustomerMeta,
  type CustomerStatus,
} from "@/lib/customerMeta";

/*
  The database stores one `address` text field, so the structured address inputs
  are joined with ", " on save and split back apart when editing.
*/
const ADDRESS_PARTS = ["line1", "line2", "city", "state", "pin", "country"] as const;

const PAYMENT_TERMS = [
  { label: "Due on Receipt", days: 0 },
  { label: "Net 15", days: 15 },
  { label: "Net 30", days: 30 },
  { label: "Net 45", days: 45 },
] as const;

/*
  Validation patterns. GSTIN and PAN are optional, but anything typed must be the
  right length and shape or the record won't save.
    GSTIN → 15 chars: 2-digit state code, 5 letters, 4 digits, 1 letter, 1 alnum, 'Z', 1 alnum
    PAN   → 10 chars: 5 letters, 4 digits, 1 letter
*/
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BLANK = {
  code: "",
  name: "",
  gstin: "",
  pan: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  pin: "",
  country: "",
  contact_person: "",
  email: "",
  phone: "",
  secondary_phone: "",
  secondary_email: "",
  status: "active" as CustomerStatus,
  credit_days: "30",
  credit_limit: "0",
  opening_balance: "0",
};

type FormValues = typeof BLANK;
type FieldErrors = Partial<Record<keyof FormValues, string>>;

function termsForDays(days: string): string {
  const match = PAYMENT_TERMS.find((t) => t.days === Number(days));
  return match ? match.label : "Custom";
}

function splitAddress(address: string | null): Pick<FormValues, (typeof ADDRESS_PARTS)[number]> {
  const parts = (address ?? "").split(", ");
  return {
    line1: parts[0] ?? "",
    line2: parts[1] ?? "",
    city: parts[2] ?? "",
    state: parts[3] ?? "",
    pin: parts[4] ?? "",
    country: parts.slice(5).join(", "),
  };
}

/** Returns a map of field → error message. Empty map means the form is valid. */
function validate(v: FormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!v.code.trim()) errors.code = "Customer Code is required.";
  if (!v.name.trim()) errors.name = "Legal Customer Name is required.";

  const gstin = v.gstin.trim().toUpperCase();
  if (gstin) {
    if (gstin.length !== 15) errors.gstin = "GSTIN must be exactly 15 characters.";
    else if (!GSTIN_RE.test(gstin)) errors.gstin = "GSTIN format is invalid (e.g. 27AABCS1111A1Z1).";
  }

  const pan = v.pan.trim().toUpperCase();
  if (pan) {
    if (pan.length !== 10) errors.pan = "PAN must be exactly 10 characters.";
    else if (!PAN_RE.test(pan)) errors.pan = "PAN format is invalid (e.g. AABCS1111A).";
  }

  if (v.email.trim() && !EMAIL_RE.test(v.email.trim()))
    errors.email = "Enter a valid email address.";
  if (v.secondary_email.trim() && !EMAIL_RE.test(v.secondary_email.trim()))
    errors.secondary_email = "Enter a valid email address.";

  return errors;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</legend>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );
}

function StatusBadge({ status }: { status: CustomerStatus }) {
  const active = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active
          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
          : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-500" : "bg-slate-400"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default function CustomerMasterPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [metas, setMetas] = useState<Record<string, CustomerMeta>>({});
  /*
    True once the customers table has the secondary_phone / secondary_email /
    status columns (see the migration note in the summary). When true the extras
    live on the real row and sync everywhere; when false they fall back to the
    browser's localStorage. Detected by probing the columns on load.
  */
  const [hasMetaColumns, setHasMetaColumns] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CustomerStatus>("all");
  const [selected, setSelected] = useState<string[]>([]);

  /* null = form closed; "new" = adding; a Customer = editing that row. */
  const [editing, setEditing] = useState<"new" | Customer | null>(null);
  const [values, setValues] = useState<FormValues>(BLANK);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* { ids, label } while a delete is awaiting confirmation. */
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* Read a customer's extras from the real columns if they exist, else localStorage. */
  function metaFor(c: Customer): CustomerMeta {
    if (hasMetaColumns) {
      return {
        secondaryPhone: c.secondary_phone ?? "",
        secondaryEmail: c.secondary_email ?? "",
        status: (c.status as CustomerStatus) || "active",
      };
    }
    return metas[c.id] ?? BLANK_META;
  }

  async function loadCustomers() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from("customers").select("*").order("code");
    if (error) setError(error.message);
    else setCustomers(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    setMetas(loadMetas());
    // Probe whether the extras columns exist; PostgREST errors if they don't.
    (async () => {
      if (!supabase) return;
      const { error } = await supabase
        .from("customers")
        .select("secondary_phone,secondary_email,status")
        .limit(1);
      setHasMetaColumns(!error);
    })();
    loadCustomers();
  }, []);

  function openAdd() {
    setValues(BLANK);
    setFieldErrors({});
    setFormError(null);
    setEditing("new");
  }

  function openEdit(c: Customer) {
    const meta = metaFor(c);
    setValues({
      code: c.code,
      name: c.name,
      gstin: c.gstin ?? "",
      pan: c.pan ?? "",
      ...splitAddress(c.address),
      contact_person: c.contact_person ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      secondary_phone: meta.secondaryPhone,
      secondary_email: meta.secondaryEmail,
      status: meta.status,
      credit_days: String(c.credit_days),
      credit_limit: String(c.credit_limit),
      opening_balance: String(c.opening_balance),
    });
    setFieldErrors({});
    setFormError(null);
    setEditing(c);
  }

  function set(field: keyof FormValues) {
    return (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [field]: e.target.value }));
  }

  function setTerms(e: { target: { value: string } }) {
    const term = PAYMENT_TERMS.find((t) => t.label === e.target.value);
    if (term) setValues((v) => ({ ...v, credit_days: String(term.days) }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !editing) return;

    const errors = validate(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please fix the highlighted fields before saving.");
      return;
    }

    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const address = ADDRESS_PARTS.map((p) => values[p].trim())
      .filter(Boolean)
      .join(", ");
    const row: Record<string, unknown> = {
      code: values.code.trim(),
      name: values.name.trim(),
      gstin: values.gstin.trim().toUpperCase() || null,
      pan: values.pan.trim().toUpperCase() || null,
      address: address || null,
      contact_person: values.contact_person.trim() || null,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      credit_days: Number(values.credit_days) || 0,
      credit_limit: Number(values.credit_limit) || 0,
      opening_balance: Number(values.opening_balance) || 0,
    };
    // When the real columns exist, save the extras straight onto the row.
    if (hasMetaColumns) {
      row.secondary_phone = values.secondary_phone.trim() || null;
      row.secondary_email = values.secondary_email.trim() || null;
      row.status = values.status;
    }

    const { data, error } =
      editing === "new"
        ? await supabase.from("customers").insert(row).select().single()
        : await supabase.from("customers").update(row).eq("id", editing.id).select().single();

    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }

    // No real columns yet → keep the extras in localStorage against the row's id.
    if (!hasMetaColumns) {
      const id = editing === "new" ? (data as Customer).id : editing.id;
      const meta: CustomerMeta = {
        secondaryPhone: values.secondary_phone.trim(),
        secondaryEmail: values.secondary_email.trim(),
        status: values.status,
      };
      setMeta(id, meta);
      setMetas((m) => ({ ...m, [id]: meta }));
    }

    setEditing(null);
    await loadCustomers();
  }

  async function performDelete(ids: string[]) {
    if (!supabase || ids.length === 0) return;
    setDeleting(true);
    const { error } = await supabase.from("customers").delete().in("id", ids);
    setDeleting(false);
    if (error) {
      setError(error.message);
      setConfirmDelete(null);
      return;
    }
    ids.forEach(deleteMeta);
    setMetas((m) => {
      const next = { ...m };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setSelected((s) => s.filter((id) => !ids.includes(id)));
    setConfirmDelete(null);
    await loadCustomers();
  }

  if (!isConfigured) return <NotConfigured />;

  const q = search.trim().toLowerCase();
  const visible = customers.filter((c) => {
    if (statusFilter !== "all" && metaFor(c).status !== statusFilter) return false;
    if (!q) return true;
    const meta = metaFor(c);
    return (
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.contact_person ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").toLowerCase().includes(q) ||
      meta.secondaryEmail.toLowerCase().includes(q) ||
      meta.secondaryPhone.toLowerCase().includes(q)
    );
  });

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code", className: "font-medium" },
    { key: "name", header: "Name" },
    {
      key: "contact",
      header: "Contact",
      value: (c) => {
        const meta = metaFor(c);
        return [c.contact_person, c.email, c.phone, meta.secondaryEmail, meta.secondaryPhone]
          .filter(Boolean)
          .join(" ");
      },
      render: (c) => {
        const meta = metaFor(c);
        const secondary = [meta.secondaryEmail, meta.secondaryPhone].filter(Boolean).join(" · ");
        return (
          <div>
            <div>{c.contact_person ?? "—"}</div>
            {(c.email || c.phone) && (
              <div className="text-xs text-slate-400">
                {[c.email, c.phone].filter(Boolean).join(" · ")}
              </div>
            )}
            {secondary && (
              <div className="text-xs text-slate-400">
                <span className="text-slate-300">2nd:</span> {secondary}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      value: (c) => metaFor(c).status,
      render: (c) => <StatusBadge status={metaFor(c).status} />,
    },
    {
      key: "credit_days",
      header: "Payment terms",
      className: "text-right",
      value: (c) => c.credit_days,
      render: (c) => {
        const label = termsForDays(String(c.credit_days));
        return label === "Custom" ? `${c.credit_days} days` : label;
      },
    },
    {
      key: "credit_limit",
      header: "Credit limit",
      className: "text-right",
      value: (c) => c.credit_limit,
      render: (c) => `₹ ${c.credit_limit.toLocaleString("en-IN")}`,
    },
    {
      key: "actions",
      header: "",
      className: "w-32 text-right",
      render: (c) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => openEdit(c)}
            className="rounded-lg px-3 py-1 text-sm font-medium text-brand hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Edit
          </button>
          <button
            onClick={() => setConfirmDelete({ ids: [c.id], label: c.name })}
            className="rounded-lg px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Customer Master"
        subtitle="The reference list of customers every other screen leans on."
        action={
          <button
            onClick={openAdd}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + Add customer
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code, name, contact, email or phone…"
          className={`${inputClass} w-full max-w-sm`}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | CustomerStatus)}
          className={inputClass}
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <span className="text-sm text-slate-400">
          {visible.length} of {customers.length}
        </span>
      </div>

      {selected.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {selected.length} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected([])}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Clear
            </button>
            <button
              onClick={() =>
                setConfirmDelete({
                  ids: selected,
                  label: `${selected.length} customers`,
                })
              }
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          Couldn&apos;t load customers: {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          Loading customers…
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={visible}
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
          empty={
            q || statusFilter !== "all"
              ? "No customers match your filters."
              : "No customers yet — add the first one."
          }
        />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={handleSave}
            noValidate
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900"
          >
            <h3 className="mb-5 text-lg font-bold text-slate-900 dark:text-slate-100">
              {editing === "new" ? "Add customer" : `Edit ${editing.name}`}
            </h3>

            <Section title="Basic Details">
              <FormField label="Customer Code *" error={fieldErrors.code}>
                <input
                  className={fieldErrors.code ? inputErrorClass : inputClass}
                  value={values.code}
                  onChange={set("code")}
                  placeholder="CUST-001"
                />
              </FormField>
              <FormField label="Legal Customer Name *" error={fieldErrors.name}>
                <input
                  className={fieldErrors.name ? inputErrorClass : inputClass}
                  value={values.name}
                  onChange={set("name")}
                  placeholder="Acme Traders Pvt Ltd"
                />
              </FormField>
              <FormField label="Status">
                <select className={inputClass} value={values.status} onChange={set("status")}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </FormField>
            </Section>

            <Section title="Tax Details">
              <FormField label="GSTIN" error={fieldErrors.gstin}>
                <input
                  className={fieldErrors.gstin ? inputErrorClass : inputClass}
                  value={values.gstin}
                  onChange={set("gstin")}
                  placeholder="27AABCS1111A1Z1"
                />
              </FormField>
              <FormField label="PAN" error={fieldErrors.pan}>
                <input
                  className={fieldErrors.pan ? inputErrorClass : inputClass}
                  value={values.pan}
                  onChange={set("pan")}
                  placeholder="AABCS1111A"
                />
              </FormField>
            </Section>

            <Section title="Billing Address">
              <FormField label="Address Line 1">
                <input className={inputClass} value={values.line1} onChange={set("line1")} />
              </FormField>
              <FormField label="Address Line 2">
                <input className={inputClass} value={values.line2} onChange={set("line2")} />
              </FormField>
              <FormField label="City">
                <input className={inputClass} value={values.city} onChange={set("city")} />
              </FormField>
              <FormField label="State">
                <input className={inputClass} value={values.state} onChange={set("state")} />
              </FormField>
              <FormField label="PIN Code">
                <input className={inputClass} value={values.pin} onChange={set("pin")} />
              </FormField>
              <FormField label="Country">
                <input className={inputClass} value={values.country} onChange={set("country")} placeholder="India" />
              </FormField>
            </Section>

            <Section title="Primary Contact">
              <FormField label="Contact Person">
                <input className={inputClass} value={values.contact_person} onChange={set("contact_person")} />
              </FormField>
              <FormField label="Phone">
                <input className={inputClass} value={values.phone} onChange={set("phone")} />
              </FormField>
              <div className="col-span-2">
                <FormField label="Email" error={fieldErrors.email}>
                  <input
                    className={`${fieldErrors.email ? inputErrorClass : inputClass} w-full`}
                    type="email"
                    value={values.email}
                    onChange={set("email")}
                  />
                </FormField>
              </div>
            </Section>

            <Section title="Secondary Contact">
              <FormField label="Secondary Phone">
                <input
                  className={inputClass}
                  value={values.secondary_phone}
                  onChange={set("secondary_phone")}
                  placeholder="+91 98••• •••••"
                />
              </FormField>
              <FormField label="Secondary Email" error={fieldErrors.secondary_email}>
                <input
                  className={fieldErrors.secondary_email ? inputErrorClass : inputClass}
                  type="email"
                  value={values.secondary_email}
                  onChange={set("secondary_email")}
                />
              </FormField>
            </Section>

            <Section title="Credit & Payment Terms">
              <FormField label="Payment Terms">
                <select className={inputClass} value={termsForDays(values.credit_days)} onChange={setTerms}>
                  {PAYMENT_TERMS.map((t) => (
                    <option key={t.label} value={t.label}>
                      {t.label}
                    </option>
                  ))}
                  <option value="Custom">Custom</option>
                </select>
              </FormField>
              <FormField label="Credit Days">
                <input className={inputClass} type="number" min="0" value={values.credit_days} onChange={set("credit_days")} />
              </FormField>
              <FormField label="Credit Limit (₹)">
                <input className={inputClass} type="number" min="0" value={values.credit_limit} onChange={set("credit_limit")} />
              </FormField>
              <FormField label="Opening Balance (₹)">
                <input className={inputClass} type="number" value={values.opening_balance} onChange={set("opening_balance")} />
              </FormField>
            </Section>

            {editing !== "new" && (
              <Section title="Audit Information">
                <FormField label="Created Date">
                  <input
                    className={`${inputClass} bg-slate-50 text-slate-500`}
                    value={new Date(editing.created_at).toLocaleString("en-IN")}
                    readOnly
                  />
                </FormField>
              </Section>
            )}

            {formError && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : editing === "new" ? "Add customer" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="mb-2 text-lg font-bold text-slate-900 dark:text-slate-100">Delete customer?</h3>
            <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">
              You&apos;re about to permanently delete{" "}
              <span className="font-semibold text-slate-900 dark:text-slate-100">{confirmDelete.label}</span>. This
              can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => performDelete(confirmDelete.ids)}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
