import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import {
  fieldErrors,
  normalizeText,
  parseStoredLinks,
  profileUpdateSchema,
  type ProfileLink,
} from "@/lib/validation/profile";

/**
 * The user's profile, created empty if they do not have one yet. A first visit
 * should show an empty form, not an error.
 */
export async function GET(): Promise<NextResponse> {
  const user = await requireUser();

  const profile = await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  return NextResponse.json({
    ...profile,
    links: parseStoredLinks(profile.links),
  });
}

/** Only the fields this request actually asked to change. */
type ProfileChanges = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  headline?: string | null;
  links?: ProfileLink[];
};

/**
 * Save the contact block, following the write convention in CLAUDE.md: a field
 * absent from the body is left alone, and one sent as `null` or `""` is
 * cleared. `links` present replaces the whole array — which is how add, edit,
 * remove, and reorder all persist in one write — and `[]` clears it.
 *
 * The profile form sends every field on every save, so its behavior is
 * unchanged by the merge; what this buys is that a partial body from anywhere
 * else no longer wipes the fields it did not mention.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const user = await requireUser();

  const body = await request.json().catch(() => null);
  const parsed = profileUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { errors: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const changes: ProfileChanges = {};

  // `undefined` is the only value that means "absent"; null and "" both reach
  // normalizeText and clear the column.
  if (input.fullName !== undefined) changes.fullName = normalizeText(input.fullName);
  if (input.email !== undefined) changes.email = normalizeText(input.email);
  if (input.phone !== undefined) changes.phone = normalizeText(input.phone);
  if (input.location !== undefined) changes.location = normalizeText(input.location);
  if (input.headline !== undefined) changes.headline = normalizeText(input.headline);
  if (input.links !== undefined) changes.links = input.links;

  const saved = await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...changes },
    update: changes,
  });

  return NextResponse.json({
    ...saved,
    links: parseStoredLinks(saved.links),
  });
}
