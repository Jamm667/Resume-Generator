import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  buildLetterDocument,
  buildResumeDocument,
  exportFilename,
  resumeBullets,
  slugify,
  type ExportExperience,
  type ExportProfile,
} from "@/lib/export/document-model";
import {
  renderLetterPdf,
  renderResumePdf,
  sanitize,
  UnsupportedCharacterError,
  wrapText,
} from "@/lib/export/pdf";

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
    organization: "Acme",
    headerTailorStatus: "NONE",
    sourceExperience: { kind: "JOB" },
    children,
    ...overrides,
  } as unknown as ExportExperience;
}

// ---------------------------------------------------------------------------
// The shared document model — every content rule lives here
// ---------------------------------------------------------------------------

describe("buildResumeDocument", () => {
  it("puts the contact block together, skipping what is missing", () => {
    const full = buildResumeDocument(profile, []);
    expect(full.name).toBe("Dana Whitfield");
    expect(full.contact).toBe(
      "dana@example.com · +1 555 0142 · Toronto, ON · LinkedIn: https://linkedin.com/in/dana",
    );

    const sparse = buildResumeDocument(
      { ...profile, phone: null, location: null, links: [] },
      [],
    );
    // No stray separator where the phone would have been.
    expect(sparse.contact).toBe("dana@example.com");
  });

  it("has no name when the profile has none", () => {
    expect(buildResumeDocument({ ...profile, fullName: "  " }, []).name).toBeNull();
  });

  it("orders sections Experience, Projects, Education and omits empty ones", () => {
    const document = buildResumeDocument(profile, [
      experience({
        id: "school",
        sortOrder: 2,
        originalTitle: "BSc",
        sourceExperience: { kind: "EDUCATION" },
      }),
      experience({
        id: "job",
        sortOrder: 0,
        originalTitle: "Engineer",
        sourceExperience: { kind: "JOB" },
      }),
    ]);

    expect(document.sections.map((section) => section.heading)).toEqual([
      "Experience",
      "Education",
    ]);
  });

  it("keeps an item whose bank entry was deleted, under Experience", () => {
    const document = buildResumeDocument(profile, [
      experience({ sourceExperience: null }),
    ]);
    expect(document.sections[0].heading).toBe("Experience");
  });

  it("joins the title and organization, and drops the dash without one", () => {
    expect(
      buildResumeDocument(profile, [experience()]).sections[0].experiences[0]
        .heading,
    ).toBe("Engineer — Acme");

    expect(
      buildResumeDocument(profile, [experience({ organization: null })])
        .sections[0].experiences[0].heading,
    ).toBe("Engineer");
  });

  it("uses an accepted tailored title and date, but never a tailored organization", () => {
    const document = buildResumeDocument(profile, [
      experience({
        tailoredTitle: "Project Coordinator",
        tailoredDateText: "2019 – 2021",
        headerTailorStatus: "ACCEPTED",
      }),
    ]);

    const first = document.sections[0].experiences[0];
    expect(first.heading).toBe("Project Coordinator — Acme");
    expect(first.dateText).toBe("2019 – 2021");
  });

  it("ignores a proposed header rewrite that was not accepted", () => {
    const document = buildResumeDocument(profile, [
      experience({
        tailoredTitle: "Never Accepted",
        headerTailorStatus: "PROPOSED",
      }),
    ]);
    expect(document.sections[0].experiences[0].heading).toBe("Engineer — Acme");
  });

  it("exports an accepted bullet rewrite", () => {
    const document = buildResumeDocument(profile, [
      experience({}, [
        bullet({ tailoredText: "Tailored wording", tailorStatus: "ACCEPTED" }),
      ]),
    ]);
    expect(resumeBullets(document)).toEqual(["Tailored wording"]);
  });

  it("exports the source text for a rejected or blocked rewrite", () => {
    for (const status of ["REJECTED", "BLOCKED"]) {
      const document = buildResumeDocument(profile, [
        experience({}, [
          bullet({
            tailoredText: "MUST NOT APPEAR",
            tailorStatus: status,
            userText: "What the user wrote",
          }),
        ]),
      ]);
      expect(resumeBullets(document)).toEqual(["What the user wrote"]);
    }
  });

  it("prefers the user's edit over the original when nothing is accepted", () => {
    const document = buildResumeDocument(profile, [
      experience({}, [bullet({ userText: "Hand edited" })]),
    ]);
    expect(resumeBullets(document)).toEqual(["Hand edited"]);
  });

  it("keeps bullets in sortOrder", () => {
    const document = buildResumeDocument(profile, [
      experience({}, [
        bullet({ id: "b2", sortOrder: 1, originalText: "Second" }),
        bullet({ id: "b1", sortOrder: 0, originalText: "First" }),
      ]),
    ]);
    expect(resumeBullets(document)).toEqual(["First", "Second"]);
  });
});

