import { describe, expect, it, vi } from 'vitest'
import { assembleWindowFacts, type WindowFactsPort, type WindowFactsScope } from '@/lib/decision-os/value-v2/windowFacts'
import { allPlayAsOfWeek } from '@/lib/decision-os/value-v2/windowFactsPrismaPort'
import {
  DEFAULT_WINDOW_COEFFICIENTS, REDRAFT_WINDOW_COEFFICIENTS, resolveCompetitiveWindow,
  type RedraftWindowFacts,
} from '@/lib/decision-os/value-v2/window'
import {
  resolveRedraftTeamWindow, resolveRequestingTeam,
  WINDOW_GAP_ARCHIVAL_UNPROVABLE, WINDOW_GAP_LEAGUE_READ_FAILED, WINDOW_GAP_ROSTER_READ_FAILED,
  WINDOW_GAP_SCHEDULE_READ_FAILED, WINDOW_GAP_TEAM_NOT_CLAIMED, WINDOW_GAP_TEAM_READ_FAILED,
  WINDOW_GAP_EVIDENCE_READ_FAILED, WINDOW_GAP_PROJECTION_READ_FAILED,
  WINDOW_GAP_MATCHUP_READ_FAILED, WINDOW_GAP_FORECAST_READ_FAILED, WINDOW_GAP_INJURY_READ_FAILED,
} from '@/lib/decision-os/value-v2/redraftWindowServerAdapter'
import { SCHEDULE_UNAVAILABLE_GAP } from '@/lib/decision-os/value-v2/windowDecision'

/**
 * The four corrections to the first consumer seam, each asserted at the level it was wrong at.
 */

const scope: WindowFactsScope = { leagueId: 'l1', teamId: 't1', season: 2026, week: 6 }

/** A port whose dynasty method EXPLODES, so "redraft never touches it" is proved rather than hoped. */
function redraftPort(over: Partial<WindowFactsPort> = {}): WindowFactsPort {
  return {
    identity: async () => ({ teamId: 't1', teamName: 'Anvil Chorus', managerName: 'Rae', rosterSize: 4 }),
    allPlay: async () => ({ wins: 4, losses: 2, ties: 0, luckWins: 0.5, weeksCounted: 6, pointsFor: 700 }),
    forecast: async () => ({ season: 2026, week: 6, playoffProbabilityPct: 78, generatedAt: '2026-10-06T12:00:00.000Z' }),
    dynasty: async () => { throw new Error('a redraft league must never read a dynasty projection') },
    restOfSeason: async () => ({
      share: 0.12, playersCovered: 4, rosterSize: 4, teamsCovered: 12,
      weeksRemaining: 11, source: 'AFProjectionSnapshot.rosProjection', generatedAt: '2026-10-06T12:00:00.000Z',
    }),
    injuries: async () => ({ unavailableShare: 0.1, basis: 'test', coverage: 1, treatment: 'excluded' }),
    ...over,
  }
}

// ── 1. SEPARATE LEAGUE-FORMAT HORIZONS ───────────────────────────────────────────────────────

