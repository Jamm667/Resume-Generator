import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type {
  LetterDocument,
  ResumeDocument,
} from "@/lib/export/document-model";

/**
 * PDF rendering, laid out by hand rather than by a browser.
 *
 * Everything here is deliberately plain: one column, one standard font, no
 * tables, no images, no absolute-positioned boxes. Resumes are read by
 * applicant tracking systems before they are read by people, and those parse a
 * simple text flow reliably and anything clever unreliably.
 *
 * Laying it out by hand is also what makes the page rules enforceable — a
 * heading is never left stranded at the foot of a page because we check for
 * room before committing to one.
 */

/** US Letter, in points. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const BULLET = "•";
const BULLET_INDENT = 12;

const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.8, 0.83, 0.86);

/**
 * Characters the standard fonts cannot encode, mapped to ones they can.
 *
 * The model produces real typography — em dashes, middle dots, curly quotes —
 * and WinAnsi covers most of it, but not all. Mapping is better than letting
 * the encoder throw over a quotation mark.
 */
const SUBSTITUTIONS: [RegExp, string][] = [
  [/[‘’‚‛]/g, "'"], // curly single quotes
  [/[“”„‟]/g, '"'], // curly double quotes
  [/…/g, "..."], // ellipsis
  [/[‒–]/g, "-"], // figure and en dash
  [/―/g, "—"], // horizontal bar to em dash
  [/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " "], // exotic spaces
  [/[\u200b-\u200d\ufeff]/g, ""], // zero-width joiners and marks
];

export class UnsupportedCharacterError extends Error {
  constructor(character: string) {
    super(
      `This document contains a character the PDF fonts cannot render (${JSON.stringify(character)}). ` +
        "The export currently supports Latin scripts only.",
    );
    this.name = "UnsupportedCharacterError";
  }
}

/**
 * Make text safe for the standard fonts, or say why it is not.
 *
 * Silently dropping an unrenderable character would corrupt somebody's name
 * without telling them, which is worse than refusing the export (AC-8).
 */
export function sanitize(text: string): string {
  let output = text;
  for (const [pattern, replacement] of SUBSTITUTIONS) {
    output = output.replace(pattern, replacement);
  }

  for (const character of output) {
    const code = character.codePointAt(0) ?? 0;
    // WinAnsi is Latin-1 plus a handful of typographic slots; everything we
    // deliberately keep above 0xFF is mapped above, so anything left is out.
    if (code > 0xff && character !== "—" && character !== BULLET) {
      throw new UnsupportedCharacterError(character);
    }
  }

  return output;
}

/** Greedy word wrap, breaking inside a word only when it cannot fit alone. */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = "";

  const fits = (candidate: string) =>
    font.widthOfTextAtSize(candidate, size) <= maxWidth;

  for (const word of words) {
    const candidate = line.length > 0 ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }

    if (line.length > 0) lines.push(line);

    if (fits(word)) {
      line = word;
      continue;
    }

    // A single token wider than the column — a URL, usually. Break it.
    let chunk = "";
    for (const character of word) {
      if (chunk.length > 0 && !fits(chunk + character)) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    line = chunk;
  }

  if (line.length > 0) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

type Fonts = { body: PDFFont; bold: PDFFont };

/** A cursor down the page that starts a new one when it runs out of room. */
class Layout {
  private page: PDFPage;
  private y: number;
  readonly pages: PDFPage[] = [];

  constructor(private readonly document: PDFDocument) {
    this.page = this.startPage();
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private startPage(): PDFPage {
    const page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(page);
    return page;
  }

  /** Space left above the bottom margin. */
  get remaining(): number {
    return this.y - MARGIN;
  }

  break(): void {
    this.page = this.startPage();
    this.y = PAGE_HEIGHT - MARGIN;
  }

  /** Start a new page unless `height` fits — how orphans are prevented. */
  reserve(height: number): void {
    if (this.remaining < height) this.break();
  }

  space(height: number): void {
    // Never carry blank space onto the top of a fresh page.
    if (this.remaining >= height) this.y -= height;
  }

  line(
    text: string,
    font: PDFFont,
    size: number,
    lineHeight: number,
    { indent = 0, color = INK }: { indent?: number; color?: typeof INK } = {},
  ): void {
    this.reserve(lineHeight);
    this.y -= lineHeight;
    this.page.drawText(text, {
      x: MARGIN + indent,
      y: this.y,
      size,
      font,
      color,
    });
  }

  rule(): void {
    this.reserve(6);
    this.y -= 4;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE,
    });
  }
}

function header(
  layout: Layout,
  fonts: Fonts,
  name: string | null,
  contact: string,
): void {
  if (name) layout.line(sanitize(name), fonts.bold, 19, 22);

  if (contact.length > 0) {
    layout.space(4);
    for (const line of wrapText(sanitize(contact), fonts.body, 9.5, CONTENT_WIDTH)) {
      layout.line(line, fonts.body, 9.5, 12, { color: MUTED });
    }
  }
}

/** The tailored resume, as a single-column PDF. */
export async function renderResumePdf(
  document: ResumeDocument,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    body: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const layout = new Layout(pdf);
  header(layout, fonts, document.name, document.contact);

  for (const section of document.sections) {
    const first = section.experiences[0];
    // A section heading needs its first entry's heading with it, or it reads
    // as a dangling label at the foot of the page (AC-4).
    layout.reserve(20 + 16 + 14 + (first ? 14 : 0));
    layout.space(14);
    layout.line(sanitize(section.heading), fonts.bold, 11.5, 14);
    layout.rule();
    layout.space(6);

    for (const experience of section.experiences) {
      // Keep the heading, its dates, and one bullet line together.
      layout.reserve(14 + (experience.dateText ? 12 : 0) + 13);
      layout.space(6);

      for (const line of wrapText(
        sanitize(experience.heading),
        fonts.bold,
        10.5,
        CONTENT_WIDTH,
      )) {
        layout.line(line, fonts.bold, 10.5, 13);
      }

      if (experience.dateText.length > 0) {
        layout.line(sanitize(experience.dateText), fonts.body, 9.5, 12, {
          color: MUTED,
        });
      }

      for (const bullet of experience.bullets) {
        layout.space(2);
        const lines = wrapText(
          sanitize(bullet),
          fonts.body,
          10,
          CONTENT_WIDTH - BULLET_INDENT,
        );

        lines.forEach((line, index) => {
          if (index === 0) {
            layout.line(`${BULLET}  ${line}`, fonts.body, 10, 13);
          } else {
            // Hanging indent so wrapped lines sit under the text, not the dot.
            layout.line(line, fonts.body, 10, 13, { indent: BULLET_INDENT });
          }
        });
      }
    }
  }

  return pdf.save();
}

/** The cover letter, with the same header treatment as the resume. */
export async function renderLetterPdf(
  document: LetterDocument,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    body: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const layout = new Layout(pdf);
  header(layout, fonts, document.name, document.contact);

  layout.space(18);
  layout.line(sanitize(document.date), fonts.body, 10, 13, { color: MUTED });

  if (document.addressee.length > 0) {
    layout.space(4);
    for (const line of wrapText(
      sanitize(document.addressee),
      fonts.bold,
      10.5,
      CONTENT_WIDTH,
    )) {
      layout.line(line, fonts.bold, 10.5, 13);
    }
  }

  for (const paragraph of document.paragraphs) {
    layout.space(10);
    for (const line of wrapText(
      sanitize(paragraph),
      fonts.body,
      10.5,
      CONTENT_WIDTH,
    )) {
      layout.line(line, fonts.body, 10.5, 14.5);
    }
  }

  return pdf.save();
}
