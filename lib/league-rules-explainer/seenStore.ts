import 'server-only'

import { prisma } from '@/lib/prisma'
import { EMPTY_LEAGUE_RULES_SEEN, LEAGUE_RULES_SEEN_KEY, readLeagueRulesSeen, type LeagueRulesSeen } from './view'

/**
 * Per-member seen-state for the rules popup and the "What changed" card, in
 * `UserProfile.corePreferences.leagueRulesSeen[leagueId]` — the account-scoped JSONB column for Core
 * preferences (the same column, and the same atomic merge, as lib/core-app/finderLeaguePicksStore.ts).
 * No migration: the column already exists.
 *
 * ⚠ ONE LEAGUE'S ENTRY IS MERGED IN SQL, never read-modify-written in JS, so a save here cannot
 * discard a league-list preference or another league's entry written at the same moment.
 */

/** Never throws: a failed read is "nothing seen yet", which at worst shows the rules once more. */
export async function getLeagueRulesSeen(userId: string, leagueId: string): Promise<LeagueRulesSeen> {
  try {
    const rows = await prisma.$queryRaw<Array<{ seen: unknown }>>`
      SELECT core_preferences->${LEAGUE_RULES_SEEN_KEY}::text->(${leagueId}::text) AS seen
      FROM user_profiles WHERE "userId" = ${userId}
    `
    return readLeagueRulesSeen(rows[0]?.seen ?? null)
  } catch {
    return { ...EMPTY_LEAGUE_RULES_SEEN }
  }
}

export async function setLeagueRulesSeen(userId: string, leagueId: string, value: LeagueRulesSeen): Promise<void> {
  const json = JSON.stringify({
    rulesSeenAt: value.rulesSeenAt,
    lastSeenSettingsEventId: value.lastSeenSettingsEventId,
    lastSeenSettingsEventAt: value.lastSeenSettingsEventAt,
  })
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (
      ${userId},
      NOW(),
      jsonb_build_object(${LEAGUE_RULES_SEEN_KEY}::text, jsonb_build_object(${leagueId}::text, ${json}::jsonb))
    )
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = COALESCE(user_profiles.core_preferences, '{}'::jsonb) ||
        jsonb_build_object(
          ${LEAGUE_RULES_SEEN_KEY}::text,
          (CASE WHEN jsonb_typeof(user_profiles.core_preferences->${LEAGUE_RULES_SEEN_KEY}::text) = 'object'
                THEN user_profiles.core_preferences->${LEAGUE_RULES_SEEN_KEY}::text
                ELSE '{}'::jsonb END)
            || jsonb_build_object(${leagueId}::text, ${json}::jsonb)
        ),
      "updatedAt" = NOW()
  `
}

/**
 * Many members' entries for one league in one read, for Commish OS. A member with no profile row or
 * no entry is absent from the map — "nothing seen", exactly as `getLeagueRulesSeen` reads it.
 */
export async function getLeagueRulesSeenForUsers(userIds: readonly string[], leagueId: string): Promise<Map<string, LeagueRulesSeen>> {
  const out = new Map<string, LeagueRulesSeen>()
  if (!userIds.length) return out
  const rows = await prisma.$queryRaw<Array<{ userId: string; seen: unknown }>>`
    SELECT "userId", core_preferences->${LEAGUE_RULES_SEEN_KEY}::text->(${leagueId}::text) AS seen
    FROM user_profiles WHERE "userId" = ANY(${[...userIds]}::text[])
  `
  for (const row of rows) if (row.seen != null) out.set(row.userId, readLeagueRulesSeen(row.seen))
  return out
}
