import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The account's Player Finder league pick, in `UserProfile.corePreferences.playerFinderLeagueIds`
 * (the JSONB column added for Core preferences — no migration). See finderLeaguePicks.ts.
 */

/** Null = no pick (read every league). Never throws: a failed read is "no pick", which reads everything. */
export async function getFinderLeaguePicks(userId: string): Promise<string[] | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ picks: unknown }>>`
      SELECT core_preferences->'playerFinderLeagueIds' AS picks FROM user_profiles WHERE "userId" = ${userId}
    `
    const picks = rows[0]?.picks
    return Array.isArray(picks) ? picks.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

/**
 * Merge ONE key atomically (the pattern syncPreferences.ts uses), so saving a pick cannot discard
 * another preference written at the same moment. Null clears the pick.
 */
export async function setFinderLeaguePicks(userId: string, picks: string[] | null): Promise<void> {
  const json = JSON.stringify(picks)
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (${userId}, NOW(), jsonb_build_object('playerFinderLeagueIds', ${json}::jsonb))
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = COALESCE(user_profiles.core_preferences, '{}'::jsonb) ||
        jsonb_build_object('playerFinderLeagueIds', ${json}::jsonb),
      "updatedAt" = NOW()
  `
}
