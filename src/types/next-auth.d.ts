import type { DefaultSession } from "next-auth";

// The session callback in `src/lib/auth.ts` copies the database user's id onto
// every session, so `id` is always present — the default typing has it optional.
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export {};
