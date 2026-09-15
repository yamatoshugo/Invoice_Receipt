-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('UPLOAD', 'GMAIL');

-- CreateEnum
CREATE TYPE "GmailScanState" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "GmailItemKind" AS ENUM ('ATTACHMENT');

-- CreateEnum
CREATE TYPE "GmailItemStatus" AS ENUM ('PENDING', 'IMPORTING', 'IMPORTED', 'DUPLICATE', 'NOT_PDF', 'UNREADABLE', 'TOO_LARGE', 'FAILED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "gmailFrom" TEXT,
ADD COLUMN     "gmailMessageId" TEXT,
ADD COLUMN     "gmailReceivedAt" TIMESTAMP(3),
ADD COLUMN     "gmailSubject" TEXT,
ADD COLUMN     "source" "InvoiceSource" NOT NULL DEFAULT 'UPLOAD';

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "refreshTokenCipher" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectedByEmail" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailScan" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mailboxAddress" TEXT NOT NULL,
    "windowFrom" TIMESTAMP(3) NOT NULL,
    "windowTo" TIMESTAMP(3) NOT NULL,
    "query" TEXT NOT NULL,
    "state" "GmailScanState" NOT NULL DEFAULT 'RUNNING',
    "pageToken" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "listedMessageCount" INTEGER NOT NULL DEFAULT 0,
    "inWindowMessageCount" INTEGER NOT NULL DEFAULT 0,
    "inWindowThreadCount" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "newItemCount" INTEGER NOT NULL DEFAULT 0,
    "startedByEmail" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "GmailScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "internalDate" TIMESTAMP(3) NOT NULL,
    "fromRaw" TEXT NOT NULL,
    "fromAddress" TEXT,
    "fromName" TEXT,
    "subject" TEXT,
    "labelIds" TEXT[],
    "attachmentsScannedAt" TIMESTAMP(3),
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "scanId" TEXT NOT NULL,

    CONSTRAINT "GmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" "GmailItemKind" NOT NULL,
    "ref" TEXT NOT NULL,
    "attachmentId" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "disposition" TEXT,
    "size" INTEGER,
    "status" "GmailItemStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "invoiceId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedEmail" TEXT,
    "acknowledgeReason" TEXT,
    "autoSkipped" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),

    CONSTRAINT "GmailItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GmailScan_state_idx" ON "GmailScan"("state");

-- CreateIndex
CREATE INDEX "GmailScan_windowFrom_idx" ON "GmailScan"("windowFrom");

-- CreateIndex
CREATE UNIQUE INDEX "GmailMessage_gmailMessageId_key" ON "GmailMessage"("gmailMessageId");

-- CreateIndex
CREATE INDEX "GmailMessage_internalDate_idx" ON "GmailMessage"("internalDate");

-- CreateIndex
CREATE INDEX "GmailMessage_scanId_idx" ON "GmailMessage"("scanId");

-- CreateIndex
CREATE INDEX "GmailItem_status_idx" ON "GmailItem"("status");

-- CreateIndex
CREATE INDEX "GmailItem_invoiceId_idx" ON "GmailItem"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailItem_messageId_kind_ref_key" ON "GmailItem"("messageId", "kind", "ref");

-- CreateIndex
CREATE INDEX "Invoice_source_idx" ON "Invoice"("source");

-- AddForeignKey
ALTER TABLE "GmailMessage" ADD CONSTRAINT "GmailMessage_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "GmailScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailItem" ADD CONSTRAINT "GmailItem_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "GmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailItem" ADD CONSTRAINT "GmailItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
