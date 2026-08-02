"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/bank/confirm-dialog";

type Workspace = {
  id: string;
  name: string;
  companyName: string;
  roleTitle: string;
  jdText: string;
};

/**
 * Sections later issues fill in. They are rendered as explicit placeholders
 * rather than omitted so the shape of the workspace is visible from the start.
 */
const PLACEHOLDERS = [
  {
    title: "Tailoring",
    body: "Per-bullet rewrites proposed against this job description, each accepted or rejected on its own.",
    issue: "RE-10",
  },
  {
    title: "Cover letter",
    body: "A BLUF cover letter generated from the draft and this posting.",
    issue: "RE-11",
  },
];

export function ApplicationWorkspace({
  application,
  children,
}: {
  application: Workspace;
  /** Sections rendered under the job description, above the placeholders. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [form, setForm] = useState(application);
  const [saved, setSaved] = useState(application);
  const [isJdOpen, setIsJdOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const isDirty =
    form.name !== saved.name ||
    form.companyName !== saved.companyName ||
    form.roleTitle !== saved.roleTitle;

  async function save() {
    setIsSaving(true);
    setErrors({});
    setSavedAt(null);

    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          companyName: form.companyName,
          roleTitle: form.roleTitle,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(data?.errors ?? { form: `Could not save (${response.status}).` });
        return;
      }

      const next = {
        ...form,
        name: data.name,
        companyName: data.companyName ?? "",
        roleTitle: data.roleTitle ?? "",
      };
      setForm(next);
      setSaved(next);
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    } catch (caught) {
      setErrors({
        form: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function remove() {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Could not delete (${response.status}).`);
      }
      router.push("/applications");
    } catch (caught) {
      setErrors({
        form: caught instanceof Error ? caught.message : String(caught),
      });
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4">
          <label className="text-xs font-medium text-slate-700">
            Name
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              aria-invalid={Boolean(errors.name)}
              className={`mt-1 w-full rounded-lg border p-2 text-sm ${
                errors.name ? "border-red-400" : "border-slate-300"
              }`}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-700">{errors.name}</p>
            )}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              Company
              <input
                value={form.companyName}
                onChange={(event) =>
                  setForm({ ...form, companyName: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Role
              <input
                value={form.roleTitle}
                onChange={(event) =>
                  setForm({ ...form, roleTitle: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
              />
            </label>
          </div>
        </div>

        {errors.form && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {errors.form}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving || !isDirty}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
          >
            Delete application
          </button>
          {savedAt && (
            <span className="text-sm text-emerald-700">Saved at {savedAt}</span>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <button
          type="button"
          onClick={() => setIsJdOpen((open) => !open)}
          aria-expanded={isJdOpen}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <h2 className="text-sm font-semibold">Job description</h2>
          <span className="text-xs text-slate-500">
            {isJdOpen ? "Hide" : "Show"} ·{" "}
            {application.jdText.length.toLocaleString()} characters
          </span>
        </button>

        {isJdOpen && (
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
            {application.jdText}
          </pre>
        )}
      </section>

      {children}

      {PLACEHOLDERS.map((section) => (
        <section
          key={section.title}
          className="rounded-xl border border-dashed border-slate-300 bg-white p-5"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-700">
              {section.title}
            </h2>
            <span className="shrink-0 text-xs text-slate-400">
              {section.issue}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{section.body}</p>
        </section>
      ))}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this application?"
          description={`“${saved.name}” will be permanently removed, along with its draft, relevance scores, and cover letter. Your data bank is not affected.`}
          confirmLabel="Delete application"
          isBusy={isDeleting}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
