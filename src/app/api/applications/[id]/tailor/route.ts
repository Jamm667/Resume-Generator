import { NextResponse } from "next/server";

import { runTailorPass } from "@/lib/tailor";
import { requireUser } from "@/lib/require-user";

type Context = { params: Promise<{ id: string }> };

/**
 * Propose a rewrite of this application's draft against its job description.
 *
 * Triggered explicitly by the user. Nothing here accepts anything — every
 * rewrite lands as PROPOSED or BLOCKED for the user to rule on.
 */
export async function POST(
  _request: Request,
  { params }: Context,
): Promise<NextResponse> {
  const user = await requireUser();
  const { id } = await params;

  const outcome = await runTailorPass(id, user.id);

  if (outcome.status === "FAILED") {
    // 502 only when the model or the database let us down; a missing
    // application or an empty draft is the caller's answer, not Anthropic's.
    const status =
      outcome.reason === "NOT_FOUND"
        ? 404
        : outcome.reason === "EMPTY_DRAFT"
          ? 400
          : 502;
    return NextResponse.json({ error: outcome.error }, { status });
  }

  return NextResponse.json(outcome);
}
