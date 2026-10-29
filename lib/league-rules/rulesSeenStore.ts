import 'server-only'

import { prisma } from '@/lib/prisma'
import { readRulesSnapshot, type RulesSnapshot } from './rulesSnapshot'

/**
 * The rules each manager last saw, per league (./rulesSnapshot.ts), in `UserProfile.corePreferences`
 * under one key — the column and the atomic-merge style of lib/core-app/leaguePreferencesStore.ts, so
 * no migration. Shape: `{ leagueRulesSeen: { [leagueId]: RulesSnapshot } }`.
 *
 * ⚠ ONE LEAGUE PER WRITE, MERGED IN SQL. Two leagues' cards closed at the same moment must not
 * overwrite each other, so the write sets one path inside the key rather than replacing the map.
 */
export const RULES_SEEN_KEY = 'leagueRulesSeen'

/** Never throws: an unreadable value is "never seen", which shows the welcome sheet again at worst. */
export async function getRulesSeen(userId: string, leagueId: string): Promise<RulesSnapshot | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ seen: unknown }>>`
      SELECT core_preferences -> ${RULES_SEEN_KEY}::text -> ${leagueId}::text AS seen
      FROM user_profiles WHERE "userId" = ${userId}
    `
    return readRulesSnapshot(rows[0]?.seen ?? null)
  } catch {
    return null
  }
}

export async function setRulesSeen(userId: string, leagueId: string, snapshot: RulesSnapshot): Promise<void> {
  const json = JSON.stringify(snapshot)
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (${userId}, NOW(), jsonb_build_object(${RULES_SEEN_KEY}::text, jsonb_build_object(${leagueId}::text, ${json}::jsonb)))
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = jsonb_set(
        COALESCE(user_profiles.core_preferences, '{}'::jsonb) ||
          -- A value that is not an object (never written by this code) is replaced, not set into.
          jsonb_build_object(${RULES_SEEN_KEY}::text, COALESCE(
            CASE WHEN jsonb_typeof(user_profiles.core_preferences -> ${RULES_SEEN_KEY}::text) = 'object'
              THEN user_profiles.core_preferences -> ${RULES_SEEN_KEY}::text END,
            '{}'::jsonb)),
        ARRAY[${RULES_SEEN_KEY}::text, ${leagueId}::text],
        ${json}::jsonb
      ),
      "updatedAt" = NOW()
  `
}
