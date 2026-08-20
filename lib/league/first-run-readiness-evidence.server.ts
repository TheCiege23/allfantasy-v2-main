import 'server-only'

import { prisma } from '@/lib/prisma'
import type { LeagueFirstRunNiceEvidence } from '@/lib/league/first-run-types'

/**
 * Loads NICE-row evidence from persisted data only (Phase 6B).
 *
 * **Welcome (nice_welcome)** — `true` when either:
 * - `League.settings.leagueChatWelcomePosted === true` (e.g. tournament bootstrap), or
 * - At least one `LeagueChatMessage` exists from the head commissioner **or** a team flagged
 *   `isCommissioner` / `isCoCommissioner` with a claimed user, in main league chat
 *   (`source` null or `'league'`).
 *
 * **Scoring reviewed (nice_scoring)** — no first-class persisted flag found in settings save
 * paths (gap: see `FIRST_RUN_SIGNAL_GAPS` in this file). Omit unless a boolean is added later.
 */
export const FIRST_RUN_SIGNAL_GAPS = [
  'No persisted `commissionerScoringReviewed` (or similar) on League.settings — NICE scoring row stays omitted unless added.',
  'No persisted `draftSettingsReviewed` flag — draft-settings NICE not wired.',
] as const

function settingsRecord(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
  return settings as Record<string, unknown>
}

export async function loadLeagueFirstRunNiceEvidence(input: {
  leagueId: string
  leagueOwnerUserId: string
  settings: unknown
}): Promise<LeagueFirstRunNiceEvidence> {
  const s = settingsRecord(input.settings)
  const welcomeFlag = s.leagueChatWelcomePosted
  if (welcomeFlag === true) {
    return { welcomeMessagePostedEvidence: true }
  }
  if (welcomeFlag === false) {
    return { welcomeMessagePostedEvidence: false }
  }

  const teamCommissioners = await prisma.leagueTeam.findMany({
    where: {
      leagueId: input.leagueId,
      OR: [{ isCommissioner: true }, { isCoCommissioner: true }],
      claimedByUserId: { not: null },
    },
    select: { claimedByUserId: true },
  })

  const ids = new Set<string>()
  ids.add(input.leagueOwnerUserId)
  for (const row of teamCommissioners) {
    if (row.claimedByUserId) ids.add(row.claimedByUserId)
  }

  const poster = await prisma.leagueChatMessage.findFirst({
    where: {
      leagueId: input.leagueId,
      userId: { in: [...ids] },
      OR: [{ source: null }, { source: 'league' }],
      message: { not: '' },
    },
    select: { id: true },
  })

  return {
    welcomeMessagePostedEvidence: Boolean(poster),
  }
}
