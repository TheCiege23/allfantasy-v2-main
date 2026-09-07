import type { LeagueImpact } from './playerImpact'
import type { RecommendedMove } from './playerFinder'
import { isHealthyDesignation, isRuledOut } from './injuryStatus'
import { claimLink, lineupLink, movePath, type PlatformLink } from './platformLinks'
import { moveLegality, swapLegality, type Kickoffs } from './swapLegality'

/**
 * "Recommended moves" — every card names platform › league › screen, carries a
 * point delta, and ends in "Open in <platform>". Never "consider starting him".
 *
 * ⚠ CLIENT-SAFE AND PURE. The screen is a client component; the loaders have
 * already run. This composes their output into cards and is unit-tested
 * without a database — see __tests__/player-finder-moves.test.ts.
 *
 * Three kinds of move, each from a different measured fact:
 *
 *   bad   — he is on the BENCH and out-projects a starter he is eligible to
 *           replace, under that league's own scoring (`impact.startOver`).
 *   warn  — he sits in an IR SLOT and is not ruled out. An IR-slot player
 *           scores nothing, so the whole projection is the delta.
 *   good  — a free agent at his position out-projects him in a league where
 *           he is on your roster (`recommendedMoves`). ⚠ STANDARD scoring —
 *           the engine prices the open pool against the one feed — and the
 *           card says so, because the two above are league-scored.
 *
 * A benched player whose start-over delta is zero or negative gets NO card: the
 * bench is the right call, and saying so is the table's job, not this list's.
 */

export type MoveTone = 'bad' | 'warn' | 'good'

export type PlayerMove = {
  key: string
  leagueId: string
  tone: MoveTone
  title: string
  /** "Sleeper › Dynasty Dragons › Lineup" */
  path: string
  note: string | null
  /** Points gained by making the move. Null when it could not be priced. */
  delta: number | null
  scoring: 'league' | 'standard'
  link: PlatformLink | null
  /**
   * Why the move cannot be made right now — "locked — Ferguson’s game kicked
   * off Sun 1:00p ET" — read from the week's kickoffs (swapLegality.ts). Null
   * when it can, or when no kickoffs were passed. A locked move keeps its
   * place in the list and loses its button.
   */
  locked: string | null
}

/**
 * The readiness chip beside the player's name.
 *
 * ⚠ NO CHIP WITHOUT A ROW. A missing injury report is "we hold nothing", which
 * is not "healthy" — the injury section says so in words, and painting READY
 * on it would be a claim we cannot back.
 */
export function readiness(
  status: string | null | undefined,
  hasReport: boolean,
): { tone: MoveTone; label: string } | null {
  if (!hasReport) return null
  if (isRuledOut(status)) return { tone: 'bad', label: (status ?? 'OUT').trim() }
  if (isHealthyDesignation(status)) return { tone: 'good', label: 'Ready' }
  return { tone: 'warn', label: (status ?? '').trim() || 'Flagged' }
}

function lastName(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] ?? name
}

