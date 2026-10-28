/**
 * The invariants every simulated redraft season must hold, whatever the sport or size. Each one is its
 * own `it`, so a failure names the rule that broke. Used with `./redraftFullSeasonHarness`.
 *
 * The expected values are computed HERE from the persisted rows (matchup scores, bye rows), never read
 * back from the engine under test: records, the median, the seed order and the playoff field are each
 * re-derived and compared.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { derivePlayoffTeams } from '@/lib/league-concepts/redraftDefaults'
import { consolationPlaysForSetsDraftOrder } from '@/lib/playoff-runtime/consolationPlaysFor'
import { readExtraMatchupRecord } from '@/lib/redraft/oddTeamExtraMatchupRules'
import { readMedianGameInPlayoffs } from '@/lib/redraft/medianGame'
import { inMemoryPrisma } from './inMemoryPrisma'
import { runRedraftFullSeasonSimulation, type FullSeasonSimInput, type FullSeasonSimResult } from './redraftFullSeasonHarness'

type Row = Record<string, any>

export type RecordLine = { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; games: number }

const final = (r: Row) => r.status === 'final' || r.status === 'completed'
const round2 = (n: number) => Math.round(n * 100) / 100

/** Records through `week`, from the rows alone: head-to-head, the extra matchup, the league median. */
export function expectedRecords(sim: FullSeasonSimResult, rows: Row[], week: number): Map<string, RecordLine> {
  const out = new Map<string, RecordLine>(sim.rosterIds.map((id) => [id, { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, games: 0 }]))
  const tally = (id: string, mine: number, theirs: number, pf = true) => {
    const row = out.get(id)!
    row.games += 1
    if (mine > theirs) row.wins += 1
    else if (mine < theirs) row.losses += 1
    else row.ties += 1
    if (pf) {
      row.pointsFor += mine
      row.pointsAgainst += theirs
    }
  }
  const upTo = rows.filter((r) => r.week <= week)
  for (const g of upTo) {
    if (!g.awayRosterId || !final(g)) continue
    tally(g.homeRosterId, g.homeScore, g.awayScore)
    tally(g.awayRosterId, g.awayScore, g.homeScore)
  }
  for (const bye of upTo) {
    if (bye.awayRosterId || !final(bye)) continue
    const pick = readExtraMatchupRecord(bye.lineupSnapshots)
    if (!pick) continue
    const game = upTo.find((r) => r.week === bye.week && r.awayRosterId && (r.homeRosterId === pick.opponentRosterId || r.awayRosterId === pick.opponentRosterId))
    if (!game || !final(game)) continue
    const theirs = game.homeRosterId === pick.opponentRosterId ? game.homeScore : game.awayScore
    tally(bye.homeRosterId, bye.homeScore, theirs)
    if (pick.scoring === 'both') tally(pick.opponentRosterId, theirs, bye.homeScore, false)
  }
  // A plain bye (no extra matchup) earns the week's median head-to-head score as points for, once every
  // game of that regular-season week is final; no result, no points against.
  for (let w = 1; w <= Math.min(week, sim.regularSeasonWeeks); w++) {
    const weekRows = upTo.filter((r) => r.week === w && !r.isMedianMatchup)
    const games = weekRows.filter((r) => r.awayRosterId)
    if (!games.length || !games.every(final)) continue
    const sorted = games.flatMap((g) => [g.homeScore, g.awayScore]).sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
    for (const bye of weekRows.filter((r) => !r.awayRosterId && !readExtraMatchupRecord(r.lineupSnapshots))) {
      out.get(bye.homeRosterId)!.pointsFor += round2(median)
    }
  }
  if (sim.input.medianGame) {
    for (let w = 1; w <= Math.min(week, sim.regularSeasonWeeks); w++) {
      const weekRows = upTo.filter((r) => r.week === w)
      const games = weekRows.filter((r) => r.awayRosterId)
      if (!games.length || !games.every(final)) continue
      const scores = new Map<string, number>()
      for (const g of games) {
        scores.set(g.homeRosterId, g.homeScore)
        scores.set(g.awayRosterId, g.awayScore)
      }
      for (const bye of weekRows.filter((r) => !r.awayRosterId && final(r))) scores.set(bye.homeRosterId, bye.homeScore)
      const sorted = [...scores.values()].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
      for (const [id, score] of scores) tally(id, score, median, false)
    }
  }
  for (const row of out.values()) {
    row.pointsFor = round2(row.pointsFor)
    row.pointsAgainst = round2(row.pointsAgainst)
  }
  return out
}