describe('a redraft league is judged only on this season', () => {
  /*
   * 🛑 THE REQUIRED TEST, IN ITS STRONGEST FORM. Asserting "resolves without a dynasty row" would
   * pass even if the assembler still CALLED `port.dynasty` and merely tolerated a null. A port
   * whose dynasty method throws makes the call itself the failure, so a soft dependency cannot
   * creep back in unnoticed.
   */
  it('resolves with no dynasty projection at all — and never asks for one', async () => {
    const result = await assembleWindowFacts(scope, redraftPort(), { format: 'redraft' })
    expect(result.gaps).toEqual([])
    expect(result.facts).not.toBeNull()
    expect(result.facts!.format).toBe('redraft')
    expect(result.evidence.dynasty).toBeNull()
  })

  it('an EXTREME dynasty projection cannot change a redraft result', async () => {
    const dynastySpy = vi.fn(async () => ({
      season: 2026, projectedStrength3YearsPct: 100, projectedStrengthNextYearPct: 100,
      windowStartYear: 2026, windowEndYear: 2031, confidencePct: 99, generatedAt: '2026-10-06T12:00:00.000Z',
    }))
    const plain = await assembleWindowFacts(scope, redraftPort(), { format: 'redraft' })
    const loaded = await assembleWindowFacts(scope, redraftPort({ dynasty: dynastySpy }), { format: 'redraft' })

    expect(JSON.stringify(loaded.facts)).toBe(JSON.stringify(plain.facts))
    // The strongest statement available: it was not merely ignored, it was never read.
    expect(dynastySpy).not.toHaveBeenCalled()
  })

  it('redraft facts carry no three-year, five-year or pick-capital field at all', async () => {
    const { facts } = await assembleWindowFacts(scope, redraftPort(), { format: 'redraft' })
    const keys = Object.keys(facts!)
    for (const banned of ['rosterStrength3Year', 'projectedStrength5Years', 'futurePickCapital', 'pickTreatment']) {
      expect(keys).not.toContain(banned)
    }
  })

  it('refuses when the canonical rest-of-season source is unavailable', async () => {
    const { facts, gaps } = await assembleWindowFacts(
      scope, redraftPort({ restOfSeason: async () => null }), { format: 'redraft' },
    )
    expect(facts).toBeNull()
    expect(gaps).toContain('rest_of_season_projection_missing')
  })

  it('refuses thin projection coverage rather than summing what happens to exist', async () => {
    const { gaps } = await assembleWindowFacts(scope, redraftPort({
      restOfSeason: async () => ({
        share: 0.02, playersCovered: 1, rosterSize: 10, teamsCovered: 12,
        weeksRemaining: 11, source: 'AFProjectionSnapshot.rosProjection', generatedAt: null,
      }),
    }), { format: 'redraft' })
    expect(gaps).toContain('rest_of_season_coverage_below_floor')
  })

  it('a dynasty coefficient set cannot score redraft facts', () => {
    const facts: RedraftWindowFacts = {
      format: 'redraft', teamId: 't1', leagueId: 'l1', season: 2026, week: 6,
      wins: 4, losses: 2, ties: 0, luckWins: 0, playoffProbability: 0.78,
      restOfSeasonStrength: 0.12, leagueAverageShare: 1 / 12, remainingScheduleStrength: null,
      unavailableShare: 0.1, injuryTreatment: 'excluded',
    }
    expect(resolveCompetitiveWindow(facts, DEFAULT_WINDOW_COEFFICIENTS).gaps)
      .toContain('window_coefficients_wrong_horizon')
    expect(resolveCompetitiveWindow(facts, REDRAFT_WINDOW_COEFFICIENTS).status).not.toBeNull()
  })

  it('the two coefficient sets are versioned apart', () => {
    expect(REDRAFT_WINDOW_COEFFICIENTS.version).not.toBe(DEFAULT_WINDOW_COEFFICIENTS.version)
    expect(REDRAFT_WINDOW_COEFFICIENTS.horizon).toBe('redraft')
    expect(DEFAULT_WINDOW_COEFFICIENTS.horizon).toBe('dynasty')
  })

  it('optional strength of schedule is omittable without moving the answer', () => {
    const base: RedraftWindowFacts = {
      format: 'redraft', teamId: 't1', leagueId: 'l1', season: 2026, week: 6,
      wins: 4, losses: 2, ties: 0, luckWins: 0, playoffProbability: 0.78,
      restOfSeasonStrength: 0.12, leagueAverageShare: 1 / 12, remainingScheduleStrength: null,
      unavailableShare: 0.1, injuryTreatment: 'excluded',
    }
    const absent = resolveCompetitiveWindow(base, REDRAFT_WINDOW_COEFFICIENTS)
    const neutral = resolveCompetitiveWindow({ ...base, remainingScheduleStrength: 0.5 }, REDRAFT_WINDOW_COEFFICIENTS)
    expect(neutral.futureScore).toBeCloseTo(absent.futureScore!, 10)
  })
})

