-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('NEEDS_REVIEW', 'EXTRACTION_FAILED', 'APPROVED', 'EXCLUDED', 'EXPORTED', 'PAID');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "blobPathname" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "vendorName" TEXT,
    "bankCode" TEXT,
    "bankName" TEXT,
    "branchCode" TEXT,
    "branchName" TEXT,
    "accountType" TEXT,
    "accountNumber" TEXT,
    "recipientName" TEXT,
    "invoiceNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "billedAmount" INTEGER,
    "transferAmount" INTEGER,
    "confidence" JSONB,
    "extractionError" TEXT,
    "note" TEXT,
    "excludeReason" TEXT,
    "updatedByEmail" TEXT,
    "exportBatchId" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "rawResponse" JSONB,
    "error" TEXT,

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "csvBase64" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "ExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requesterCode" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "senderBankCode" TEXT NOT NULL DEFAULT '0038',
    "senderBranchCode" TEXT NOT NULL,
    "senderAccountNumber" TEXT NOT NULL,
    "updatedByEmail" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_sha256_key" ON "Invoice"("sha256");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "Invoice_exportBatchId_idx" ON "Invoice"("exportBatchId");

-- CreateIndex
CREATE INDEX "ExtractionRun_invoiceId_idx" ON "ExtractionRun"("invoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_exportBatchId_fkey" FOREIGN KEY ("exportBatchId") REFERENCES "ExportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
