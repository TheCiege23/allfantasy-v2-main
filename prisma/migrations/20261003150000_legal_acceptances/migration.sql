-- Terms / disclaimer / privacy acceptances, one row per document per acceptance, at the
-- version the user saw (lib/legal/legalVersions). Additive: one new empty table, no change to any
-- existing table. The application tolerates this table being absent (writes are best-effort,
-- the export reports the section unavailable), so code may land before this is applied.

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" VARCHAR(32) NOT NULL,
    "documentVersion" VARCHAR(64) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_acceptances_userId_document_idx" ON "legal_acceptances"("userId", "document");

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