// ── 2. THE ORPHAN / ARCHIVE CORRECTION ───────────────────────────────────────────────────────

function teamPrisma(rows: Array<{ externalId: string; isOrphan: boolean | null }> | Error) {
  return {
    leagueTeam: {
      findMany: async () => {
        if (rows instanceof Error) throw rows
        return rows
      },
    },
  } as never
}

describe('team state, and what this schema can and cannot prove about it', () => {
  it('ACTIVE, HUMAN-MANAGED: a claimed seat resolves', async () => {
    expect(await resolveRequestingTeam(teamPrisma([{ externalId: '7', isOrphan: false }]), 'l1', 'u1'))
      .toEqual({ ok: true, externalId: '7' })
  })

  /*
   * A vacant seat is not this caller's team, so it is refused by the CLAIM check rather than by
   * any orphan reading — which is the point: `isOrphan` is not consulted to reach this answer.
   */
  it('ACTIVE, VACANT/CLAIMABLE: refused because nobody claimed it, not because it is "archived"', async () => {
    const r = await resolveRequestingTeam(teamPrisma([]), 'l1', 'u1')
    expect(r).toEqual({ ok: false, gap: WINDOW_GAP_TEAM_NOT_CLAIMED })
  })

  /*
   * ⚠ ELIMINATED IS NOT ARCHIVED, AND IT IS NOT VISIBLE HERE AT ALL. `LeagueTeam` carries no
   * elimination flag (`RedraftRoster.isEliminated` does, in a different model and id space), so an
   * eliminated team is indistinguishable from any other active one at this layer — and it SHOULD
   * resolve: a team knocked out of contention still has a real record and a real roster, which is
   * exactly the evidence a 'rebuilding' verdict is made of.
   */
  it('ELIMINATED: still resolves, because elimination is a standing, not a departure', async () => {
    expect(await resolveRequestingTeam(teamPrisma([{ externalId: '9', isOrphan: false }]), 'l1', 'u1'))
      .toEqual({ ok: true, externalId: '9' })
  })

  /*
   * 🛑 TRULY ARCHIVED/DEPARTED CANNOT BE EXPRESSED BY THIS SCHEMA. There is no `archived`,
   * `departed`, `deleted` or `status` column on `LeagueTeam`. This test pins that fact: a departed
   * team and an active one produce the SAME result, so nothing here can be relied on to exclude
   * one. That is the reason the shadow flag stays off until the Platform Import state-model
   * correction lands a distinct state — and if a column ever appears, this test fails and forces
   * the decision to be revisited rather than quietly inherited.
   */
  it('TRULY ARCHIVED: indistinguishable from active — the gap the shadow flag is waiting on', async () => {
    const active = await resolveRequestingTeam(teamPrisma([{ externalId: '3', isOrphan: false }]), 'l1', 'u1')
    const departed = await resolveRequestingTeam(teamPrisma([{ externalId: '3', isOrphan: null }]), 'l1', 'u1')
    expect(departed).toEqual(active)
  })

  it('a NULL isOrphan proceeds — the importer never decided, which is not a claim of vacancy', async () => {
    expect(await resolveRequestingTeam(teamPrisma([{ externalId: '7', isOrphan: null }]), 'l1', 'u1'))
      .toEqual({ ok: true, externalId: '7' })
  })

  it('claimed AND flagged vacant is a contradiction, and refuses by that name', async () => {
    expect(await resolveRequestingTeam(teamPrisma([{ externalId: '7', isOrphan: true }]), 'l1', 'u1'))
      .toEqual({ ok: false, gap: WINDOW_GAP_ARCHIVAL_UNPROVABLE })
  })
})

