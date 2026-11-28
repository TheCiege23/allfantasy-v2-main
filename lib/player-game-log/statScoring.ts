import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { resolveLeagueAccess } from '@/lib/league-access'

export type StatScoringInfo = { kind: 'league'; leagueName: string | null } | { kind: 'default' } | { kind: 'none' }

/**
 * Shared by the game log and the window ranks. `key` names the scoring for caching: the league id
 * when its settings were used, else `default`.
 *
 * The league's own scoring when the caller may read it, else the sport's defaults. A league the user
 * is not in, or one in another sport, silently falls back to defaults — and `scoring.kind` says so.
 */
export async function resolveStatScoring(sport: string, leagueId: string | null) {
  if (leagueId) {
    try {
      const user = await resolvePlatformUser()
      const access = user.appUserId ? await resolveLeagueAccess(leagueId, user.appUserId) : null
      if (access?.isMember) {
        const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true, name: true } })
        if (league && normalizeToSupportedSport(league.sport) === sport) {
          const scorer = buildLeagueStatScorer({ sport: league.sport, settings: league.settings })
          if (scorer) return { scorer, key: leagueId, info: { kind: 'league', leagueName: league.name ?? null } as StatScoringInfo }
        }
      }
    } catch {
      /* fall through to the sport's defaults */
    }
  }
  const scorer = buildLeagueStatScorer({ sport, settings: null })
  return { scorer, key: 'default', info: (scorer ? { kind: 'default' } : { kind: 'none' }) as StatScoringInfo }
}
