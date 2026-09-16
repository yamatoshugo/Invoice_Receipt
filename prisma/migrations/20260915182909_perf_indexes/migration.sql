-- CreateIndex
CREATE INDEX "GmailItem_kind_status_idx" ON "GmailItem"("kind", "status");

-- CreateIndex
CREATE INDEX "GmailMessage_gmailThreadId_idx" ON "GmailMessage"("gmailThreadId");

-- CreateIndex
CREATE INDEX "GmailScan_startedAt_idx" ON "GmailScan"("startedAt");
