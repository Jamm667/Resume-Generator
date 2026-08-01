"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MIN_JD_CHARS = 100;

export function NewApplicationForm() {
  const router = useRouter();
  const [jdText, setJdText] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const shortfall = MIN_JD_CHARS - jdText.trim().length;

  async function submit() {
    // Checked here for immediate feedback; the route enforces it regardless.
    if (jdText.trim().length < MIN_JD_CHARS) {
      setErrors({
        jdText: `Paste the full job description — at least ${MIN_JD_CHARS} characters.`,
      });
      return;
    }

    setIsSaving(true);
    setErrors({});

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText, companyName, roleTitle }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(data?.errors ?? { form: `Could not create (${response.status}).` });
        return;
      }

      router.push(`/applications/${data.id}`);
    } catch (caught) {
      setErrors({
        form: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <label className="text-xs font-medium text-slate-700">
          Job description
          <textarea
            rows={16}
            value={jdText}
            onChange={(event) => setJdText(event.target.value)}
            placeholder="Paste the full posting here…"
            aria-invalid={Boolean(errors.jdText)}
            aria-describedby={errors.jdText ? "error-jdText" : undefined}
            className={`mt-1 w-full rounded-lg border p-3 text-sm ${
              errors.jdText ? "border-red-400" : "border-slate-300"
            }`}
          />
        </label>

        <p className="mt-1 text-xs text-slate-500">
          {jdText.trim().length.toLocaleString()} characters
          {shortfall > 0 && jdText.trim().length > 0
            ? ` · ${shortfall} more needed`
            : ""}
        </p>

        {errors.jdText && (
          <p id="error-jdText" className="mt-1 text-xs text-red-700">
            {errors.jdText}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">
            Company (optional)
            <input
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Read from the posting if blank"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-700">
            Role (optional)
            <input
              value={roleTitle}
              onChange={(event) => setRoleTitle(event.target.value)}
              placeholder="Read from the posting if blank"
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
            />
          </label>
        </div>
      </div>

      {errors.form && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errors.form}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={isSaving}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
      >
        {isSaving ? "Creating…" : "Create application"}
      </button>
    </div>
  );
}