// ── 3. FAILURE PROVENANCE, ONE STAGE AT A TIME ───────────────────────────────────────────────

type Stage = 'league' | 'team' | 'schedule' | 'roster' | 'projection' | 'matchup' | 'forecast' | 'injury'

/** A prisma double where exactly ONE stage is made to throw. Everything else succeeds. */
function stagedPrisma(broken: Stage | null) {
  const boom = (s: Stage) => { if (broken === s) throw new Error(`${s} read down`) }
  return {
    league: { findUnique: async () => { boom('league'); return { platformLeagueId: 'p1' } } },
    leagueTeam: {
      findMany: async () => { boom('team'); return [{ externalId: '7', isOrphan: false }] },
      findFirst: async () => { boom('team'); return { externalId: '7', teamName: 'A', ownerName: 'R' } },
    },
    redraftMatchup: { findMany: async () => { boom('schedule'); return [{ week: 5 }, { week: 6 }] } },
    redraftRosterPlayer: {
      findMany: async (args: { where?: { roster?: unknown } }) => {
        // The league-wide read is part of the PROJECTION stage now that it is hoisted.
        if (args?.where?.roster) { boom('projection'); return [{ rosterId: 'r1', playerId: 'p1' }] }
        boom('roster')
        return [{ playerId: 'p1' }]
      },
    },
    aFProjectionSnapshot: { findMany: async () => { boom('projection'); return [] } },
    weeklyMatchup: { findMany: async () => { boom('matchup'); return [] } },
    seasonForecastSnapshot: { findFirst: async () => { boom('forecast'); return null } },
    dynastyProjectionSnapshot: { findFirst: async () => null },
    sportsPlayer: { findMany: async () => { boom('injury'); return [] } },
  } as never
}

const req = (prisma: unknown) => ({
  prisma, leagueId: 'l1', userId: 'u1', proposerRosterId: 'r1', seasonId: 's1',
  sport: 'NFL', season: 2026, week: 6,
}) as Parameters<typeof resolveRedraftTeamWindow>[0]

describe('a failed query is never reported as a successful absence — all SEVEN stages', () => {
  const cases: Array<[Stage, string]> = [
    ['league', WINDOW_GAP_LEAGUE_READ_FAILED],
    ['team', WINDOW_GAP_TEAM_READ_FAILED],
    ['schedule', WINDOW_GAP_SCHEDULE_READ_FAILED],
    ['roster', WINDOW_GAP_ROSTER_READ_FAILED],
    ['projection', WINDOW_GAP_PROJECTION_READ_FAILED],
    ['matchup', WINDOW_GAP_MATCHUP_READ_FAILED],
    ['forecast', WINDOW_GAP_FORECAST_READ_FAILED],
    ['injury', WINDOW_GAP_INJURY_READ_FAILED],
  ]

  /*
   * Each row is its own mutation control: exactly one stage is broken and the others are left
   * working, so a gap that fired for the wrong reason would name the wrong stage and fail here.
   */
  it.each(cases)('a broken %s read reports %s', async (stage, gap) => {
    const d = await resolveRedraftTeamWindow(req(stagedPrisma(stage)))
    expect(d.state).toBe('refused')
    expect(d.gaps).toContain(gap)
  })

  it('with nothing broken, none of the failure gaps appear', async () => {
    const d = await resolveRedraftTeamWindow(req(stagedPrisma(null)))
    for (const [, gap] of cases) expect(d.gaps).not.toContain(gap)
  })

  /*
   * 🛑 THE ONE THAT WAS ACTIVELY DANGEROUS. A failed schedule read used to produce an empty array,
   * which the resolver reads as "no schedule" and answers with its arithmetic fallback — so a
   * database outage came out as a confident statement about a league's calendar.
   */
  it('a FAILED schedule read never triggers the assumed-contiguous fallback', async () => {
    const d = await resolveRedraftTeamWindow(req(stagedPrisma('schedule')))
    expect(d.gaps).toContain(WINDOW_GAP_SCHEDULE_READ_FAILED)
    expect(d.gaps).not.toContain(SCHEDULE_UNAVAILABLE_GAP)
  })

  it('a SUCCESSFUL but empty schedule read is the only thing that may select that fallback', async () => {
    const prisma = stagedPrisma(null) as unknown as { redraftMatchup: { findMany: () => Promise<unknown[]> } }
    prisma.redraftMatchup.findMany = async () => []
    const d = await resolveRedraftTeamWindow(req(prisma))
    expect(d.gaps).not.toContain(WINDOW_GAP_SCHEDULE_READ_FAILED)
    expect(d.gaps).toContain(SCHEDULE_UNAVAILABLE_GAP)
  })
})

