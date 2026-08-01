import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import {
  fieldErrors,
  normalizeText,
  parseStoredLinks,
  profileUpdateSchema,
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

/**
 * Save the contact block. Everything is replaced wholesale — including the
 * links array, which is how add, edit, remove, and reorder all persist in one
 * write.
 */
export async function PUT(request: Request): Promise<NextResponse> {
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

  const saved = await prisma.profile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: normalizeText(input.fullName),
      email: normalizeText(input.email),
      phone: normalizeText(input.phone),
      location: normalizeText(input.location),
      headline: normalizeText(input.headline),
      links: input.links,
    },
    update: {
      fullName: normalizeText(input.fullName),
      email: normalizeText(input.email),
      phone: normalizeText(input.phone),
      location: normalizeText(input.location),
      headline: normalizeText(input.headline),
      links: input.links,
    },
  });

  return NextResponse.json({
    ...saved,
    links: parseStoredLinks(saved.links),
  });
}
