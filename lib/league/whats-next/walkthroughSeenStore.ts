import 'server-only'

import { prisma } from '@/lib/prisma'
import { FORMAT_WALKTHROUGHS } from './formatWalkthroughs'
import type { WhatsNextFormatId } from './types'

/**
 * Which format walkthroughs a user has seen, on their ACCOUNT rather than in one browser — so a
 * commissioner who watched the Big Brother walkthrough on a laptop is not shown it again on a phone.
 *
 * Stored in `UserProfile.corePreferences.formatWalkthroughSeen[format] = <ISO time>`, the account-scoped
 * JSONB column, with the same atomic SQL merge as lib/league-rules-explainer/seenStore.ts: one format's
 * entry is merged in SQL, never read-modify-written in JS, so a save cannot discard another Core
 * preference written at the same moment. No migration: the column already exists.
 */
export const WALKTHROUGH_SEEN_KEY = 'formatWalkthroughSeen'

export function isWalkthroughFormat(value: unknown): value is WhatsNextFormatId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FORMAT_WALKTHROUGHS, value)
}

/** Only well-formed entries for formats that have a walkthrough survive the read. */
export function readWalkthroughSeen(value: unknown): Partial<Record<WhatsNextFormatId, string>> {
  const out: Partial<Record<WhatsNextFormatId, string>> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [format, at] of Object.entries(value as Record<string, unknown>)) {
    if (isWalkthroughFormat(format) && typeof at === 'string' && Number.isFinite(Date.parse(at))) out[format] = at
  }
  return out
}

/**
 * Never throws. A failed read returns `null` — "unknown", NOT "nothing seen" — so the caller can fall
 * back to the browser's own flag instead of re-showing a walkthrough the user has already dismissed.
 */
export async function getWalkthroughSeen(userId: string): Promise<Partial<Record<WhatsNextFormatId, string>> | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ seen: unknown }>>`
      SELECT core_preferences->${WALKTHROUGH_SEEN_KEY}::text AS seen
      FROM user_profiles WHERE "userId" = ${userId}
    `
    return readWalkthroughSeen(rows[0]?.seen ?? null)
  } catch {
    return null
  }
}

export async function markWalkthroughSeenForUser(userId: string, format: WhatsNextFormatId, at: Date = new Date()): Promise<void> {
  const iso = at.toISOString()
  await prisma.$executeRaw`
    INSERT INTO user_profiles ("userId", "updatedAt", core_preferences)
    VALUES (
      ${userId},
      NOW(),
      jsonb_build_object(${WALKTHROUGH_SEEN_KEY}::text, jsonb_build_object(${format}::text, ${iso}::text))
    )
    ON CONFLICT ("userId") DO UPDATE SET
      core_preferences = COALESCE(user_profiles.core_preferences, '{}'::jsonb) ||
        jsonb_build_object(
          ${WALKTHROUGH_SEEN_KEY}::text,
          (CASE WHEN jsonb_typeof(user_profiles.core_preferences->${WALKTHROUGH_SEEN_KEY}::text) = 'object'
                THEN user_profiles.core_preferences->${WALKTHROUGH_SEEN_KEY}::text
                ELSE '{}'::jsonb END)
            || jsonb_build_object(${format}::text, ${iso}::text)
        ),
      "updatedAt" = NOW()
  `
}