// ── 4. COMPLETED-MATCHUP MATH ────────────────────────────────────────────────────────────────

type Row = { rosterId: string; week: number; pointsFor: number; pointsAgainst: number; win: number | null }
const row = (rosterId: string, week: number, pf: number, pa: number, win: number | null): Row =>
  ({ rosterId, week, pointsFor: pf, pointsAgainst: pa, win })

describe('only completed, graded matchups count', () => {
  /*
   * 🛑 THE DEFECT: `win === 1 → win`, `win === 0 && pf !== pa → loss`, `else → TIE`. Every
   * in-progress week fell into that final `else` and was recorded as a drawn game. Ties enter
   * `played`, `played` is the denominator of the luck adjustment, so half a phantom win per
   * ungraded week dragged a contender toward the middle every Sunday.
   */
  it('an IN-PROGRESS week is not a tie and does not count', () => {
    const r = allPlayAsOfWeek([
      row('1', 1, 120, 100, 1), row('2', 1, 100, 120, 0),
      row('1', 2, 60, 55, null), row('2', 2, 55, 60, null),
    ], '1', 2)
    expect(r).not.toBeNull()
    expect(r!.ties).toBe(0)
    expect(r!.wins).toBe(1)
    expect(r!.weeksCounted).toBe(1)
  })

  it('a NULLABLE result is excluded even when the points would imply a winner', () => {
    const r = allPlayAsOfWeek([
      row('1', 1, 120, 100, 1), row('2', 1, 100, 120, 0),
      row('1', 2, 200, 10, null), row('2', 2, 10, 200, null),
    ], '1', 2)
    expect(r!.wins).toBe(1)
    expect(r!.losses).toBe(0)
    expect(r!.ties).toBe(0)
  })

  it('a GENUINE tie — graded, equal points — still counts as a tie', () => {
    const r = allPlayAsOfWeek([
      row('1', 1, 100, 100, 0), row('2', 1, 100, 100, 0),
    ], '1', 1)
    expect(r!.ties).toBe(1)
    expect(r!.losses).toBe(0)
    expect(r!.weeksCounted).toBe(1)
  })

  /*
   * ⚠ `weeksCounted` USED TO INCREMENT BEFORE THE ROW WAS FOUND, so a bye counted as a week this
   * team played on the strength of somebody else having scored.
   */
  it('a BYE — this team has no row that week — does not count as a played week', () => {
    const r = allPlayAsOfWeek([
      row('1', 1, 120, 100, 1), row('2', 1, 100, 120, 0),
      row('2', 2, 90, 80, 1), row('3', 2, 80, 90, 0),
    ], '1', 2)
    expect(r!.weeksCounted).toBe(1)
    expect(r!.wins + r!.losses + r!.ties).toBe(1)
  })

  it('a MISSING target-team row across every week resolves to null, not a zeroed record', () => {
    const r = allPlayAsOfWeek([row('2', 1, 90, 80, 1), row('3', 1, 80, 90, 0)], '1', 1)
    expect(r).toBeNull()
  })

  it('all-play ignores opponents who have not completed the week', () => {
    const graded = allPlayAsOfWeek([
      row('1', 1, 100, 90, 1), row('2', 1, 90, 100, 0), row('3', 1, 150, 140, 1), row('4', 1, 140, 150, 0),
    ], '1', 1)
    const halfPlayed = allPlayAsOfWeek([
      row('1', 1, 100, 90, 1), row('2', 1, 90, 100, 0), row('3', 1, 0, 0, null), row('4', 1, 0, 0, null),
    ], '1', 1)
    // Against two graded opponents team 1 beats one and loses to one; against none it beats none.
    expect(graded!.luckWins).not.toBe(halfPlayed!.luckWins)
  })
})