function fmt(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`
}

const TONE_RANK: Record<MoveTone, number> = { bad: 0, warn: 1, good: 2 }

export function composePlayerMoves(args: {
  playerName: string
  /** His own designation, from the detail loader — null when we hold none. */
  injuryStatus: string | null
  impact: LeagueImpact[]
  freeAgents: RecommendedMove[]
  /**
   * Game-day legality (2026-09-06): the week's kickoffs by club, the clock,
   * and his club. Without them every move reads as makeable — the old
   * behaviour, and the right one when no schedule is on file.
   */
  kickoffs?: Kickoffs
  nowIso?: string | null
  playerTeam?: string | null
  /** His club is not playing this week (a bye, or absent from the schedule): never recommend him INTO a lineup. */
  notPlaying?: boolean
}): PlayerMove[] {
  const { playerName, injuryStatus, impact, freeAgents } = args
  const last = lastName(playerName)
  const out: PlayerMove[] = []
  const kickoffs = args.kickoffs ?? {}
  const nowIso = args.nowIso ?? null
  const lockOf = (name: string, team: string | null | undefined): string | null =>
    nowIso ? moveLegality({ name, team, kickoffs, nowIso }).reason : null
  const swapLockOf = (outName: string, outTeam: string | null | undefined): string | null =>
    nowIso ? swapLegality({ out: { name: outName, team: outTeam }, in: { name: playerName, team: args.playerTeam }, kickoffs, nowIso }).reason : null

  for (const im of impact) {
    if (im.isStarting) continue
    const league = {
      id: im.leagueId,
      platform: im.platform,
      platformLeagueId: im.platformLeagueId,
      season: im.season,
      name: im.leagueName,
      teamId: im.teamExternalId,
    }

    if (im.slot === 'IR SLOT') {
      /*
       * Only when he is NOT ruled out. A player genuinely on IR belongs in the
       * IR slot, and "move him off" would be the wrong advice. Without a report
       * at all we cannot tell, so no card — the table still shows the slot.
       */
      if (!injuryStatus || isRuledOut(injuryStatus)) continue
      const locked = lockOf(playerName, args.playerTeam)
      out.push({
        key: `ir:${im.leagueId}`,
        leagueId: im.leagueId,
        tone: 'warn',
        title: `Move ${last} off IR — he's ${isHealthyDesignation(injuryStatus) ? 'active' : injuryStatus.trim().toLowerCase()}`,
        path: movePath(league, 'Roster'),
        note: [locked, 'an IR-slot player scores nothing'].filter(Boolean).join(' · '),
        delta: im.afPoints.available ? im.afPoints.data.points : null,
        scoring: 'league',
        link: lineupLink(league),
        locked,
      })
      continue
    }

    const so = im.startOver
    // A player with no game this week scores nothing; a projection that says otherwise is stale, not a reason to start him.
    if (so && so.delta > 0 && !args.notPlaying) {
      // Both sides must be unlocked: the starter he displaces AND himself.
      const locked = swapLockOf(so.name, so.team)
      out.push({
        key: `start:${im.leagueId}`,
        leagueId: im.leagueId,
        tone: 'bad',
        title: `Swap ${lastName(so.name)} out for ${last}${so.slot ? ` at ${so.slot.replace(/_/g, ' ')}` : ''}`,
        path: movePath(league, 'Lineup'),
        note: [locked, im.slotConfirmed ? null : 'slot unconfirmed — legal somewhere in this lineup'].filter(Boolean).join(' · ') || null,
        delta: so.delta,
        scoring: 'league',
        link: lineupLink(league),
        locked,
      })
    }
  }

  for (const mv of freeAgents) {
    const fa = mv.freeAgents[0]
    if (!fa || fa.delta == null || fa.delta <= 0) continue
    const league = { id: mv.leagueId, platform: mv.platform, name: mv.leagueName }
    // The engine already resolved where the claim happens; keep its answer.
    const link: PlatformLink | null =
      mv.claimTarget.kind === 'provider'
        ? {
            href: mv.claimTarget.url,
            label: `Open in ${mv.claimTarget.provider === 'sleeper' ? 'Sleeper' : mv.claimTarget.provider}`,
            platformLabel: mv.claimTarget.provider === 'sleeper' ? 'Sleeper' : mv.claimTarget.provider,
            screen: 'Players',
            external: true,
          }
        : mv.claimTarget.kind === 'native'
          ? { href: mv.claimTarget.url, label: 'Open in AllFantasy', platformLabel: 'AllFantasy', screen: 'Waivers', external: false }
          : claimLink(league)
    // His OWN kickoff: a free agent whose game has started cannot come into a
    // lineup now, whatever the claim page allows. A candidate with no club on
    // file is not called locked — an unknown club is not a lock (swapLegality.ts).
    const locked = lockOf(fa.name, fa.team ?? null)
    out.push({
      key: `claim:${mv.leagueId}:${fa.playerId}`,
      leagueId: mv.leagueId,
      tone: 'good',
      title: `Claim ${fa.name} over ${last}`,
      path: movePath(league, 'Waivers'),
      note: [locked, fa.position, 'unrostered', mv.projectionWeek != null ? `week ${mv.projectionWeek}` : null, 'standard scoring']
        .filter(Boolean)
        .join(' · '),
      delta: fa.delta,
      scoring: 'standard',
      link,
      locked,
    })
  }

  /*
   * Makeable first; then urgent, then by size. A lineup that is wrong today
   * outranks a waiver claim that can wait until Tuesday, whatever the numbers
   * say — but a move the platform will refuse right now goes to the bottom
   * whatever its tone, and keeps its reason.
   */
  return out.sort((a, b) => {
    if (Boolean(a.locked) !== Boolean(b.locked)) return a.locked ? 1 : -1
    if (TONE_RANK[a.tone] !== TONE_RANK[b.tone]) return TONE_RANK[a.tone] - TONE_RANK[b.tone]
    return (b.delta ?? -Infinity) - (a.delta ?? -Infinity)
  })
}

/** "+13.0" over every league-scored fix, or null when none of them could be priced. */
export function fixesTotal(moves: PlayerMove[]): number | null {
  const priced = moves.filter((m) => m.tone !== 'good' && m.delta != null)
  if (priced.length === 0) return null
  return Math.round(priced.reduce((s, m) => s + (m.delta ?? 0), 0) * 100) / 100
}

export { fmt as formatDelta }
