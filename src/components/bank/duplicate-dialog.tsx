"use client";

import { useEffect, useState } from "react";

import type { BankBullet } from "@/lib/queries/bank";

/**
 * The flagged bullet next to the one it matched. Neither resolution happens
 * on its own — RE-4 only flags, and the user decides here.
 */
export function DuplicateDialog({
  bullet,
  onKeepBoth,
  onDelete,
  onClose,
}: {
  bullet: BankBullet;
  onKeepBoth: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, isBusy]);

  async function run(action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Possible duplicate"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => !isBusy && onClose()}
    >
      <div
        className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Possible duplicate</h2>
        <p className="mt-1 text-sm text-slate-600">
          These two bullets look like the same achievement. Nothing has been
          changed — choose what to keep.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              This bullet
            </h3>
            <p className="mt-2 text-sm text-slate-900">{bullet.text}</p>
          </section>

          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Already in your bank
            </h3>
            <p className="mt-2 text-sm text-slate-900">
              {bullet.duplicateOf?.text}
            </p>
          </section>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            Decide later
          </button>
          <button
            type="button"
            onClick={() => void run(onKeepBoth)}
            disabled={isBusy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            Keep both
          </button>
          <button
            type="button"
            onClick={() => void run(onDelete)}
            disabled={isBusy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            Delete this one
          </button>
        </div>
      </div>
    </div>
  );
}