// ── 5. CLOUD-REVIEW CORRECTIONS ──────────────────────────────────────────────────────────────

/**
 * Findings from an automated adversarial review of the corrective batch. All five were real; the
 * three with behaviour worth pinning are below, each written so that reverting its fix turns this
 * suite red.
 */

/** A prisma double that RECORDS every call and HONOURS the droppedAt filter. */
function countingPrisma(over: { rosterRows?: Array<{ rosterId: string; playerId: string; dropped?: boolean }> } = {}) {
  const calls: string[] = []
  const rows = over.rosterRows ?? [
    { rosterId: 'r1', playerId: 'keep1' },
    { rosterId: 'r2', playerId: 'keep2' },
  ]
  const prisma = {
    league: { findUnique: async () => { calls.push('league'); return { platformLeagueId: 'p1' } } },
    leagueTeam: {
      findMany: async () => { calls.push('team'); return [{ externalId: '1', isOrphan: false }] },
      findFirst: async () => ({ externalId: '1', teamName: 'A', ownerName: 'R' }),
    },
    redraftMatchup: { findMany: async () => { calls.push('schedule'); return [{ week: 4 }, { week: 5 }, { week: 6 }] } },
    redraftRosterPlayer: {
      findMany: async (a: { where?: { roster?: unknown; droppedAt?: unknown } }) => {
        const leagueWide = !!a?.where?.roster
        calls.push(leagueWide ? 'ros:leagueWide' : 'ros:proposer')
        // The double HONOURS the filter, so a query that forgets it receives the dropped rows.
        const filtered = a?.where?.droppedAt === null ? rows.filter(r => !r.dropped) : rows
        return leagueWide ? filtered : filtered.map(r => ({ playerId: r.playerId }))
      },
    },
    aFProjectionSnapshot: {
      findMany: async () => {
        calls.push('projections')
        return rows.map(r => ({
          playerId: r.playerId,
          rosProjection: r.dropped ? 10000 : 100,
          rosWeeksRemaining: 11,
          computedAt: new Date('2026-10-01T00:00:00Z'),
        }))
      },
    },
    weeklyMatchup: { findMany: async () => [] },
    seasonForecastSnapshot: { findFirst: async () => null },
    dynastyProjectionSnapshot: { findFirst: async () => { calls.push('DYNASTY'); return null } },
    sportsPlayer: { findMany: async () => [] },
  }
  return { prisma: prisma as never, calls }
}

const creq = (prisma: unknown) => ({
  prisma, leagueId: 'l1', userId: 'u1', proposerRosterId: 'r1', seasonId: 's1',
  sport: 'NFL', season: 2026, week: 6,
}) as Parameters<typeof resolveRedraftTeamWindow>[0]

