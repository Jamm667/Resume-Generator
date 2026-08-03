"use client";

/**
 * Download the finished work as a PDF.
 *
 * Plain links rather than fetch-and-blob: the route already sets the filename
 * in `Content-Disposition`, and a link works with middle-click, right-click,
 * and the keyboard for free.
 */
export function ExportPanel({
  applicationId,
  hasDraft,
  hasCoverLetter,
}: {
  applicationId: string;
  hasDraft: boolean;
  hasCoverLetter: boolean;
}) {
  const base = `/api/applications/${applicationId}/export/pdf`;

  const enabled =
    "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700";
  const disabled =
    "cursor-not-allowed rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white opacity-50";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold">Export</h2>
      <p className="mt-1 text-xs text-slate-500">
        A single-column PDF with selectable text, which is what applicant
        tracking systems read most reliably.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {hasDraft ? (
          <a href={`${base}?doc=resume`} download className={enabled}>
            Download resume (PDF)
          </a>
        ) : (
          <button type="button" disabled className={disabled}>
            Download resume (PDF)
          </button>
        )}

        {hasCoverLetter ? (
          <a href={`${base}?doc=cover-letter`} download className={enabled}>
            Download cover letter (PDF)
          </a>
        ) : (
          <button type="button" disabled className={disabled}>
            Download cover letter (PDF)
          </button>
        )}
      </div>

      {!hasDraft && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          There is nothing to export yet — drag experience into the Master draft
          above first.
        </p>
      )}

      {hasDraft && !hasCoverLetter && (
        <p className="mt-3 text-sm text-slate-500">
          The resume is ready to download. Generate a cover letter above to
          export that too.
        </p>
      )}
    </section>
  );
}
