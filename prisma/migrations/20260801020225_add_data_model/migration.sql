-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('TEXT_LAYER', 'VISION_OCR', 'PASTED');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('PENDING', 'EXTRACTED', 'STRUCTURED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExperienceKind" AS ENUM ('JOB', 'PROJECT', 'EDUCATION');

-- CreateEnum
CREATE TYPE "DraftItemKind" AS ENUM ('EXPERIENCE', 'BULLET');

-- CreateEnum
CREATE TYPE "TailorStatus" AS ENUM ('NONE', 'PROPOSED', 'ACCEPTED', 'REJECTED', 'BLOCKED');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "headline" TEXT,
    "links" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "rawText" TEXT,
    "extractionMethod" "ExtractionMethod" NOT NULL,
    "parseStatus" "ParseStatus" NOT NULL DEFAULT 'PENDING',
    "parseError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "kind" "ExperienceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "location" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bullet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "duplicateOfBulletId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bullet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "roleTitle" TEXT,
    "jdText" TEXT NOT NULL,
    "coverLetterText" TEXT,
    "coverLetterTone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftItem" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "DraftItemKind" NOT NULL,
    "sourceExperienceId" TEXT,
    "sourceBulletId" TEXT,
    "parentDraftItemId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "originalText" TEXT NOT NULL,
    "tailoredText" TEXT,
    "userText" TEXT,
    "tailorStatus" "TailorStatus" NOT NULL DEFAULT 'NONE',
    "originalTitle" TEXT,
    "tailoredTitle" TEXT,
    "userTitle" TEXT,
    "originalDateText" TEXT,
    "tailoredDateText" TEXT,
    "userDateText" TEXT,
    "organization" TEXT,
    "headerTailorStatus" "TailorStatus" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelevanceScore" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "bulletId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "matchedKeywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelevanceScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "SourceDocument_userId_idx" ON "SourceDocument"("userId");

-- CreateIndex
CREATE INDEX "Experience_userId_idx" ON "Experience"("userId");

-- CreateIndex
CREATE INDEX "Experience_sourceDocumentId_idx" ON "Experience"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "Bullet_userId_idx" ON "Bullet"("userId");

-- CreateIndex
CREATE INDEX "Bullet_experienceId_idx" ON "Bullet"("experienceId");

-- CreateIndex
CREATE INDEX "Bullet_duplicateOfBulletId_idx" ON "Bullet"("duplicateOfBulletId");

-- CreateIndex
CREATE INDEX "Application_userId_idx" ON "Application"("userId");

-- CreateIndex
CREATE INDEX "DraftItem_applicationId_idx" ON "DraftItem"("applicationId");

-- CreateIndex
CREATE INDEX "DraftItem_parentDraftItemId_idx" ON "DraftItem"("parentDraftItemId");

-- CreateIndex
CREATE INDEX "DraftItem_sourceExperienceId_idx" ON "DraftItem"("sourceExperienceId");

-- CreateIndex
CREATE INDEX "DraftItem_sourceBulletId_idx" ON "DraftItem"("sourceBulletId");

-- CreateIndex
CREATE INDEX "RelevanceScore_bulletId_idx" ON "RelevanceScore"("bulletId");

-- CreateIndex
CREATE UNIQUE INDEX "RelevanceScore_applicationId_bulletId_key" ON "RelevanceScore"("applicationId", "bulletId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bullet" ADD CONSTRAINT "Bullet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bullet" ADD CONSTRAINT "Bullet_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bullet" ADD CONSTRAINT "Bullet_duplicateOfBulletId_fkey" FOREIGN KEY ("duplicateOfBulletId") REFERENCES "Bullet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftItem" ADD CONSTRAINT "DraftItem_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftItem" ADD CONSTRAINT "DraftItem_sourceExperienceId_fkey" FOREIGN KEY ("sourceExperienceId") REFERENCES "Experience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftItem" ADD CONSTRAINT "DraftItem_sourceBulletId_fkey" FOREIGN KEY ("sourceBulletId") REFERENCES "Bullet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftItem" ADD CONSTRAINT "DraftItem_parentDraftItemId_fkey" FOREIGN KEY ("parentDraftItemId") REFERENCES "DraftItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelevanceScore" ADD CONSTRAINT "RelevanceScore_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelevanceScore" ADD CONSTRAINT "RelevanceScore_bulletId_fkey" FOREIGN KEY ("bulletId") REFERENCES "Bullet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
