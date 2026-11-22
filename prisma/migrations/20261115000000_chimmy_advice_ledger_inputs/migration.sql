-- The advice ledger, start/sit (2026-11-14): what each call knew, and whether it was withdrawn.
-- Three NULLABLE columns on an existing table; no existing row or column changes. The writer
-- (lib/chimmy-advice/adviceStore.ts) falls back to the old insert when these columns are absent,
-- and no existing reader selects them, so code may ship before this is applied.
-- Reversible: ALTER TABLE "chimmy_advice" DROP COLUMN "rec_projected", DROP COLUMN "alt_projected", DROP COLUMN "withdrawn_at";

-- AlterTable
ALTER TABLE "chimmy_advice" ADD COLUMN     "alt_projected" DOUBLE PRECISION,
ADD COLUMN     "rec_projected" DOUBLE PRECISION,
ADD COLUMN     "withdrawn_at" TIMESTAMP(3);


