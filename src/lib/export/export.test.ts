import { describe, expect, it } from "vitest";

import {
  buildCoverLetterMarkdown,
  buildResumeMarkdown,
  exportFilename,
  slugify,
  type ExportExperience,
  type ExportProfile,
} from "@/lib/export/markdown";

const profile: ExportProfile = {
  fullName: "Dana Whitfield",
  email: "dana@example.com",
  phone: "+1 555 0142",
  location: "Toronto, ON",
  links: [{ label: "LinkedIn", url: "https://linkedin.com/in/dana" }],
};

/** A bullet shaped like Prisma's row, with only the fields the export reads. */
function bullet(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    kind: "BULLET",
    parentDraftItemId: "e1",
    sortOrder: 0,
    originalText: "Original bullet",
    tailoredText: null,
    userText: null,
    tailorStatus: "NONE",
    originalTitle: null,
    tailoredTitle: null,
    userTitle: null,
    originalDateText: null,
    tailoredDateText: null,
    userDateText: null,
    organization: null,
    headerTailorStatus: "NONE",
    ...overrides,
  } as unknown as ExportExperience["children"][number];
}

function experience(
  overrides: Record<string, unknown> = {},
  children: ExportExperience["children"] = [],
): ExportExperience {
  return {
    id: "e1",
    kind: "EXPERIENCE",
    parentDraftItemId: null,
    sortOrder: 0,
    originalText: "Engineer",
    tailoredText: null,
    userText: null,
    tailorStatus: "NONE",
    originalTitle: "Engineer",
    tailoredTitle: null,
    userTitle: null,
    originalDateText: "2020 – 2022",
    tailoredDateText: null,
    userDateText: null,
    organization: "Acme Payments",
    headerTailorStatus: "NONE",
    sourceExperience: { kind: "JOB" },
    children,
    ...overrides,
  } as unknown as ExportExperience;
}

// ---------------------------------------------------------------------------
// Which text ends up in the file — the part that matters most
// ---------------------------------------------------------------------------

describe("buildResumeMarkdown — effective text", () => {
  it("exports an accepted rewrite", () => {
    const md = buildResumeMarkdown(profile, [
      experience({}, [
        bullet({
          originalText: "Ran the pipeline",
          tailoredText: "Owned payments reconciliation",
          tailorStatus: "ACCEPTED",
        }),
      ]),
    ]);

    expect(md).toContain("- Owned payments reconciliation");
    expect(md).not.toContain("Ran the pipeline");
  });

  it("exports the source text for a rejected rewrite", () => {
    const md = buildResumeMarkdown(profile, [
      experience({}, [
        bullet({
          originalText: "Ran the pipeline",
          tailoredText: "A rewrite the user said no to",
          tailorStatus: "REJECTED",
        }),
      ]),
    ]);

    expect(md).toContain("- Ran the pipeline");
    expect(md).not.toContain("said no to");
  });

  it("never exports a blocked rewrite", () => {
    const md = buildResumeMarkdown(profile, [
      experience({}, [
        bullet({
          originalText: "Led a team",
          tailoredText: "Led a team of 12",
          tailorStatus: "BLOCKED",
        }),
      ]),
    ]);

    expect(md).toContain("- Led a team\n");
    expect(md).not.toContain("of 12");
  });

  it("prefers the user's own edit over the original when nothing is accepted", () => {
    const md = buildResumeMarkdown(profile, [
      experience({}, [
        bullet({ originalText: "Original", userText: "My own wording" }),
      ]),
    ]);

    expect(md).toContain("- My own wording");
    expect(md).not.toContain("- Original");
  });

  it("exports an accepted title and date but never rewrites the company", () => {
    const md = buildResumeMarkdown(profile, [
      experience(
        {
          originalTitle: "UX Designer",
          tailoredTitle: "Project Coordinator",
          originalDateText: "Jan 2019 – Mar 2021",
          tailoredDateText: "2019 – 2021",
          headerTailorStatus: "ACCEPTED",
        },
        [bullet()],
      ),
    ]);

    expect(md).toContain("### Project Coordinator — Acme Payments");
    expect(md).toContain("2019 – 2021");
    expect(md).not.toContain("UX Designer");
  });

  it("keeps the original header when the rewrite was rejected", () => {
    const md = buildResumeMarkdown(profile, [
      experience(
        {
          originalTitle: "UX Designer",
          tailoredTitle: "Project Coordinator",
          headerTailorStatus: "REJECTED",
        },
        [bullet()],
      ),
    ]);

    expect(md).toContain("### UX Designer — Acme Payments");
    expect(md).not.toContain("Project Coordinator");
  });
});

// ---------------------------------------------------------------------------
// Document shape
// ---------------------------------------------------------------------------

