"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/bank/confirm-dialog";
import {
  MAX_WORDS,
  MIN_WORDS,
  type CoverLetterTone,
} from "@/lib/cover-letter/prompt";

const TONES: { value: CoverLetterTone; label: string; hint: string }[] = [
  { value: "FORMAL", label: "Formal", hint: "Professional register, no contractions" },
  {
    value: "CONVERSATIONAL",
    label: "Conversational",
    hint: "Warm and human, still precise",
  },
  { value: "DIRECT", label: "Direct", hint: "Short sentences, no throat-clearing" },
];

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Generate, read, and edit the cover letter for one application.
 *
 * The letter is the user's to change: what the model produced lands straight in
 * an editable box, and their edits are what gets saved.
 */
export function CoverLetterPanel({
  applicationId,
  companyName,
  roleTitle,
  initialText,
  initialTone,
  hasDraft,
}: {
  applicationId: string;
  companyName: string;
  roleTitle: string;
  initialText: string;
  initialTone: CoverLetterTone | null;
  hasDraft: boolean;
}) {
  const router = useRouter();
  const [tone, setTone] = useState<CoverLetterTone>(initialTone ?? "DIRECT");
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // Same synchronous guard used elsewhere: state is captured per render, so
  // two clicks in one tick would both see `isGenerating` as false.
  const isRunning = useRef(false);

  const isDirty = text !== saved;
  const hasLetter = saved.trim().length > 0;

  async function generate() {
    if (isRunning.current) return;
    isRunning.current = true;

    setIsGenerating(true);
    setError(null);
    setSavedAt(null);

    try {
      const response = await fetch(
        `/api/applications/${applicationId}/cover-letter`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tone }),
        },
      );
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          (data as { error?: string })?.error ??
            `Could not write the letter (${response.status}).`,
        );
        return;
      }

      const generated = (data as { text: string }).text;
      setText(generated);
      setSaved(generated);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      isRunning.current = false;
      setIsGenerating(false);
      setConfirmRegenerate(false);
    }
  }

  async function save() {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/applications/${applicationId}/cover-letter`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coverLetterText: text }),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(
          (data as { error?: string })?.error ??
            `Could not save (${response.status}).`,
        );
        return;
      }

      setSaved(text);
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }

  const count = words(text);
  const isOutsideRange = count > 0 && (count < MIN_WORDS || count > MAX_WORDS);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold">Cover letter</h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-700">
          Company
          <input
            value={companyName}
            readOnly
            aria-label="Company"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600"
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Role
          <input
            value={roleTitle}
            readOnly
            aria-label="Role"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600"
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Both come from this application — edit them above to change them.
      </p>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-slate-700">Tone</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {TONES.map((option) => (
            <label
              key={option.value}
              title={option.hint}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                tone === option.value
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <input
                type="radio"
                name="tone"
                value={option.value}
                checked={tone === option.value}
                onChange={() => setTone(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            hasLetter ? setConfirmRegenerate(true) : void generate()
          }
          disabled={isGenerating || !hasDraft}
          aria-busy={isGenerating}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {isGenerating
            ? "Writing…"
            : hasLetter
              ? "Regenerate"
              : "Generate cover letter"}
        </button>

        {isGenerating && (
          <span role="status" className="text-sm text-slate-600">
            Writing your letter from the draft…
          </span>
        )}

        {hasLetter && !isGenerating && (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving || !isDirty}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <span className="text-xs text-slate-500">
              {count} words
              {isOutsideRange && ` — outside the ${MIN_WORDS}–${MAX_WORDS} target`}
            </span>
            {savedAt && (
              <span className="text-sm text-emerald-700">Saved at {savedAt}</span>
            )}
          </>
        )}
      </div>

      {!hasDraft && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Your draft is empty. Drag experience into the Master draft above, then
          come back — a letter with nothing behind it is not worth writing.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error} Your existing letter is unchanged.
        </p>
      )}

      {hasLetter && (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={18}
          aria-label="Cover letter"
          className="mt-4 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm leading-relaxed"
        />
      )}

      {confirmRegenerate && (
        <ConfirmDialog
          title="Replace this letter?"
          description={
            isDirty
              ? "Regenerating writes a new letter over this one. You have unsaved edits in the box, and they will be lost."
              : "Regenerating writes a new letter over this one. The current text will be replaced."
          }
          confirmLabel="Regenerate"
          isBusy={isGenerating}
          onConfirm={() => void generate()}
          onCancel={() => setConfirmRegenerate(false)}
        />
      )}
    </section>
  );
}