describe("buildLetterDocument", () => {
  it("splits the body into paragraphs and names the addressee", () => {
    const document = buildLetterDocument({
      profile,
      companyName: "Northwind",
      roleTitle: "Coordinator",
      date: "August 2, 2026",
      body: "First para.\n\nSecond para.\n\n\nThird para.",
    });

    expect(document.addressee).toBe("Northwind — Coordinator");
    expect(document.paragraphs).toEqual([
      "First para.",
      "Second para.",
      "Third para.",
    ]);
  });

  it("leaves the addressee empty when the posting named nobody", () => {
    const document = buildLetterDocument({
      profile,
      companyName: null,
      roleTitle: null,
      date: "August 2, 2026",
      body: "A letter.",
    });
    expect(document.addressee).toBe("");
  });
});

describe("slugify and exportFilename", () => {
  it("handles spaces, punctuation, and accents", () => {
    expect(slugify("Dana Whitfield")).toBe("dana-whitfield");
    expect(slugify("Northwind Logistics — Project Coordinator!")).toBe(
      "northwind-logistics-project-coordinator",
    );
    expect(slugify("Zoë Ångström")).toBe("zoe-angstrom");
  });

  it("falls back rather than producing an empty name", () => {
    expect(slugify("！！！")).toBe("application");
  });

  it("names the files predictably", () => {
    expect(exportFilename("Acme — Engineer", "resume")).toBe(
      "acme-engineer-resume.pdf",
    );
    expect(exportFilename("Acme — Engineer", "cover-letter")).toBe(
      "acme-engineer-cover-letter.pdf",
    );
  });
});

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

describe("sanitize", () => {
  it("maps typography the standard fonts cannot encode", () => {
    expect(sanitize("“quoted” and ‘single’")).toBe('"quoted" and \'single\'');
    expect(sanitize("wait…")).toBe("wait...");
    expect(sanitize("2020 – 2022")).toBe("2020 - 2022");
  });

  it("keeps the characters the fonts do have", () => {
    expect(sanitize("Engineer — Acme")).toContain("—");
    expect(sanitize("café · naïve")).toBe("café · naïve");
  });

  it("refuses a character it cannot render rather than dropping it", () => {
    expect(() => sanitize("周雨辰")).toThrow(UnsupportedCharacterError);
  });
});

describe("wrapText", () => {
  it("wraps at the column and never exceeds it", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont("Helvetica");
    const lines = wrapText(
      "the quick brown fox jumps over the lazy dog ".repeat(6),
      font,
      10,
      200,
    );

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(200);
    }
  });

  it("breaks a single token too wide to fit", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont("Helvetica");
    const lines = wrapText(`https://example.com/${"x".repeat(200)}`, font, 10, 150);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(150);
    }
  });
});

describe("renderResumePdf", () => {
  const bank = (count: number) =>
    experience(
      {},
      Array.from({ length: count }, (_, index) =>
        bullet({
          id: `b${index}`,
          sortOrder: index,
          originalText: `Bullet number ${index} describing a piece of work.`,
        }),
      ),
    );

  it("produces a valid single-page PDF for a small draft", async () => {
    const bytes = await renderResumePdf(
      buildResumeDocument(profile, [bank(3)]),
    );

    expect(bytes.byteLength).toBeGreaterThan(0);
    // Every PDF starts with this signature; a truncated file would not.
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  });

  it("flows a 40-bullet draft onto more than one page", async () => {
    const bytes = await renderResumePdf(
      buildResumeDocument(profile, [bank(40)]),
    );
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });

  it("renders an empty draft without crashing", async () => {
    const bytes = await renderResumePdf(buildResumeDocument(profile, []));
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  });

  it("fails loudly on a character it cannot render", async () => {
    await expect(
      renderResumePdf(
        buildResumeDocument({ ...profile, fullName: "周雨辰" }, [bank(1)]),
      ),
    ).rejects.toThrow(UnsupportedCharacterError);
  });
});

describe("renderLetterPdf", () => {
  it("produces a valid PDF", async () => {
    const bytes = await renderLetterPdf(
      buildLetterDocument({
        profile,
        companyName: "Northwind",
        roleTitle: "Coordinator",
        date: "August 2, 2026",
        body: "Dear Hiring Team,\n\nA letter body.\n\nSincerely,\nDana",
      }),
    );

    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  });
});
