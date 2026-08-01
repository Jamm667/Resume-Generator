import { notFound } from "next/navigation";

import { ApplicationWorkspace } from "@/components/applications/application-workspace";
import { LibraryPane } from "@/components/builder/library-pane";
import { Nav } from "@/components/nav";
import { prisma } from "@/lib/db";
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

  const library = await getRelevanceLibrary(user.id, application.id);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl p-8">
        <ApplicationWorkspace
          application={{
            id: application.id,
            name: application.name,
            companyName: application.companyName ?? "",
            roleTitle: application.roleTitle ?? "",
            jdText: application.jdText,
          }}
        >
          <LibraryPane applicationId={application.id} bullets={library} />
        </ApplicationWorkspace>
      </main>
    </>
  );
}
