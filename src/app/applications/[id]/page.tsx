import { notFound } from "next/navigation";

import { ApplicationWorkspace } from "@/components/applications/application-workspace";
import { BuilderShell } from "@/components/builder/builder-shell";
import { Nav } from "@/components/nav";
import { prisma } from "@/lib/db";
import { toDraftView } from "@/lib/draft/view";
import { getExperienceSummaries } from "@/lib/queries/bank";
import { getDraft } from "@/lib/queries/draft";
import { getRelevanceLibrary } from "@/lib/queries/relevance";
import { requireUser } from "@/lib/require-user";

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  // Scoped by userId, so another user's id is a 404 like any missing row.
  const application = await prisma.application.findFirst({
    where: { id, userId: user.id },
  });

  if (!application) {
    notFound();
  }

  const [library, experiences, draft] = await Promise.all([
    getRelevanceLibrary(user.id, application.id),
    getExperienceSummaries(user.id),
    getDraft(user.id, application.id),
  ]);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl p-8">
        <ApplicationWorkspace
          application={{
            id: application.id,
            name: application.name,
            companyName: application.companyName ?? "",
            roleTitle: application.roleTitle ?? "",
            jdText: application.jdText,
          }}
        >
          <BuilderShell
            applicationId={application.id}
            bullets={library}
            experiences={experiences}
            draft={toDraftView(draft)}
          />
        </ApplicationWorkspace>
      </main>
    </>
  );
}
