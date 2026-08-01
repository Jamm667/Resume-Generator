import { UploadDropZone } from "@/components/upload-drop-zone";
import { requireUser } from "@/lib/require-user";

export default async function UploadPage() {
  await requireUser();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold">Upload resumes</h1>
      <p className="mt-1 text-sm text-slate-600">
        Every file is read into plain text. Image-only PDFs — Figma exports, for
        instance — are transcribed automatically.
      </p>

      <div className="mt-6">
        <UploadDropZone />
      </div>
    </main>
  );
}
