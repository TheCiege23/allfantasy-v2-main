import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadNativeFuturePicks } from '@/lib/league-trade-engine/nativeFuturePicks'

import { LINEUP_INTEGRITY_ALGORITHM, scoreLineupWeek, type ScoredWeek, type WeekScore } from './lineupIntegrityScore'
import { readLineupLockSnapshots, writeLineupScore, type LineupLockSnapshotRow } from './lineupLockSnapshots'
import type { LineupCard } from './nativeLineupCards'

/**
 * Week close: score every team's lineup against its kickoff snapshot, store the score on the snapshot
 * row, and hand the tanking scan each team's season of scores. Called from `scanWeekForTanking`.
 *
 * The starters are the week's SAVED lineup (`loadNativeLineupCards`), the same record matchup scoring
 * and the tanking scan read — so the score, the matchup and the flag all agree on who started.
 */

export type TeamLineupScores = {
  thisWeek: WeekScore | null
  /** Every week this season with a snapshot, ascending. `ratio` null when not scored. */
  weeks: Array<{ week: number; ratio: number | null; startedTopCount: number | null; starterCount: number | null; skipReason: string | null }>
  /** The kickoff snapshot for this week, for the card's projections. */
  snapshot: LineupLockSnapshotRow | null
}

export async function scoreLineupIntegrityWeek(args: {
  leagueId: string
  season: number
  week: number
  cards: ReadonlyMap<string, LineupCard>
}): Promise<Map<string, TeamLineupScores>> {
  const out = new Map<string, TeamLineupScores>()
  const rows = await readLineupLockSnapshots({ leagueId: args.leagueId, season: args.season }).catch(() => [] as LineupLockSnapshotRow[])
  if (rows.length === 0) return out

  const byRoster = new Map<string, LineupLockSnapshotRow[]>()
  for (const r of rows) byRoster.set(r.rosterId, [...(byRoster.get(r.rosterId) ?? []), r])

  for (const [rosterId, list] of byRoster) {
    const snapshot = list.find((r) => r.week === args.week) ?? null
    let thisWeek: WeekScore | null = null
    if (snapshot) {
      const card = args.cards.get(rosterId)
      thisWeek = scoreLineupWeek({
        week: args.week,
        players: snapshot.players,
        slots: snapshot.slots,
        starterIds: card ? card.starters.map((s) => s.playerId) : [],
      })
      await writeLineupScore({ leagueId: args.leagueId, rosterId, season: args.season, week: args.week, score: thisWeek, algorithmVersion: LINEUP_INTEGRITY_ALGORITHM }).catch((e) =>
        console.warn('[lineup-integrity] score write failed', { leagueId: args.leagueId, rosterId, week: args.week, error: String(e) }),
      )
    }
    const weeks = list.map((r) =>
      r.week === args.week && thisWeek
        ? thisWeek.scored
          ? { week: r.week, ratio: thisWeek.ratio, startedTopCount: thisWeek.startedTopCount, starterCount: thisWeek.starterCount, skipReason: null }
          : { week: r.week, ratio: null, startedTopCount: null, starterCount: null, skipReason: thisWeek.skipReason }
        : { week: r.week, ratio: r.ratio, startedTopCount: r.startedTopCount, starterCount: r.starterCount, skipReason: r.skipReason },
    )
    // A week later than the one being closed has not finished: it is not evidence yet.
    out.set(rosterId, { thisWeek, weeks: weeks.filter((w) => w.week <= args.week), snapshot })
  }
  return out
}

export function scoredWeeks(t: TeamLineupScores): ScoredWeek[] {
  return t.weeks.map((w) => ({ week: w.week, ratio: w.ratio }))
}

/**
 * Does each team own its OWN first-round pick in the next draft? Keyed by RedraftRoster id (the flag
 * id space). Picks live on `Roster.id`, linked through `Roster.redraftRosterId`.
 *
 * Empty when the league has no tradeable picks (redraft, or an imported league): no claim either way,
 * and the card says nothing about picks.
 */
export async function ownFirstRoundPicks(leagueId: string): Promise<{ season: number | null; owns: Map<string, boolean> }> {
  const inventory = await loadNativeFuturePicks(leagueId).catch(() => null)
  if (!inventory || inventory.seasons.length === 0) return { season: null, owns: new Map() }
  const season = Math.min(...inventory.seasons)
  const links = await prisma.roster.findMany({ where: { leagueId, redraftRosterId: { not: null } }, select: { id: true, redraftRosterId: true } })
  const owns = new Map<string, boolean>()
  for (const link of links) {
    const own = inventory.picks.find((p) => p.season === season && p.round === 1 && p.originalTeamId === link.id)
    // A pick forfeited as a penalty is gone from the inventory: the team does not hold it either.
    owns.set(link.redraftRosterId!, own != null && own.ownerTeamId === link.id)
  }
  return { season, owns }
}
