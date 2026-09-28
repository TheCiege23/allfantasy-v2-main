-- Reversible account preferences. Existing history and provider sync state are untouched.
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "core_preferences" JSONB;
