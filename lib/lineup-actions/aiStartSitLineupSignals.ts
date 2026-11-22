import 'server-only'

import { prisma } from '@/lib/prisma'
import { runStartSitAnalysis } from '@/lib/ai-tools-start-sit/runStartSitAnalysis'
import { bestBallLineupSetsItself } from '@/lib/bestball/bestBallLeagueState'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { LineupsActionThresholds } from '@/lib/lineup-actions/thresholds'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim()?.toLowerCase()
  if (!raw) return fallback
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return fallback
}

/**
 * Today Actions rows sourced from Start/Sit `unresolvedDecisions` (same-slot close calls).
 * Gated by LINEUP_ACTION_START_SIT_SIGNALS=1 and capped by LINEUP_ACTION_START_SIT_MAX_LEAGUES.
 * Emits only when urgency === 'high' (projection gap < 1.0 pt) to avoid noise — and never for
 * best-ball leagues since those decisions are informational.
 */
export async function fetchAiStartSitLineupSignalsForUser(
  userId: string,
  _thresholds: LineupsActionThresholds,
): Promise<LineupActionItem[]> {
  if (!envBool('LINEUP_ACTION_START_SIT_SIGNALS', false)) return []

  const maxLeagues = envInt('LINEUP_ACTION_START_SIT_MAX_LEAGUES', 2)
  if (maxLeagues === 0) return []

  const leagues = await prisma.league.findMany({
    where: {
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: {
      id: true,
      name: true,
      sport: true,
      platform: true,
      bestBallMode: true,
      leagueType: true,
      leagueVariant: true,
      guillotineMode: true,
      settings: true,
    },
    take: 24,
  })

  const out: LineupActionItem[] = []

  for (const lg of leagues.slice(0, maxLeagues)) {
    // Classic Best Ball or best ball Guilly: the optimizer sets the lineup (lib/bestball/bestBallLeagueState.ts).
    if (bestBallLineupSetsItself(lg)) continue
    const res = await runStartSitAnalysis({
      userId,
      sportFilter: 'ALL',
      leagueId: lg.id,
      week: 'current',
      mode: 'balanced',
      teamExternalId: null,
    })
    if (!res.ok) continue
    if (res.bestBallInformational) continue

    for (const d of res.unresolvedDecisions) {
      if (d.urgency !== 'high') continue
      if (d.informationalOnly) continue
      out.push({
        leagueId: lg.id,
        leagueName: lg.name ?? 'League',
        sport: normalizeToSupportedSport(lg.sport),
        platform: lg.platform,
        teamId: res.teamId,
        slotIndex: null,
        slotId: null,
        slotLabel: d.slotLabel,
        playerId: null,
        playerName: d.optionA,
        reasonType: 'ai_start_sit',
        urgency: 'soon',
        lockTime: res.timeContext.nextLockTimeUTC ?? null,
        recommendedAction: `Start/Sit close call (${d.projectedGap} pt gap) — open Start/Sit for the grounded pick.`,
        suggestedReplacementPlayerId: null,
        confidence: res.confidenceScore,
        expectedGain: d.projectedGap,
        sourceModule: 'StartSit',
        message: `${d.slotLabel}: ${d.optionA} vs ${d.optionB} (~${d.projectedGap} pt gap).`,
        severity: 'info',
      })
    }
  }

  return out
}
