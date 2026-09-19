-- Franchise hubs can contain any number of leagues. `role` remains a display
-- and strategy label, but is no longer the identity of a member.
DROP INDEX IF EXISTS "franchise_league_members_linkId_role_key";
CREATE INDEX IF NOT EXISTS "franchise_league_members_linkId_role_idx"
  ON "franchise_league_members"("linkId", "role");
