import 'server-only'

import type { LeagueSport } from '@prisma/client'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import type { RosterTemplateSlotDto } from '@/lib/multi-sport/RosterTemplateService'
import type { SupportedSport } from '@/lib/sport-scope'
import { bestBallDisplaySlots } from '@/lib/bestball/productionLineup'

export type StartSitLineupCandidate = {
  playerId: string
  name: string
  position: string
  effectiveProjection: number | null
  /** Kickoff / first-pitch ISO for the candidate's upcoming game, when known. */
  gameStartTime?: string | null
}

export type StartSitSlotAnalysis = {
  slotName: string
  allowedPositions: string[]
  candidates: StartSitLineupCandidate[]
  /**
   * Whether the top candidate's game has not yet started (late-swap eligible).
   * `null` when we have no game-time data to decide.
   */
  canLateSwap: boolean | null
  /** ISO of the top candidate's game kickoff when known — used to render lock badges. */
  topCandidateGameStart: string | null
}

function posMatchesSlot(playerPos: string, allowed: string[]): boolean {
  const p = playerPos.trim().toUpperCase()
  if (allowed.length === 0) return true
  return allowed.some((a) => {
    const u = a.toUpperCase()
    if (u === p) return true
    if (u === 'FLEX' && ['RB', 'WR', 'TE'].includes(p)) return true
    if (u === 'SFLX' || u === 'SUPER_FLEX') return ['QB', 'RB', 'WR', 'TE'].includes(p)
    if (u === 'BN' || u === 'BENCH') return false
    return false
  })
}

/**
 * Maps league roster template starter slots to eligible roster players (by position rules).
 * Uses real template rows — no fabricated lineup locks.
 */
export async function analyzeStarterSlots(args: {
  leagueId: string
  leagueSport: LeagueSport
  sport: SupportedSport
  players: StartSitLineupCandidate[]
  /**
   * A best ball league's `settings`. Present only for a best ball league: its seats are the ones its
   * matchups are scored on (`buildBestBallSlots`), read from the league, not the sport's `standard`
   * template.
   */
  bestBallSettings?: unknown
}): Promise<{ slots: StartSitSlotAnalysis[]; templateId: string; dataGaps: string[] }> {
  const dataGaps: string[] = []
  /*
   * 🛑 A BEST BALL LEAGUE WAS SHOWN THE SPORT'S `standard` SEATS (audit 2026-11-06, "Chimmy reads real
   * state"). The template below is looked up with format `standard`, which for a best ball league is the
   * sport default, not the seats this league's matchups are scored on. Production scores on the league's
   * own seats (`buildBestBallSlots`), so read those.
   */
  if (args.bestBallSettings !== undefined) {
    const seats = bestBallDisplaySlots(String(args.leagueSport), args.bestBallSettings ?? {})
    if (seats.length > 0) {
      const asTemplateSlots: RosterTemplateSlotDto[] = seats.map((s, i) => ({
        slotName: s.code,
        allowedPositions: s.allowedPositions,
        starterCount: s.count,
        benchCount: 0,
        reserveCount: 0,
        taxiCount: 0,
        devyCount: 0,
        isFlexibleSlot: s.allowedPositions.length > 1,
        slotOrder: i,
      }))
      return { slots: expandSlots(asTemplateSlots, args.players), templateId: `best_ball-${args.leagueSport}-${args.leagueId}`, dataGaps }
    }
  }
  let template
  try {
    template = await getRosterTemplateForLeague(args.leagueSport, 'standard', args.leagueId)
  } catch {
    dataGaps.push('Roster template unavailable — slot eligibility fallback is position-only.')
    return { slots: [], templateId: 'none', dataGaps }
  }

  const starterSlots: RosterTemplateSlotDto[] = template.slots
    .filter((s) => s.starterCount > 0)
    .sort((a, b) => a.slotOrder - b.slotOrder)

  const slots = expandSlots(starterSlots, args.players)

  if (slots.length === 0) {
    dataGaps.push('No starter slots resolved from template — league may use a custom format not in registry.')
  }

  return { slots, templateId: template.templateId, dataGaps }
}

function expandSlots(starterSlots: RosterTemplateSlotDto[], players: StartSitLineupCandidate[]): StartSitSlotAnalysis[] {
  const nowMs = Date.now()
  const slots: StartSitSlotAnalysis[] = []
  for (const s of starterSlots) {
    const allowed = s.allowedPositions?.length ? s.allowedPositions : []
    const candidates = players.filter((p) => posMatchesSlot(p.position, allowed))
    const sorted = [...candidates].sort((a, b) => (b.effectiveProjection ?? -1) - (a.effectiveProjection ?? -1))
    const topStart = sorted[0]?.gameStartTime ?? null
    const topMs = topStart ? Date.parse(topStart) : NaN
    const canLateSwap = Number.isFinite(topMs) ? topMs > nowMs : null
    for (let i = 0; i < s.starterCount; i++) {
      slots.push({
        slotName: s.starterCount > 1 ? `${s.slotName} ${i + 1}` : s.slotName,
        allowedPositions: allowed,
        candidates: sorted,
        canLateSwap,
        topCandidateGameStart: topStart,
      })
    }
  }
  return slots
}

export function lineupBehaviorNote(bestBall: boolean, scoringPeriod: 'weekly' | 'daily' | 'unknown'): string {
  if (bestBall) return 'Best ball: weekly optimal scoring — manual start/sit is informational only.'
  if (scoringPeriod === 'daily')
    return 'Daily lineup league: verify lineup locks each slate; server times are authoritative.'
  return 'Weekly lineup league: set starters before the platform lock for this period.'
}
