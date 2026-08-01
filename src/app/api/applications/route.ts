import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { inferCompanyAndRole } from "@/lib/jd/infer-company-role";
import { requireUser } from "@/lib/require-user";

/** Short enough to be a paste accident rather than a posting. */
export const MIN_JD_CHARS = 100;

/** Fallback name length when there is no company or role to build one from. */
const NAME_FALLBACK_CHARS = 60;

const createSchema = z.object({
  jdText: z
    .string()
    .trim()
    .min(
      MIN_JD_CHARS,
      `Paste the full job description — at least ${MIN_JD_CHARS} characters.`,
    ),
  companyName: z.string().trim().nullish(),
  roleTitle: z.string().trim().nullish(),
  name: z.string().trim().nullish(),
});

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A readable default the user can change. "{company} — {role}" when we have
 * them, otherwise the opening of the JD, which at least says which posting it
 * is.
 */
export function defaultApplicationName(
  companyName: string | null,
  roleTitle: string | null,
  jdText: string,
): string {
  if (companyName && roleTitle) return `${companyName} — ${roleTitle}`;
  if (companyName) return companyName;
  if (roleTitle) return roleTitle;

  const opening = jdText.trim().replace(/\s+/g, " ");
  return opening.length <= NAME_FALLBACK_CHARS
    ? opening
    : `${opening.slice(0, NAME_FALLBACK_CHARS).trimEnd()}…`;
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await requireUser();

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { errors: { [issue?.path.join(".") || "form"]: issue?.message } },
      { status: 400 },
    );
  }

  const input = parsed.data;
  let companyName = blankToNull(input.companyName);
  let roleTitle = blankToNull(input.roleTitle);

  // Only ask the model about what the user left blank, and never let it
  // overwrite something they typed.
  if (companyName === null || roleTitle === null) {
    const inferred = await inferCompanyAndRole(input.jdText);
    companyName = companyName ?? inferred.companyName;
    roleTitle = roleTitle ?? inferred.roleTitle;
  }

  const created = await prisma.application.create({
    data: {
      userId: user.id,
      name:
        blankToNull(input.name) ??
        defaultApplicationName(companyName, roleTitle, input.jdText),
      companyName,
      roleTitle,
      jdText: input.jdText,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
