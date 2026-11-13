import 'server-only'

import { prisma } from '@/lib/prisma'
import { runWaiverIntelligenceAnalysis } from '@/lib/ai-tools-waiver/waiver-intelligence'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolveBestBallLeagueState } from '@/lib/bestball/bestBallLeagueState'
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
 * Today Actions rows from Waiver Intelligence — emits only `critical` / `high` urgency picks
 * from must-add/strong-add tiers, capped per league to avoid noise. Gated by env.
 *
 * Env:
 *   LINEUP_ACTION_WAIVER_SIGNALS=1           — enable (default off; analysis is expensive)
 *   LINEUP_ACTION_WAIVER_MAX_LEAGUES=2       — max leagues scanned per user
 *   LINEUP_ACTION_WAIVER_MAX_PICKS_PER_LEAGUE=2
 */
export async function fetchAiWaiverLineupSignalsForUser(
  userId: string,
  _thresholds: LineupsActionThresholds,
): Promise<LineupActionItem[]> {
  if (!envBool('LINEUP_ACTION_WAIVER_SIGNALS', false)) return []

  const maxLeagues = envInt('LINEUP_ACTION_WAIVER_MAX_LEAGUES', 2)
  if (maxLeagues === 0) return []
  const maxPicksPerLeague = envInt('LINEUP_ACTION_WAIVER_MAX_PICKS_PER_LEAGUE', 2)
  if (maxPicksPerLeague === 0) return []

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
      bbWaiversEnabled: true,
      bbFaEnabled: true,
    },
    take: 24,
  })

  const out: LineupActionItem[] = []

  for (const lg of leagues.slice(0, maxLeagues)) {
    // Waiver advice is about adds, not lineups, so a best ball league is skipped only when it allows NO
    // adds: a Classic league with both its waiver and free-agency switches off (the draft-only default).
    // It used to skip every `bestBallMode` league, even one with waivers on, and to keep a tournament
    // saved by `leagueType` alone that allows no adds at all.
    const bb = resolveBestBallLeagueState(lg).transactions
    if (bb.waivers === false && bb.freeAgency === false) continue
    const res = await runWaiverIntelligenceAnalysis({
      userId,
      sportFilter: 'ALL',
      leagueId: lg.id,
      position: 'ALL',
      rookiesOnly: false,
      strategy: 'best_available',
      teamContext: 'my_team',
      timeHorizon: 'this_week',
    })
    if (!res.ok) continue
    if (res.analysisMode !== 'league') continue

    const urgent = res.picks
      .filter((p) => p.urgency === 'critical' || p.urgency === 'high')
      .filter((p) => p.tier === 'must_add' || p.tier === 'strong_add')
      .slice(0, maxPicksPerLeague)

    for (const p of urgent) {
      const urgency: LineupActionItem['urgency'] = p.urgency === 'critical' ? 'urgent' : 'soon'
      const severity: LineupActionItem['severity'] = p.urgency === 'critical' ? 'warning' : 'info'
      const faabNote = res.waiverTypeLabel.toLowerCase().includes('faab')
        ? ` · FAAB ~${p.faabPct}%`
        : ''
      const dropNote = p.suggestedDrop ? ` · drop ${p.suggestedDrop.name}` : ''
      out.push({
        leagueId: lg.id,
        leagueName: lg.name ?? 'League',
        sport: normalizeToSupportedSport(lg.sport),
        platform: lg.platform,
        teamId: null,
        slotIndex: null,
        slotId: null,
        slotLabel: null,
        playerId: p.recordId ?? p.playerId,
        playerName: p.name,
        reasonType: 'ai_waiver',
        urgency,
        lockTime: res.timeContext.waiversProcessAt ?? null,
        recommendedAction: `Add ${p.name} (${p.position}) — ${p.tier.replace('_', ' ')}${faabNote}${dropNote}.`,
        suggestedReplacementPlayerId: p.suggestedDrop?.playerId ?? null,
        confidence: p.confidence,
        expectedGain: p.effectiveProjection ?? null,
        sourceModule: 'Waiver',
        message: `${p.name} (${p.position}, ${p.team}) — ${p.why.slice(0, 140)}`,
        severity,
      })
    }
  }

  return out
}
