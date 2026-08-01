"use client";

import { useCallback, useRef, useState } from "react";

const MAX_FILES = 10;
const MAX_FILE_MB = 10;

type RowStatus =
  | "PENDING"
  | "EXTRACTING"
  | "EXTRACTED"
  | "STRUCTURED"
  | "FAILED";

type Row = {
  key: string;
  id: string | null;
  filename: string;
  status: RowStatus;
  extractionMethod: string | null;
  parseError: string | null;
  characters: number;
};

type Rejection = { filename: string; reason: string };

const STATUS_LABEL: Record<RowStatus, string> = {
  PENDING: "Pending",
  EXTRACTING: "Extracting",
  EXTRACTED: "Extracted",
  STRUCTURED: "Added to bank",
  FAILED: "Failed",
};

const STATUS_STYLE: Record<RowStatus, string> = {
  PENDING: "bg-slate-100 text-slate-600",
  EXTRACTING: "bg-amber-100 text-amber-700",
  EXTRACTED: "bg-emerald-100 text-emerald-700",
  STRUCTURED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
};

const METHOD_LABEL: Record<string, string> = {
  TEXT_LAYER: "text layer",
  VISION_OCR: "transcribed",
  PASTED: "pasted",
};

export function UploadDropZone() {
  const [rows, setRows] = useState<Row[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const batch = Date.now();

    // Show every file immediately as Pending, then flip to Extracting for the
    // duration of the request — extraction is synchronous server-side.
    const pending: Row[] = files.map((file, i) => ({
      key: `${batch}-${i}`,
      id: null,
      filename: file.name,
      status: "PENDING",
      extractionMethod: null,
      parseError: null,
      characters: 0,
    }));

    setRejections([]);
    setRows((prev) => [...prev, ...pending]);
    setIsUploading(true);

    const keys = new Set(pending.map((r) => r.key));
    setRows((prev) =>
      prev.map((r) => (keys.has(r.key) ? { ...r, status: "EXTRACTING" } : r)),
    );

    try {
      const body = new FormData();
      for (const file of files) body.append("files", file);

      const response = await fetch("/api/documents", { method: "POST", body });

      if (!response.ok) {
        const message = await response
          .json()
          .then((d) => d?.error as string)
          .catch(() => null);
        throw new Error(message ?? `Upload failed (${response.status}).`);
      }

      const data = await response.json();
      setRejections(data.rejected ?? []);

      const rejectedNames = new Set(
        (data.rejected ?? []).map((r: Rejection) => r.filename),
      );
      const results = [...(data.documents ?? [])];

      setRows((prev) =>
        prev.flatMap((row) => {
          if (!keys.has(row.key)) return [row];
          // Rejected files never became rows server-side; drop them here and
          // let the inline rejection list explain why.
          if (rejectedNames.has(row.filename)) return [];

          const match = results.findIndex((d) => d.filename === row.filename);
          if (match === -1) return [row];
          const [result] = results.splice(match, 1);

          return [
            {
              ...row,
              id: result.id,
              status: result.parseStatus as RowStatus,
              extractionMethod: result.extractionMethod,
              parseError: result.parseError,
              characters: result.characters,
            },
          ];
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRows((prev) =>
        prev.map((row) =>
          keys.has(row.key)
            ? { ...row, status: "FAILED", parseError: message }
            : row,
        ),
      );
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  return (
    <div className="space-y-6">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void upload(event.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          isDragging
            ? "border-slate-900 bg-slate-100"
            : "border-slate-300 bg-white"
        }`}
      >
        <p className="text-sm font-medium">Drop resumes here</p>
        <p className="mt-1 text-sm text-slate-600">
          PDF or DOCX · up to {MAX_FILE_MB} MB each · up to {MAX_FILES} at a time
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx"
          className="hidden"
          onChange={(event) => void upload(event.target.files)}
        />
        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {isUploading ? "Uploading…" : "Choose files"}
        </button>
      </div>

      {rejections.length > 0 && (
        <ul className="space-y-2">
          {rejections.map((rejection) => (
            <li
              key={rejection.filename}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <span className="font-medium">{rejection.filename}</span> —{" "}
              {rejection.reason}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.key}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="truncate text-sm font-medium">{row.filename}</span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[row.status]}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </div>

              {(row.status === "EXTRACTED" || row.status === "STRUCTURED") && (
                <p className="mt-1 text-xs text-slate-600">
                  {row.characters.toLocaleString()} characters
                  {row.extractionMethod
                    ? ` · ${METHOD_LABEL[row.extractionMethod] ?? row.extractionMethod}`
                    : ""}
                </p>
              )}

              {row.status === "FAILED" && (
                <>
                  {row.parseError && (
                    <p className="mt-1 text-xs text-red-700">{row.parseError}</p>
                  )}
                  {row.id && (
                    <PasteFallback
                      documentId={row.id}
                      onSaved={(saved) =>
                        setRows((prev) =>
                          prev.map((r) =>
                            r.key === row.key
                              ? {
                                  ...r,
                                  status: saved.parseStatus,
                                  extractionMethod: saved.extractionMethod,
                                  parseError: saved.parseError,
                                  characters: saved.characters,
                                }
                              : r,
                          ),
                        )
                      }
                    />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SavedPaste = {
  parseStatus: RowStatus;
  extractionMethod: string | null;
  parseError: string | null;
  characters: number;
};

function PasteFallback({
  documentId,
  onSaved,
}: {
  documentId: string;
  onSaved: (saved: SavedPaste) => void;
}) {
  const [text, setText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/paste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        const message = await response
          .json()
          .then((d) => d?.error as string)
          .catch(() => null);
        throw new Error(message ?? `Could not save (${response.status}).`);
      }
      const data = await response.json();
      onSaved({
        parseStatus: (data.parseStatus as RowStatus) ?? "STRUCTURED",
        extractionMethod: data.extractionMethod ?? "PASTED",
        parseError: data.parseError ?? null,
        characters: data.characters ?? text.trim().length,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-3">
      <label
        htmlFor={`paste-${documentId}`}
        className="text-xs font-medium text-slate-700"
      >
        Paste text instead
      </label>
      <textarea
        id={`paste-${documentId}`}
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste the resume text here…"
        className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
      />
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      <button
        type="button"
        disabled={isSaving || text.trim().length === 0}
        onClick={() => void save()}
        className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-100 disabled:opacity-50"
      >
        {isSaving ? "Saving…" : "Save text"}
      </button>
    </div>
  );
}
