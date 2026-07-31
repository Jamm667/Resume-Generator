import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

/**
 * The single session guard for authenticated routes. Every protected page and
 * route handler should call this rather than reading the session directly, so
 * the signed-out redirect stays defined in one place.
 */
export async function requireUser() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  return session.user;
}