describe('a redraft refusal reports the redraft horizon', () => {
  /*
   * 🛑 THE FIELD THIS BATCH ADDED WAS ANSWERING WRONG FOR EVERY ADAPTER REFUSAL. `refuse` omitted
   * the coefficient set, `unresolvableWindowDecision` defaulted to the DYNASTY one, and
   * `refusedDecision` derives `evidence.format` from whatever coefficients it was handed. So the
   * one field added to say which horizon a league was judged over said "dynasty" for every
   * redraft refusal.
   */
  it('carries redraft coefficients and format, not the dynasty default', async () => {
    const prisma = { league: { findUnique: async () => null } } as never
    const d = await resolveRedraftTeamWindow(creq(prisma))
    expect(d.state).toBe('refused')
    expect(d.evidence.format).toBe('redraft')
    expect(d.coefficients.horizon).toBe('redraft')
    expect(d.coefficients.version).toBe(REDRAFT_WINDOW_COEFFICIENTS.version)
    expect(d.coefficients.version).not.toBe(DEFAULT_WINDOW_COEFFICIENTS.version)
  })
})

describe('only the CURRENT roster counts', () => {
  /*
   * `RedraftRosterPlayer` RETAINS dropped rows. Without `droppedAt: null` the share sums every
   * player ever rostered this season. The dropped player here carries a deliberately absurd
   * projection, so a query that forgets the filter cannot produce the same answer as one that
   * never had him.
   */
  it('excludes dropped players from the rest-of-season share', async () => {
    const withDrop = countingPrisma({
      rosterRows: [
        { rosterId: 'r1', playerId: 'keep1' },
        { rosterId: 'r1', playerId: 'gone1', dropped: true },
        { rosterId: 'r2', playerId: 'keep2' },
      ],
    })
    const clean = countingPrisma({
      rosterRows: [
        { rosterId: 'r1', playerId: 'keep1' },
        { rosterId: 'r2', playerId: 'keep2' },
      ],
    })
    const a = await resolveRedraftTeamWindow(creq(withDrop.prisma))
    const b = await resolveRedraftTeamWindow(creq(clean.prisma))
    expect(a.evidence.restOfSeason).not.toBeNull()
    expect(a.evidence.restOfSeason!.share).toBeCloseTo(b.evidence.restOfSeason!.share, 10)
    expect(a.evidence.restOfSeason!.rosterSize).toBe(b.evidence.restOfSeason!.rosterSize)
  })

  it('asks the database for current rows rather than filtering after the fact', async () => {
    const seen: Array<Record<string, unknown>> = []
    const base = countingPrisma().prisma as unknown as Record<string, unknown>
    const prisma = {
      ...base,
      redraftRosterPlayer: {
        findMany: async (a: { where?: Record<string, unknown> }) => {
          seen.push(a?.where ?? {})
          return []
        },
      },
    } as never
    await resolveRedraftTeamWindow(creq(prisma))
    expect(seen.length).toBeGreaterThan(0)
    for (const where of seen) expect(where).toHaveProperty('droppedAt', null)
  })
})

describe('the league-wide reads happen once per request', () => {
  /*
   * The loader ignores the week — the rest of the season is the same quantity whichever prior week
   * is reconstructed — so running it per lookback week repeated a full-league roster read and a
   * whole-league projection scan for byte-identical data, on a route rate-limited at 60/min.
   */
  it('reads the league roster and projections exactly once, not once per lookback week', async () => {
    const { prisma, calls } = countingPrisma()
    await resolveRedraftTeamWindow(creq(prisma))
    expect(calls.filter(c => c === 'ros:leagueWide')).toHaveLength(1)
    expect(calls.filter(c => c === 'projections')).toHaveLength(1)
    // Still redraft: the dynasty store is never touched at any point.
    expect(calls).not.toContain('DYNASTY')
  })

  it('a failed projection read has its OWN stage, not the broad evidence one', async () => {
    const base = countingPrisma().prisma as unknown as Record<string, unknown>
    const broken = {
      ...base,
      aFProjectionSnapshot: { findMany: async () => { throw new Error('projection read down') } },
    } as never
    const d = await resolveRedraftTeamWindow(creq(broken))
    expect(d.state).toBe('refused')
    expect(d.gaps).toContain(WINDOW_GAP_PROJECTION_READ_FAILED)
    expect(d.gaps).not.toContain(WINDOW_GAP_EVIDENCE_READ_FAILED)
  })
})
