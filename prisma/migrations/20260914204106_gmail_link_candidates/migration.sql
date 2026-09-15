-- CreateEnum
CREATE TYPE "GmailLinkKind" AS ENUM ('PDF', 'LOGIN', 'OTHER');

-- AlterEnum
ALTER TYPE "GmailItemKind" ADD VALUE 'LINK';

-- AlterEnum
ALTER TYPE "GmailItemStatus" ADD VALUE 'LOGIN_REQUIRED';

-- AlterTable
ALTER TABLE "GmailItem" ADD COLUMN     "linkCandidateCount" INTEGER,
ADD COLUMN     "linkConfidence" DOUBLE PRECISION,
ADD COLUMN     "linkKind" "GmailLinkKind",
ADD COLUMN     "url" TEXT;

-- AlterTable
ALTER TABLE "GmailMessage" ADD COLUMN     "linkCandidateCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "linksScannedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GmailMessage_linksScannedAt_idx" ON "GmailMessage"("linksScannedAt");
