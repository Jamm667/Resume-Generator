import Link from "next/link";

import { Nav } from "@/components/nav";
import { listApplications } from "@/lib/queries/applications";
import { requireUser } from "@/lib/require-user";

function formatUpdated(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function ApplicationsPage() {
  const user = await requireUser();
  const applications = await listApplications(user.id);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Applications</h1>
            <p className="mt-1 text-sm text-slate-600">
              One workspace per job, holding its description and everything you
              build against it.
            </p>
          </div>
          <Link
            href="/applications/new"
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            New application
          </Link>
        </div>

        {applications.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h2 className="text-sm font-semibold">No applications yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
              Paste a job description and it becomes a workspace you can return
              to — your data bank stays shared across all of them.
            </p>
            <Link
              href="/applications/new"
              className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              Paste your first job description
            </Link>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {applications.map((application) => (
              <li key={application.id}>
                <Link
                  href={`/applications/${application.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="truncate text-sm font-semibold">
                      {application.name}
                    </h2>
                    <span className="shrink-0 text-xs text-slate-500">
                      {formatUpdated(application.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {[application.companyName, application.roleTitle]
                      .filter(Boolean)
                      .join(" · ") || "No company or role yet"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
