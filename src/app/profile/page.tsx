import { Nav } from "@/components/nav";
import { ProfileForm } from "@/components/profile-form";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { parseStoredLinks } from "@/lib/validation/profile";

export default async function ProfilePage() {
  const user = await requireUser();

  // Created on first visit so a new account sees an empty form, not an error.
  const profile = await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="mt-1 text-sm text-slate-600">
          The contact block at the top of every resume and cover letter you
          export. Anything parsed from an upload is worth checking.
        </p>

        <div className="mt-6">
          <ProfileForm
            initial={{
              fullName: profile.fullName ?? "",
              email: profile.email ?? "",
              phone: profile.phone ?? "",
              location: profile.location ?? "",
              headline: profile.headline ?? "",
              links: parseStoredLinks(profile.links),
            }}
          />
        </div>
      </main>
    </>
  );
}
