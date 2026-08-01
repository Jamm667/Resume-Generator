import { NextResponse } from "next/server";
import { z } from "zod";

import {
  defaultApplicationName,
  MIN_JD_CHARS,
} from "@/lib/applications/naming";
import { prisma } from "@/lib/db";
import { inferCompanyAndRole } from "@/lib/jd/infer-company-role";
import { requireUser } from "@/lib/require-user";

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
