/**
 * "Play division rivals twice" (division_config.rivalsTwice): after the full round robin every
 * division rival is played a second time with home and away swapped. Idle teams in a rematch week
 * (an odd division's bye, a smaller division that has finished) play an idle team from another
 * division; an odd league gives one idle team the bye. With the setting off, or no divisions, the
 * schedule is byte-identical to what it was before.
 */
import { describe, expect, it } from 'vitest'

import { buildCanonicalScheduleRuntimeState, generateCanonicalRegularSeasonSchedule } from '@/lib/schedule-runtime/canonicalScheduleRuntime'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import {
  readDivisionConfig,
  parseActiveLeagueDivisions,
  scheduleDivisionsForRosters,
  validateDivisionSetup,
} from '@/lib/league/divisions/leagueDivisions'

const rules = (weeks: number) =>
  ({ general: { sport: 'NFL', format: 'redraft', status: 'setup' }, playoffs: { startWeek: weeks + 1 }, schedule: { regularSeasonLength: weeks } }) as never

/** `sizes` teams per division: [4, 4] → a1..a4 in div-1, b1..b4 in div-2. */
function teams(sizes: number[]) {
  return sizes.flatMap((n, d) =>
    Array.from({ length: n }, (_, i) => ({ rosterId: `${String.fromCharCode(97 + d)}${i + 1}`, divisionId: `div-${d + 1}`, divisionName: `D${d + 1}` })),
  )
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|')

function meetings(matchups: Array<{ homeRosterId: string; awayRosterId: string | null; bye: boolean }>) {
  const out = new Map<string, string[]>()
  for (const m of matchups) {
    if (m.bye || !m.awayRosterId) continue
    const k = pairKey(m.homeRosterId, m.awayRosterId)
    out.set(k, [...(out.get(k) ?? []), m.homeRosterId])
  }
  return out
}

function check(sizes: number[], weeks: number) {
  const ts = teams(sizes)
  const out = generateCanonicalRegularSeasonSchedule({ rules: rules(weeks), teams: ts, regularSeasonWeeks: weeks, divisionRivalsTwice: true })
  const met = meetings(out.matchups)
  const division = new Map(ts.map((t) => [t.rosterId, t.divisionId]))
  // Every team appears exactly once every week (a game or the bye).
  for (let w = 1; w <= weeks; w += 1) {
    const seen = out.matchups.filter((m) => m.week === w).flatMap((m) => [m.homeRosterId, m.awayRosterId].filter(Boolean))
    expect(new Set(seen).size, `week ${w}`).toBe(seen.length)
    expect(seen.length, `week ${w}`).toBe(ts.length)
  }
  return { out, met, division, ts }
}

const rounds = (n: number) => (n % 2 === 0 ? n - 1 : n)

describe('rematch rounds', () => {
  it.each([
    [[4, 4]],
    [[5, 5]],
    [[4, 3]],
    [[3, 3, 2]],
    // The small division FIRST: its two idle teams must not be paired with each other a third time.
    [[2, 3, 3]],
    [[4, 4, 4]],
    [[3, 3, 3, 3]],
    [[2, 2]],
  ])('divisions %j: every rival met exactly twice, once at each home', (sizes) => {
    const total = sizes.reduce((a, b) => a + b, 0)
    const weeks = rounds(total) + Math.max(...sizes.map(rounds))
    const { met, division, ts, out } = check(sizes, weeks)
    for (const a of ts) {
      for (const b of ts) {
        if (a.rosterId >= b.rosterId) continue
        const homes = met.get(pairKey(a.rosterId, b.rosterId)) ?? []
        if (division.get(a.rosterId) === division.get(b.rosterId)) {
          expect(homes.length, `${a.rosterId}-${b.rosterId}`).toBe(2)
          expect(new Set(homes).size, `${a.rosterId}-${b.rosterId} home swapped`).toBe(2)
        } else {
          expect(homes.length, `${a.rosterId}-${b.rosterId}`).toBeGreaterThanOrEqual(1)
        }
      }
    }
    expect(out.validationIssues.map((i) => i.code)).not.toContain('DIVISION_REMATCHES_INCOMPLETE')
    // Idle teams are paired across divisions: a fill-in game never gives rivals a third meeting.
    for (const [k, homes] of met) {
      const [a, b] = k.split('|')
      if (division.get(a!) === division.get(b!)) expect(homes.length, k).toBe(2)
    }
  })

  it('the rematches come after everyone has been played once', () => {
    const { out } = check([4, 4], 10)
    const firstSeven = meetings(out.matchups.filter((m) => m.week <= 7))
    expect([...firstSeven.values()].every((h) => h.length === 1)).toBe(true)
    expect(firstSeven.size).toBe(28)
    expect(out.matchups.filter((m) => m.week > 7).every((m) => m.divisionGame)).toBe(true)
  })

  it('an odd league gives exactly one idle team the bye in each rematch week', () => {
    const { out } = check([4, 3], 10)
    for (let w = 8; w <= 10; w += 1) expect(out.matchups.filter((m) => m.week === w && m.bye)).toHaveLength(1)
  })

  it('a season too short for every rematch says how many weeks it needs', () => {
    const out = generateCanonicalRegularSeasonSchedule({ rules: rules(8), teams: teams([4, 4]), regularSeasonWeeks: 8, divisionRivalsTwice: true })
    const issue = out.validationIssues.find((i) => i.code === 'DIVISION_REMATCHES_INCOMPLETE')
    expect(issue?.severity).toBe('warning')
    expect(issue?.message).toContain('needs 10 regular-season weeks')
    expect(issue?.message).toContain('2 rematch week(s) will not be played')
  })

  it('off, the schedule is exactly what it was', () => {
    const base = generateCanonicalRegularSeasonSchedule({ rules: rules(14), teams: teams([5, 5]), regularSeasonWeeks: 14 })
    const off = generateCanonicalRegularSeasonSchedule({ rules: rules(14), teams: teams([5, 5]), regularSeasonWeeks: 14, divisionRivalsTwice: false })
    expect(off).toEqual(base)
  })

  it('on, with no divisions, the schedule is exactly what it was', () => {
    const plain = teams([4, 4]).map(({ rosterId }) => ({ rosterId }))
    const base = generateCanonicalRegularSeasonSchedule({ rules: rules(14), teams: plain, regularSeasonWeeks: 14 })
    const on = generateCanonicalRegularSeasonSchedule({ rules: rules(14), teams: plain, regularSeasonWeeks: 14, divisionRivalsTwice: true })
    expect(on).toEqual(base)
  })
})

describe('the schedule preview (no weeks saved yet)', () => {
  it('uses the setting too', () => {
    const state = buildCanonicalScheduleRuntimeState({ rules: rules(10), teams: teams([4, 4]), regularSeasonWeeks: 10, divisionRivalsTwice: true })
    const all = state.weeks.flatMap((w) => w.matchups)
    expect(meetings(all).get(pairKey('a1', 'a2'))).toHaveLength(2)
  })
})

describe('generateSchedule (the redraft season builder)', () => {
  const rosters = teams([4, 4]).map((t) => ({ id: t.rosterId }))
  const byRoster = new Map(teams([4, 4]).map((t) => [t.rosterId, { key: t.divisionId, name: t.divisionName }]))

  it('passes the divisions through, so rivals meet twice', () => {
    const slots = generateSchedule(rosters, 13, 11, 'NFL', { divisionByRoster: byRoster, divisionRivalsTwice: true })
    const met = meetings(slots.map((s) => ({ homeRosterId: s.home, awayRosterId: s.away, bye: !s.away })))
    expect(met.get(pairKey('a1', 'a2'))).toHaveLength(2)
    expect(met.get(pairKey('a1', 'b1'))).toHaveLength(1)
  })

  it('without divisions it is unchanged', () => {
    expect(generateSchedule(rosters, 13, 11, 'NFL', { divisionByRoster: null, divisionRivalsTwice: true })).toEqual(generateSchedule(rosters, 13, 11, 'NFL'))
  })
})

describe('the setting itself', () => {
  const settings = (rivalsTwice?: unknown) => ({
    division_config: { count: 2, names: ['East', 'West'], teamAssignments: { t1: 0, t2: 0, t3: 1, t4: 1 }, ...(rivalsTwice === undefined ? {} : { rivalsTwice }) },
  })

  it('is off unless it is literally true', () => {
    expect(readDivisionConfig(settings()).rivalsTwice).toBe(false)
    expect(readDivisionConfig(settings('yes')).rivalsTwice).toBe(false)
    expect(parseActiveLeagueDivisions(settings(true))?.rivalsTwice).toBe(true)
  })

  it('maps season rosters to divisions by their team, and is null with no divisions', () => {
    const teamsRows = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const out = scheduleDivisionsForRosters(settings(true), teamsRows, [{ rosterId: 'r1', ids: ['t1'] }, { rosterId: 'r3', ids: ['t3'] }])
    expect(out?.rivalsTwice).toBe(true)
    expect(out?.byRoster.get('r1')?.key).toBe('div-1')
    expect(out?.byRoster.get('r3')?.key).toBe('div-2')
    expect(scheduleDivisionsForRosters({}, teamsRows, [{ rosterId: 'r1', ids: ['t1'] }])).toBeNull()
  })

  it('validation refuses anything but on or off', () => {
    const input = { count: 2, names: ['E', 'W'], teamAssignments: {} }
    expect(validateDivisionSetup({ ...input, rivalsTwice: 'on' }, ['t1', 't2', 't3', 't4'])).toMatchObject({ ok: false, code: 'BAD_RIVALS_TWICE' })
    expect(validateDivisionSetup({ ...input, rivalsTwice: true }, ['t1', 't2', 't3', 't4'])).toEqual({ ok: true })
  })
})
