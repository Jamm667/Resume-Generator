import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@resume-engine.local";

async function main() {
  // Re-runnable: the cascade from User clears every row the last run made.
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Demo User",
      profile: {
        create: {
          fullName: "Demo User",
          email: DEMO_EMAIL,
          phone: "+1 555 0100",
          location: "Toronto, ON",
          headline: "Full-stack engineer",
          links: [
            { label: "GitHub", url: "https://github.com/demo" },
            { label: "LinkedIn", url: "https://linkedin.com/in/demo" },
          ],
        },
      },
    },
  });

  const sourceDocument = await prisma.sourceDocument.create({
    data: {
      userId: user.id,
      filename: "demo-resume.pdf",
      mimeType: "application/pdf",
      rawText: "Demo User — Full-stack engineer\nAcme Corp, Senior Engineer\n",
      extractionMethod: "TEXT_LAYER",
      parseStatus: "STRUCTURED",
    },
  });

  await prisma.experience.create({
    data: {
      userId: user.id,
      sourceDocumentId: sourceDocument.id,
      kind: "JOB",
      title: "Senior Engineer",
      organization: "Acme Corp",
      location: "Toronto, ON",
      startDate: "Jan 2022",
      isCurrent: true,
      summary: "Payments platform.",
      needsReview: false,
      sortOrder: 0,
      bullets: {
        create: [
          {
            userId: user.id,
            text: "Cut checkout latency by 40% by batching settlement calls.",
            needsReview: false,
            sortOrder: 0,
          },
          {
            userId: user.id,
            text: "Led the migration of 12 services to a shared auth layer.",
            needsReview: false,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  await prisma.experience.create({
    data: {
      userId: user.id,
      sourceDocumentId: sourceDocument.id,
      kind: "PROJECT",
      title: "Resume Engine",
      organization: "Personal",
      startDate: "2025",
      endDate: "2026",
      sortOrder: 1,
      bullets: {
        create: [
          {
            userId: user.id,
            text: "Built an LLM pipeline that structures resumes into a reusable data bank.",
            sortOrder: 0,
          },
        ],
      },
    },
  });

  await prisma.experience.create({
    data: {
      userId: user.id,
      sourceDocumentId: sourceDocument.id,
      kind: "EDUCATION",
      title: "BSc Computer Science",
      organization: "University of Toronto",
      startDate: "2016",
      endDate: "2020",
      needsReview: false,
      sortOrder: 2,
      bullets: {
        create: [
          {
            userId: user.id,
            text: "Graduated with high distinction.",
            needsReview: false,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  await prisma.application.create({
    data: {
      userId: user.id,
      name: "Staff Engineer at Globex",
      companyName: "Globex",
      roleTitle: "Staff Engineer",
      jdText:
        "We are looking for a staff engineer to own our payments platform end to end.",
    },
  });

  const counts = {
    profiles: await prisma.profile.count({ where: { userId: user.id } }),
    sourceDocuments: await prisma.sourceDocument.count({
      where: { userId: user.id },
    }),
    experiences: await prisma.experience.count({ where: { userId: user.id } }),
    bullets: await prisma.bullet.count({ where: { userId: user.id } }),
    applications: await prisma.application.count({ where: { userId: user.id } }),
  };

  console.log(`Seeded ${DEMO_EMAIL}`, counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
