-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GmailItemStatus" ADD VALUE 'REQUEST_SENDING';
ALTER TYPE "GmailItemStatus" ADD VALUE 'REQUEST_SENT';
ALTER TYPE "GmailItemStatus" ADD VALUE 'REQUEST_FAILED';

-- AlterTable
ALTER TABLE "GmailItem" ADD COLUMN     "lastRequestAttemptAt" TIMESTAMP(3),
ADD COLUMN     "requestAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requestError" TEXT,
ADD COLUMN     "requestSentAt" TIMESTAMP(3),
ADD COLUMN     "requestToAddress" TEXT;

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "requestMailBody" TEXT,
ADD COLUMN     "requestMailFromName" TEXT,
ADD COLUMN     "requestMailSubject" TEXT;

-- CreateTable
CREATE TABLE "GmailRequestMail" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "threadedTo" TEXT,
    "sentGmailMessageId" TEXT,
    "sentGmailThreadId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentByEmail" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "GmailRequestMail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmailRequestMail_itemId_idx" ON "GmailRequestMail"("itemId");

-- CreateIndex
CREATE INDEX "GmailRequestMail_toAddress_idx" ON "GmailRequestMail"("toAddress");

-- AddForeignKey
ALTER TABLE "GmailRequestMail" ADD CONSTRAINT "GmailRequestMail_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "GmailItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
