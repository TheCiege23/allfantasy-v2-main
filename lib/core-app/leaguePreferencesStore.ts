import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  EMPTY_LEAGUE_PREFERENCES,
  LEAGUE_PREFERENCE_KEYS,
  readLeaguePreferences,
  type LeaguePreferenceField,
  type LeaguePreferences,
} from '@/lib/core-app/leaguePreferences'

/**
 * The account's league-list preferences, in `UserProfile.corePreferences` — the same column and the
 * same atomic one-key merge as finderLeaguePicksStore.ts. See leaguePreferences.ts for what they mean.
 */

/** Never throws: a failed read is "no preferences", which shows every league in its natural order. */
export async function getLeaguePreferences(userId: string): Promise<LeaguePreferences> {
  try {
    const rows = await prisma.$queryRaw<Array<{ core: unknown }>>`
      SELECT core_preferences AS core FROM user_profiles WHERE "userId" = ${userId}
    `
    return readLeaguePreferences(rows[0]?.core ?? null)
  } catch {
    return EMPTY_LEAGUE_PREFERENCES
  }
}

/**
 * Merge ONE list atomically, so saving the order cannot discard a favorite written at the same
 * moment (or the Player Finder pick, or the paused-sync keys, which share the column). The field is
 * whitelisted through LEAGUE_PREFERENCE_KEYS — never a caller-supplied JSON key.
 */
export async function setLeaguePreference(userId: string, field: LeaguePreferenceField, ids: string[]): Promise<void> {
  // Own keys only — an inherited name ("__proto__", "constructor") must never become a JSON key.
  if (!Object.prototype.hasOwnProperty.call(LEAGUE_PREFERENCE_KEYS, field)) throw new Error('Unknown league preference')
  const key = LEAGUE_PREFERENCE_KEYS[field]
  const json = JSON.stringify(ids)
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (${userId}, NOW(), jsonb_build_object(${key}::text, ${json}::jsonb))
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = COALESCE(user_profiles.core_preferences, '{}'::jsonb) ||
        jsonb_build_object(${key}::text, ${json}::jsonb),
      "updatedAt" = NOW()
  `
}
