"use client";

import { useState } from "react";

import type { ProfileLink } from "@/lib/validation/profile";

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  links: ProfileLink[];
};

const TEXT_FIELDS = [
  { key: "fullName", label: "Full name", placeholder: "Dana Whitfield" },
  { key: "email", label: "Email", placeholder: "dana@example.com" },
  { key: "phone", label: "Phone", placeholder: "+1 555 0142" },
  { key: "location", label: "Location", placeholder: "Toronto, ON" },
  {
    key: "headline",
    label: "Headline",
    placeholder: "Senior Platform Engineer",
  },
] as const;

export function ProfileForm({ initial }: { initial: FormState }) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  function updateLink(index: number, patch: Partial<ProfileLink>) {
    update(
      "links",
      form.links.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    );
  }

  function moveLink(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= form.links.length) return;

    const next = [...form.links];
    [next[index], next[target]] = [next[target], next[index]];
    update("links", next);
  }

  async function save() {
    setIsSaving(true);
    setErrors({});
    setSavedAt(null);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        // Field-level errors keep the save blocked and point at the input.
        setErrors(data?.errors ?? { form: `Could not save (${response.status}).` });
        return;
      }

      setForm({
        fullName: data.fullName ?? "",
        email: data.email ?? "",
        phone: data.phone ?? "",
        location: data.location ?? "",
        headline: data.headline ?? "",
        links: data.links ?? [],
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (caught) {
      setErrors({ form: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {TEXT_FIELDS.map((field) => (
            <label
              key={field.key}
              className={`text-xs font-medium text-slate-700 ${
                field.key === "headline" ? "sm:col-span-2" : ""
              }`}
            >
              {field.label}
              <input
                value={form[field.key]}
                onChange={(event) => update(field.key, event.target.value)}
                placeholder={field.placeholder}
                aria-invalid={Boolean(errors[field.key])}
                aria-describedby={
                  errors[field.key] ? `error-${field.key}` : undefined
                }
                className={`mt-1 w-full rounded-lg border p-2 text-sm ${
                  errors[field.key] ? "border-red-400" : "border-slate-300"
                }`}
              />
              {errors[field.key] && (
                <p id={`error-${field.key}`} className="mt-1 text-xs text-red-700">
                  {errors[field.key]}
                </p>
              )}
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Links</h2>
          <button
            type="button"
            onClick={() =>
              update("links", [...form.links, { label: "", url: "" }])
            }
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-100"
          >
            Add link
          </button>
        </div>

        {form.links.length === 0 && (
          <p className="mt-3 text-xs text-slate-500">
            No links yet — a LinkedIn or portfolio URL goes here.
          </p>
        )}

        <ul className="mt-3 space-y-3">
          {form.links.map((link, index) => (
            <li
              key={index}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    aria-label={`Link ${index + 1} label`}
                    value={link.label}
                    onChange={(event) =>
                      updateLink(index, { label: event.target.value })
                    }
                    placeholder="LinkedIn"
                    aria-invalid={Boolean(errors[`links.${index}.label`])}
                    className={`w-full rounded-lg border p-2 text-sm ${
                      errors[`links.${index}.label`]
                        ? "border-red-400"
                        : "border-slate-300"
                    }`}
                  />
                  {errors[`links.${index}.label`] && (
                    <p className="mt-1 text-xs text-red-700">
                      {errors[`links.${index}.label`]}
                    </p>
                  )}
                </div>

                <div className="min-w-0 flex-[2]">
                  <input
                    aria-label={`Link ${index + 1} URL`}
                    value={link.url}
                    onChange={(event) =>
                      updateLink(index, { url: event.target.value })
                    }
                    placeholder="https://linkedin.com/in/you"
                    aria-invalid={Boolean(errors[`links.${index}.url`])}
                    className={`w-full rounded-lg border p-2 text-sm ${
                      errors[`links.${index}.url`]
                        ? "border-red-400"
                        : "border-slate-300"
                    }`}
                  />
                  {errors[`links.${index}.url`] && (
                    <p className="mt-1 text-xs text-red-700">
                      {errors[`links.${index}.url`]}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Move link ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => moveLink(index, -1)}
                    className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move link ${index + 1} down`}
                    disabled={index === form.links.length - 1}
                    onClick={() => moveLink(index, 1)}
                    className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove link ${index + 1}`}
                    onClick={() =>
                      update(
                        "links",
                        form.links.filter((_, i) => i !== index),
                      )
                    }
                    className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {errors.links && (
          <p className="mt-2 text-xs text-red-700">{errors.links}</p>
        )}
      </section>

      {errors.form && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errors.form}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={isSaving}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save profile"}
        </button>
        {savedAt && (
          <span className="text-sm text-emerald-700">Saved at {savedAt}</span>
        )}
      </div>
    </div>
  );
}
