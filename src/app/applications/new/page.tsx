import { Nav } from "@/components/nav";
import { NewApplicationForm } from "@/components/applications/new-application-form";
import { requireUser } from "@/lib/require-user";

export default async function NewApplicationPage() {
  await requireUser();

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-semibold">New application</h1>
        <p className="mt-1 text-sm text-slate-600">
          Paste the job description. Leave company and role blank and they will
          be read from the posting — you can correct them afterwards.
        </p>

        <div className="mt-6">
          <NewApplicationForm />
        </div>
      </main>
    </>
  );
}
