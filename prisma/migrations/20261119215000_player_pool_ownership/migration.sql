-- Separate physical copies share the canonical athlete ID used by the scoring feed.
CREATE TABLE league_player_pool_ownership (
  "rosterPlayerId" text PRIMARY KEY REFERENCES redraft_roster_players(id) ON DELETE CASCADE,
  "seasonId" text NOT NULL,
  "poolKey" text NOT NULL,
  "playerId" text NOT NULL,
  CONSTRAINT league_player_pool_copy_key UNIQUE ("seasonId","poolKey","playerId") DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION sync_league_player_pool_copy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target redraft_rosters%ROWTYPE;
  cfg jsonb;
  scope text;
  division_index integer;
  group_index integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM league_player_pool_ownership WHERE "rosterPlayerId" = NEW.id;
  END IF;
  IF NEW."droppedAt" IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT target FROM redraft_rosters WHERE id = NEW."rosterId";
  SELECT settings INTO cfg FROM leagues WHERE id = target."leagueId" FOR SHARE;
  scope := cfg->>'player_pool_scope';
  IF scope IS NULL OR scope = 'league' THEN RETURN NEW; END IF;
  SELECT (cfg->'division_config'->'teamAssignments'->>t.id)::integer INTO division_index
    FROM rosters r JOIN league_teams t ON t."leagueId" = r."leagueId" AND
      (t."externalId" = r.id OR t."externalId" = COALESCE(r."playerData"->>'source_team_id', r."playerData"#>>'{import,sourceTeamId}'))
    WHERE r."leagueId" = target."leagueId" AND
      (r."redraftRosterId" = target.id OR r."platformUserId" = target."ownerId" OR 'roster:' || r.id = target."ownerId")
    ORDER BY (t."externalId" = r.id) DESC, (r."redraftRosterId" IS NOT DISTINCT FROM target.id) DESC, r.id LIMIT 1;
  group_index := CASE WHEN scope='division' THEN division_index ELSE (cfg->'division_conferences'->>division_index)::integer END;
  IF group_index IS NULL THEN RAISE EXCEPTION 'Assign the receiving franchise to a player pool' USING ERRCODE='23514'; END IF;
  INSERT INTO league_player_pool_ownership ("rosterPlayerId","seasonId","poolKey","playerId")
    VALUES (NEW.id,target."seasonId",scope || '-' || group_index,NEW."playerId");
  RETURN NEW;
END $$;

CREATE TRIGGER redraft_roster_player_pool_copy AFTER INSERT OR UPDATE OF "rosterId","playerId","droppedAt"
ON redraft_roster_players FOR EACH ROW EXECUTE FUNCTION sync_league_player_pool_copy();

CREATE FUNCTION rebuild_league_player_pool_copies() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(OLD.settings->>'player_pool_scope','league')='league' AND COALESCE(NEW.settings->>'player_pool_scope','league')='league' THEN RETURN NEW; END IF;
  IF (OLD.settings->'player_pool_scope', OLD.settings->'division_config'->'teamAssignments', OLD.settings->'division_conferences')
    IS NOT DISTINCT FROM (NEW.settings->'player_pool_scope', NEW.settings->'division_config'->'teamAssignments', NEW.settings->'division_conferences') THEN RETURN NEW; END IF;
  UPDATE redraft_roster_players p SET "rosterId"=p."rosterId" FROM redraft_rosters r
    WHERE r.id=p."rosterId" AND r."leagueId"=NEW.id AND p."droppedAt" IS NULL AND r."seasonId" = (
      SELECT id FROM redraft_seasons WHERE "leagueId"=NEW.id ORDER BY season DESC, "createdAt" DESC LIMIT 1
    );
  RETURN NEW;
END $$;
CREATE TRIGGER league_player_pool_layout AFTER UPDATE OF settings ON leagues FOR EACH ROW EXECUTE FUNCTION rebuild_league_player_pool_copies();

