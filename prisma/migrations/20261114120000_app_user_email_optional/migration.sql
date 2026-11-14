-- Phone-only sign-up (2026-11-14): an account may have a verified phone number and no email.
-- The unique index on "email" stays; Postgres allows many NULLs under a unique index, so
-- every phone-only account can have none while two accounts still cannot share an address.
--
-- Reversible only while no row has a NULL email:
--   ALTER TABLE "app_users" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "app_users" ALTER COLUMN "email" DROP NOT NULL;