/** Head-to-head record of `a` against `b` in completed regular-season games. */
function headToHead(rows: Row[], a: string, b: string): number {
  let net = 0
  for (const g of rows) {
    if (!g.awayRosterId || !final(g)) continue
    const pair = new Set([g.homeRosterId, g.awayRosterId])
    if (!pair.has(a) || !pair.has(b)) continue
    const aScore = g.homeRosterId === a ? g.homeScore : g.awayScore
    const bScore = g.homeRosterId === a ? g.awayScore : g.homeScore
    net += aScore > bScore ? 1 : aScore < bScore ? -1 : 0
  }
  return net
}

/**
 * The seed order the league's configured tiebreakers produce: record (win %, a tie half a win) first,
 * then `standings_tiebreakers` in order. Returns null where the reference itself cannot separate two
 * adjacent teams, so the comparison is made only on orders the rules decide.
 */
export function referenceSeedOrder(sim: FullSeasonSimResult, records: Map<string, RecordLine>, rows: Row[]): string[] {
  const tiebreakers: string[] = (sim.league.settings?.standings_tiebreakers ?? []).filter((k: string) => k !== 'win_pct')
  const pct = (id: string) => {
    const r = records.get(id)!
    return r.games ? (r.wins + r.ties / 2) / r.games : 0
  }
  const cmp = (a: string, b: string): number => {
    const d = pct(b) - pct(a)
    if (Math.abs(d) > 1e-12) return d
    for (const key of tiebreakers) {
      if (key === 'points_for') {
        const v = records.get(b)!.pointsFor - records.get(a)!.pointsFor
        if (Math.abs(v) > 1e-9) return v
      } else if (key === 'points_against') {
        const v = records.get(a)!.pointsAgainst - records.get(b)!.pointsAgainst
        if (Math.abs(v) > 1e-9) return v
      } else if (key === 'head_to_head') {
        const v = headToHead(rows, b, a)
        if (v !== 0) return v
      }
    }
    return 0
  }
  return [...sim.rosterIds].sort((a, b) => cmp(a, b) || a.localeCompare(b))
}