describe("buildResumeMarkdown — structure", () => {
  it("orders sections Experience, Projects, Education", () => {
    const md = buildResumeMarkdown(profile, [
      experience(
        { id: "e3", sortOrder: 2, sourceExperience: { kind: "EDUCATION" } },
        [bullet({ id: "b3", parentDraftItemId: "e3" })],
      ),
      experience(
        { id: "e2", sortOrder: 1, sourceExperience: { kind: "PROJECT" } },
        [bullet({ id: "b2", parentDraftItemId: "e2" })],
      ),
      experience({ id: "e1", sortOrder: 0 }, [bullet()]),
    ]);

    expect(md.indexOf("## Experience")).toBeLessThan(md.indexOf("## Projects"));
    expect(md.indexOf("## Projects")).toBeLessThan(md.indexOf("## Education"));
  });

  it("omits a section with no items rather than leaving a bare heading", () => {
    const md = buildResumeMarkdown(profile, [experience({}, [bullet()])]);

    expect(md).toContain("## Experience");
    expect(md).not.toContain("## Projects");
    expect(md).not.toContain("## Education");
  });

  it("keeps experiences and bullets in draft order", () => {
    const md = buildResumeMarkdown(profile, [
      experience({ id: "second", sortOrder: 1, originalTitle: "Second Job" }, [
        bullet({ id: "s1", parentDraftItemId: "second", originalText: "S1" }),
      ]),
      experience({ id: "first", sortOrder: 0, originalTitle: "First Job" }, [
        bullet({ id: "f2", parentDraftItemId: "first", sortOrder: 1, originalText: "F2" }),
        bullet({ id: "f1", parentDraftItemId: "first", sortOrder: 0, originalText: "F1" }),
      ]),
    ]);

    expect(md.indexOf("First Job")).toBeLessThan(md.indexOf("Second Job"));
    expect(md.indexOf("- F1")).toBeLessThan(md.indexOf("- F2"));
  });

  it("puts an item whose bank entry was deleted into Experience", () => {
    const md = buildResumeMarkdown(profile, [
      experience({ sourceExperience: null }, [bullet()]),
    ]);

    expect(md).toContain("## Experience");
  });

  it("renders a contact line with no stray separators when fields are missing", () => {
    const md = buildResumeMarkdown(
      { ...profile, phone: null, location: null, links: [] },
      [experience({}, [bullet()])],
    );

    expect(md).toContain("# Dana Whitfield");
    expect(md).toContain("dana@example.com");
    expect(md).not.toMatch(/·\s*·/);
    expect(md).not.toMatch(/·\s*$/m);
  });

  it("omits the name heading entirely when there is no name", () => {
    const md = buildResumeMarkdown({ ...profile, fullName: null }, [
      experience({}, [bullet()]),
    ]);

    expect(md).not.toMatch(/^#\s*$/m);
    expect(md.startsWith("dana@example.com")).toBe(true);
  });

  it("drops the date line when there is no date", () => {
    const md = buildResumeMarkdown(profile, [
      experience({ originalDateText: null }, [bullet()]),
    ]);

    expect(md).toContain("### Engineer — Acme Payments");
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("never emits a run of more than one blank line", () => {
    const md = buildResumeMarkdown(profile, [
      experience({ originalDateText: null }, []),
      experience({ id: "e2", sortOrder: 1 }, [bullet({ id: "b2", parentDraftItemId: "e2" })]),
    ]);

    expect(md).not.toMatch(/\n{3,}/);
  });

  it("matches a full document", () => {
    const md = buildResumeMarkdown(profile, [
      experience({}, [
        bullet({ id: "b1", originalText: "Ran Postgres at scale" }),
        bullet({ id: "b2", sortOrder: 1, originalText: "Mentored four engineers" }),
      ]),
    ]);

    expect(md).toBe(
      [
        "# Dana Whitfield",
        "",
        "dana@example.com · +1 555 0142 · Toronto, ON · LinkedIn: https://linkedin.com/in/dana",
        "",
        "## Experience",
        "",
        "### Engineer — Acme Payments",
        "",
        "2020 – 2022",
        "",
        "- Ran Postgres at scale",
        "- Mentored four engineers",
        "",
      ].join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// Cover letter
// ---------------------------------------------------------------------------

describe("buildCoverLetterMarkdown", () => {
  it("carries the header, date, addressee, and body", () => {
    const md = buildCoverLetterMarkdown({
      profile,
      companyName: "Northwind Logistics",
      roleTitle: "Project Coordinator",
      date: "August 2, 2026",
      body: "Dear Hiring Team,\n\nA letter.",
    });

    expect(md).toContain("# Dana Whitfield");
    expect(md).toContain("August 2, 2026");
    expect(md).toContain("Northwind Logistics — Project Coordinator");
    expect(md).toContain("Dear Hiring Team,");
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("leaves out an addressee it does not have", () => {
    const md = buildCoverLetterMarkdown({
      profile,
      companyName: null,
      roleTitle: null,
      date: "August 2, 2026",
      body: "A letter.",
    });

    expect(md).not.toContain("—");
    expect(md).not.toMatch(/\n{3,}/);
  });
});

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Dana Whitfield")).toBe("dana-whitfield");
  });

  it("collapses punctuation rather than leaving it in a filename", () => {
    expect(slugify("Northwind Logistics — Project Coordinator")).toBe(
      "northwind-logistics-project-coordinator",
    );
    expect(slugify("O'Brien & Sons, Inc.")).toBe("o-brien-sons-inc");
  });

  it("folds accents to their base letters", () => {
    expect(slugify("Zoë Ångström")).toBe("zoe-angstrom");
    expect(slugify("José García")).toBe("jose-garcia");
  });

  it("falls back rather than producing an empty name", () => {
    expect(slugify("!!!")).toBe("application");
    expect(slugify("")).toBe("application");
  });

  it("builds both filenames", () => {
    expect(exportFilename("Northwind — Coordinator", "resume")).toBe(
      "northwind-coordinator-resume.md",
    );
    expect(exportFilename("Northwind — Coordinator", "cover-letter")).toBe(
      "northwind-coordinator-cover-letter.md",
    );
  });
});
