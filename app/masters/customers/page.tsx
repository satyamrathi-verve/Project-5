"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";

/* Blank slate for the add/edit form. */
const emptyForm = {
  code: "",
  name: "",
  contact_person: "",
  email: "",
  phone: "",
  credit_days: 30,
  credit_limit: 0,
};

type FormState = typeof emptyForm;

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function CustomerMasterPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // null = form closed; "new" = adding; otherwise the id of the customer being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  async function loadCustomers() {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("code");
    if (error) setError(error.message);
    else setCustomers(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supabase) return <NotConfigured />;

  function openAdd() {
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(c: Customer) {
    setForm({
      code: c.code,
      name: c.name,
      contact_person: c.contact_person ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      credit_days: c.credit_days,
      credit_limit: c.credit_limit,
    });
    setEditing(c.id);
  }

  async function save() {
    if (!supabase) return;
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and Name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      contact_person: form.contact_person.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      credit_days: Number(form.credit_days) || 0,
      credit_limit: Number(form.credit_limit) || 0,
    };
    const { error } =
      editing === "new"
        ? await supabase.from("customers").insert(payload)
        : await supabase.from("customers").update(payload).eq("id", editing);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    loadCustomers();
  }

  const visible = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.contact_person ?? "").toLowerCase().includes(q)
    );
  });

  const columns: Column<Customer>[] = [
    { key: "code", header: "Code", className: "w-28 font-medium" },
    { key: "name", header: "Name" },
    { key: "contact_person", header: "Contact" },
    { key: "phone", header: "Phone" },
    { key: "credit_days", header: "Credit Days", className: "text-right w-28" },
    {
      key: "credit_limit",
      header: "Credit Limit",
      className: "text-right w-36",
      render: (c) => inr.format(c.credit_limit),
    },
    {
      key: "actions",
      header: "",
      className: "w-16 text-right",
      render: (c) => (
        <button
          onClick={() => openEdit(c)}
          className="text-sm font-medium text-brand hover:underline"
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Customer Master"
        subtitle="Every customer we sell to, with their credit terms."
        action={
          <button
            onClick={openAdd}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + Add Customer
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {editing && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">
            {editing === "new" ? "Add Customer" : "Edit Customer"}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Code">
              <input
                className={inputClass}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="CUST-001"
              />
            </FormField>
            <FormField label="Name">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Traders Pvt Ltd"
              />
            </FormField>
            <FormField label="Contact Person">
              <input
                className={inputClass}
                value={form.contact_person}
                onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
              />
            </FormField>
            <FormField label="Email">
              <input
                className={inputClass}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </FormField>
            <FormField label="Phone">
              <input
                className={inputClass}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </FormField>
            <FormField label="Credit Days">
              <input
                className={inputClass}
                type="number"
                value={form.credit_days}
                onChange={(e) => setForm({ ...form, credit_days: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Credit Limit (₹)">
              <input
                className={inputClass}
                type="number"
                value={form.credit_limit}
                onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <div className="mt-5 flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mb-4">
        <input
          className={`${inputClass} w-72`}
          placeholder="Search by name, code or contact…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
          Loading customers…
        </div>
      ) : (
        <DataTable columns={columns} rows={visible} empty="No customers match." />
      )}
    </div>
  );
}