export function describeFullSeason(label: string, input: FullSeasonSimInput, opts: { timeoutMs?: number } = {}) {
  describe(label, () => {
    let sim: FullSeasonSimResult
    const n = input.teamCount
    const odd = n % 2 === 1

    beforeAll(async () => {
      sim = await runRedraftFullSeasonSimulation(inMemoryPrisma, input)
    }, opts.timeoutMs ?? 300_000)

    it('drafts a snake: every team fills every round, no player twice, even rounds reversed', () => {
      const { picks, rounds } = sim.draft
      expect(picks).toHaveLength(rounds * n)
      expect(new Set(picks.map((p) => p.playerId)).size).toBe(picks.length)
      for (const id of sim.rosterIds) expect(picks.filter((p) => p.rosterId === id)).toHaveLength(rounds)
      for (const pick of picks) {
        const inRound = ((pick.overall - 1) % n) + 1
        expect(pick.slot).toBe(pick.round % 2 === 1 ? inRound : n + 1 - inRound)
      }
    })

    it('schedules every team exactly once a week, with one bye a week only in an odd league', () => {
      const regular = sim.schedule.filter((r) => r.week <= sim.regularSeasonWeeks)
      expect(sim.schedule.every((r) => r.week <= sim.regularSeasonWeeks)).toBe(true)
      const byeCounts = new Map(sim.rosterIds.map((id) => [id, 0]))
      for (let w = 1; w <= sim.regularSeasonWeeks; w++) {
        const rows = regular.filter((r) => r.week === w)
        const seen = rows.flatMap((r) => [r.homeRosterId, r.awayRosterId].filter(Boolean))
        expect(seen.sort()).toEqual([...sim.rosterIds].sort())
        expect(rows.every((r) => r.homeRosterId !== r.awayRosterId)).toBe(true)
        const byes = rows.filter((r) => !r.awayRosterId)
        expect(byes).toHaveLength(odd ? 1 : 0)
        for (const b of byes) byeCounts.set(b.homeRosterId, byeCounts.get(b.homeRosterId)! + 1)
      }
      const counts = [...byeCounts.values()]
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    })

    it('finalizes every head-to-head game every week, scored on exactly the started slots', () => {
      for (const week of sim.weeks) {
        const games = week.matchups.filter((m) => m.awayRosterId)
        expect(games.length).toBe(Math.floor(n / 2))
        expect(games.every((m) => m.status === 'final')).toBe(true)
        for (const check of week.scoreChecks) expect({ week: week.week, ...check, engine: check.engine }).toEqual({ week: week.week, ...check, engine: check.expected })
      }
    })

    it('every team scores points every week (an all-zero season would match its expected zeros)', () => {
      for (const week of sim.weeks) {
        for (const check of week.scoreChecks) expect({ week: week.week, rosterId: check.rosterId, scored: check.engine > 0 }).toEqual({ week: week.week, rosterId: check.rosterId, scored: true })
      }
    })

    it('scores the bye team only when its week counts (league median or the extra matchup)', () => {
      const byeRowsCount = sim.input.medianGame || Boolean(sim.input.extraMatchup?.enabled)
      for (const week of sim.weeks) {
        for (const bye of week.matchups.filter((m) => !m.awayRosterId)) {
          if (byeRowsCount) {
            expect(bye.status).toBe('final')
            expect(bye.homeScore).toBeGreaterThan(0)
          } else {
            expect(bye.status).toBe('scheduled')
          }
          if (sim.input.extraMatchup?.enabled) expect(readExtraMatchupRecord(bye.lineupSnapshots)).not.toBeNull()
        }
      }
    })

    it('keeps records consistent with the games every week: W-L-T, games played, points', () => {
      for (const week of sim.weeks) {
        const rows = sim.weeks.filter((w) => w.week <= week.week).flatMap((w) => w.matchups)
        const expected = expectedRecords(sim, rows, week.week)
        for (const roster of week.standings) {
          const want = expected.get(roster.id)!
          expect({ week: week.week, id: roster.id, wins: roster.wins, losses: roster.losses, ties: roster.ties }).toEqual({
            week: week.week,
            id: roster.id,
            wins: want.wins,
            losses: want.losses,
            ties: want.ties,
          })
          expect({ week: week.week, id: roster.id, pf: round2(roster.pointsFor) }).toEqual({ week: week.week, id: roster.id, pf: want.pointsFor })
        }
        // Games played, counted off the schedule alone: a head-to-head game every non-bye week, a
        // median game every week (the bye team's too), the extra game every bye week.
        for (const roster of week.standings) {
          const mine = rows.filter((r) => r.homeRosterId === roster.id || r.awayRosterId === roster.id)
          const byeWeeks = mine.filter((r) => !r.awayRosterId).length
          const chosenForBoth =
            sim.input.extraMatchup?.scoring === 'both'
              ? rows.filter((r) => !r.awayRosterId && readExtraMatchupRecord(r.lineupSnapshots)?.opponentRosterId === roster.id).length
              : 0
          const games =
            mine.length -
            byeWeeks +
            (sim.input.medianGame ? week.week : 0) +
            (sim.input.extraMatchup?.enabled ? byeWeeks : 0) +
            chosenForBoth
          expect({ week: week.week, id: roster.id, games: roster.wins + roster.losses + roster.ties }).toEqual({ week: week.week, id: roster.id, games })
        }
      }
    })

    it('ranks the standings by the configured tiebreakers', () => {
      const rows = sim.weeks.flatMap((w) => w.matchups)
      const records = expectedRecords(sim, rows, sim.regularSeasonWeeks)
      const reference = referenceSeedOrder(sim, records, rows)
      const bySeed = [...sim.regularSeasonFinal].sort((a, b) => a.playoffSeed - b.playoffSeed).map((r) => r.id)
      const show = (ids: string[]) => ids.map((id) => ({ id, ...records.get(id)! }))
      expect(show(bySeed)).toEqual(show(reference))
    })

    it('shows the schedule tab the same records and order as the standings', () => {
      expect(sim.scheduleRuntime.ok).toBe(true)
      if (!sim.scheduleRuntime.ok) return
      const engine = [...sim.regularSeasonFinal].sort((a, b) => a.playoffSeed - b.playoffSeed)
      const schedule = sim.scheduleRuntime.state.standings
      const line = (r: Row) => `${r.rosterId ?? r.id} ${r.wins}-${r.losses}-${r.ties}`
      expect(schedule.map(line)).toEqual(engine.map(line))
      // Its playoff picture names the field the bracket seats.
      const picture = sim.scheduleRuntime.state.playoffQualificationSnapshot
      expect(picture.qualificationLocked).toBe(true)
      expect(picture.seeds.map((s) => s.rosterId)).toEqual(sim.bracket.generated.state.seeds.map((s) => s.rosterId))
    })

    it('seats the playoff field the size rule names (4 under ten teams, 6 from ten), from the top of the standings', () => {
      const want = Math.min(derivePlayoffTeams(n), n)
      expect(want).toBe(n >= 10 ? 6 : 4)
      expect(sim.shape.playoffTeams).toBe(want)
      const seeds = sim.bracket.generated.state.seeds
      expect(seeds).toHaveLength(want)
      const standingsTop = [...sim.regularSeasonFinal].sort((a, b) => a.playoffSeed - b.playoffSeed).slice(0, want).map((r) => r.id)
      expect(seeds.map((s) => s.rosterId)).toEqual(standingsTop)
      expect(seeds.map((s) => s.seed)).toEqual(Array.from({ length: want }, (_, i) => i + 1))
    })

    it('locks the seeds at the playoff start: a late regular-season correction moves records, never seeds', () => {
      const seeds = new Map(sim.bracket.seedsAtBracket.map((r) => [r.id, r.playoffSeed]))
      for (const id of sim.bracket.generated.state.seeds.map((s) => s.rosterId)) expect(seeds.get(id)).not.toBeNull()
      expect(sim.bracket.correction).not.toBeNull()
      for (const week of sim.playoffWeekStandings) {
        for (const roster of week.rosters) expect({ week: week.week, id: roster.id, seed: roster.playoffSeed }).toEqual({ week: week.week, id: roster.id, seed: seeds.get(roster.id) })
      }
      // The correction did land in the records.
      const before = sim.regularSeasonFinal
      const after = sim.playoffWeekStandings[0]!.rosters
      const changed = after.filter((r) => {
        const b = before.find((x) => x.id === r.id)!
        return b.wins !== r.wins || b.losses !== r.losses
      })
      expect(changed.length).toBeGreaterThanOrEqual(2)
    })

    it('plays no league-median game in the playoffs', () => {
      // Off by default: a new league never stores `median_game_in_playoffs`.
      expect(readMedianGameInPlayoffs(sim.league.settings)).toBe(false)
      const games = (rows: Row[]) => rows.reduce((s, r) => s + r.wins + r.losses + r.ties, 0)
      const atStart = games(sim.playoffWeekStandings[0]!.rosters)
      for (const week of sim.playoffWeekStandings) {
        expect(games(week.rosters)).toBe(atStart)
        expect(week.matchups.every((m) => m.medianScore == null)).toBe(true)
      }
      expect(sim.regularSeasonFinal.reduce((s, r) => s + r.wins + r.losses + r.ties, 0)).toBe(atStart)
    })

    it('plays the third-place game, and the lower bracket only where the sport has one', () => {
      const matchups = sim.bracket.matchupsAtEnd
      const third = matchups.filter((m) => m.metadata?.bracketType === 'third_place')
      expect(third).toHaveLength(1)
      expect(third[0]!.status).toBe('final')
      expect(third[0]!.winnerRosterId).toBeTruthy()
      const lowerRounds = sim.bracket.roundsAtEnd.filter((r) => r.roundNumber >= 100)
      const lowerOn = Boolean(sim.league.settings?.playoff_structure?.consolation_bracket_enabled)
      if (!lowerOn || n - sim.shape.playoffTeams < 2) expect(lowerRounds).toHaveLength(0)
      else {
        expect(lowerRounds.length).toBeGreaterThan(0)
        expect(lowerRounds.every((r) => r.status === 'completed')).toBe(true)
      }
      expect(sim.bracket.roundsAtEnd.every((r) => r.status === 'completed')).toBe(true)
    })

    it('plays the final in the season\'s last week(s), the championship length included', () => {
      const finalRound = Math.max(...sim.bracket.roundsAtEnd.filter((r) => r.roundNumber < 100).map((r) => r.roundNumber))
      const finalRoundId = sim.bracket.roundsAtEnd.find((r) => r.roundNumber === finalRound)!.id
      const championship = sim.bracket.matchupsAtEnd.find((m) => m.roundId === finalRoundId && m.metadata?.bracketType !== 'third_place')!
      const length = Number(sim.league.settings?.playoff_structure?.championship_length ?? 1)
      expect(championship.metadata.scoredWeeks).toEqual(Array.from({ length }, (_, i) => sim.shape.seasonWeeks - length + 1 + i))
    })

    it('crowns exactly one champion — the final\'s winner — and finishes every team once', () => {
      expect(sim.finalized.ok).toBe(true)
      if (!sim.finalized.ok) return
      const standings = sim.finalized.finalStandings
      expect(standings.filter((r) => r.champion)).toHaveLength(1)
      expect(standings.find((r) => r.champion)!.rosterId).toBe(sim.finalized.championRosterId)
      const finalRound = Math.max(...sim.bracket.roundsAtEnd.filter((r) => r.roundNumber < 100).map((r) => r.roundNumber))
      const finalRoundId = sim.bracket.roundsAtEnd.find((r) => r.roundNumber === finalRound)!.id
      const championship = sim.bracket.matchupsAtEnd.find((m) => m.roundId === finalRoundId && m.metadata?.bracketType !== 'third_place')!
      expect(championship.winnerRosterId).toBe(sim.finalized.championRosterId)
      expect(new Set(standings.map((r) => r.rosterId)).size).toBe(n)
      expect(standings.map((r) => r.finish).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1))
      expect(sim.seasonAtEnd.status).toBe('complete')
    })

    it('settles each waiver run: the higher bid wins, the loser is denied, no player is on two rosters', () => {
      for (const week of sim.weeks.filter((w) => w.week >= 2)) {
        expect(week.waiverResults.filter((r) => r.status === 'approved')).toHaveLength(1)
        expect(week.waiverResults.filter((r) => r.status === 'denied')).toHaveLength(1)
        const approved = week.waiverClaims.find((c) => c.id === week.waiverResults.find((r) => r.status === 'approved')!.claimId)!
        expect(approved.bidAmount).toBe(7)
      }
      // The season's own rosters (the rollover empties only next season's).
      const active = inMemoryPrisma.table('redraftRosterPlayer').filter((r) => r.droppedAt == null && sim.rosterIds.includes(r.rosterId))
      const lastClaims = sim.weeks.at(-1)!.waiverClaims
      expect(lastClaims.filter((c) => c.status === 'approved')).toHaveLength(sim.regularSeasonWeeks - 1)
      expect(new Set(active.map((r) => r.playerId)).size).toBe(active.length)
    })

    it('rolls over to a fresh season: next year, empty rosters, zero records, a new draft order', async () => {
      expect(sim.renewal.ok).toBe(true)
      if (!sim.renewal.ok) return
      expect(sim.renewal.season).toBe(sim.seasonYear + 1)
      const renewal = sim.renewal
      const next = inMemoryPrisma.table('redraftSeason').find((r) => r.id === renewal.seasonId)!
      expect(next.status).toBe('setup')
      const rosters = inMemoryPrisma.table('redraftRoster').filter((r) => r.seasonId === next.id)
      expect(rosters).toHaveLength(n)
      for (const r of rosters) {
        expect([r.wins, r.losses, r.ties, r.pointsFor, r.playoffSeed ?? null, r.isEliminated]).toEqual([0, 0, 0, 0, null, false])
        expect(inMemoryPrisma.table('redraftRosterPlayer').filter((p) => p.rosterId === r.id)).toHaveLength(0)
      }
      const nextSchedule = inMemoryPrisma.table('redraftMatchup').filter((r) => r.seasonId === next.id)
      expect(nextSchedule.length).toBeGreaterThan(0)
      // Redraft: no draft order is carried from last season — the new one is drawn, not inherited.
      expect(sim.renewal.orderMode).toBe('random')
      expect(consolationPlaysForSetsDraftOrder(sim.league.settings, sim.input.sport, null, { leagueType: 'redraft', isDynasty: false })).toBe(false)
      const order = sim.renewal.slotOrder.map((s) => s.rosterId)
      expect([...order].sort()).toEqual(sim.previousDraftSlotOrder.map((s) => s.rosterId).sort())
      const sessions = inMemoryPrisma.table('draftSession').filter((s) => s.leagueId === sim.leagueId)
      expect(sessions).toHaveLength(2)
      const fresh = sessions.find((s) => s.id === renewal.sessionId)!
      expect(fresh.status).not.toBe('completed')
      expect((fresh.slotOrder as Row[]).map((s) => s.rosterId)).toEqual(order)
    })
  })
}
