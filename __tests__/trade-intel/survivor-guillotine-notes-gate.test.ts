/**
 * The Survivor All-Stars notes belong to Survivor Guillotine leagues only, and a
 * confirmed specialty is read from the confirmation, not the column.
 *
 * 🛑 WHAT WAS BROKEN. The guillotine branch of the trade notes called
 * `lineupAt`, `superflexInflectionNote` and `idolExpiryNote` for EVERY guillotine
 * league. Those are pure functions of the week, so a plain guillotine league
 * before week 14 was told its lineup was about to grow, a SUPERFLEX was coming
 * and its idol was expiring — none of which exists in that league.
 *
 * ⚠ AND SINCE 2026-09-16 THE COLUMN HOLDS ONLY A BASE FORMAT. A confirmed
 * Survivor Guillotine league's column says `guillotine`; a confirmed Pirate
 * league's says `dynasty` or `redraft`. The specialty lives in
 * `settings.leagueTypeConfirmation`, so these run the real
 * `buildTradeContextNotes` against a fake database and assert on its output.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LEAGUE_ID = 'lg-sg'
const USER_ID = 'af-user-1'

let leagueRow: Record<string, unknown> = {}

vi.mock('@/lib/core-app/byeWeeks', () => ({
  getByeWeeks: async () => ({ byWeek: new Map<number, string[]>(), weeksCovered: [1], season: 2026 }),
}))

vi.mock('@/lib/prisma', () => {
  const emptyDelegate = new Proxy(
    {},
    {
      get: (_t, method: string) => {
        if (method === 'findMany' || method === 'groupBy') return async () => []
        if (method === 'count') return async () => 0
        return async () => null
      },
    },
  )
  const overrides: Record<string, Record<string, unknown>> = {
    league: { findUnique: async () => ({ ...leagueRow }) },
    leagueTeam: {
      findFirst: async () => ({ platformUserId: USER_ID, externalId: '1' }),
      findMany: async () => [],
      count: async () => 0,
    },
    roster: {
      findFirst: async () => ({ id: 'roster-1', playerData: { players: ['p1', 'p2'] } }),
      findMany: async () => [],
    },
  }
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) => {
        const override = overrides[model]
        if (!override) return emptyDelegate
        return new Proxy(override, {
          get: (t, method: string) =>
            (t as Record<string, unknown>)[method] ?? (emptyDelegate as Record<string, unknown>)[method],
        })
      },
    },
  )
  return { prisma, default: prisma }
})

const load = async () => (await import('@/lib/trade-intel/tradeContextNotes')).buildTradeContextNotes

const ARGS = {
  leagueId: LEAGUE_ID,
  userId: USER_ID,
  give: [{ name: 'Give Guy', position: 'WR', team: 'DAL' }],
  get: [{ name: 'Get Guy', position: 'RB', team: 'PHI' }],
}

function league(leagueType: string, settings: Record<string, unknown>) {
  leagueRow = {
    id: LEAGUE_ID,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
    season: 2026,
    sport: 'NFL',
    settings,
    leagueType,
    isDynasty: false,
    keeperCount: null,
    keeperCostSystem: null,
    keeperRoundPenalty: null,
  }
}

const confirmed = (type: string, extra: Record<string, unknown> = {}) => ({
  leagueTypeConfirmation: { type, confirmedByUserId: 'commish', ...extra },
})

/* Week 5: a WRT flex is due in week 7, the SUPERFLEX in week 9, the standard idol lasts to week 10. */
const WEEK_5 = { leg: 5 }

const LINEUP = 'You start 8 this week, and a WRT flex arrives in week 7'
const SUPERFLEX = 'The SUPERFLEX arrives in week 9, 4 weeks away'
const IDOL = 'Your standard idol can be played for 6 more weeks'
const NO_TRADES = 'Survivor Guillotine: trades are not allowed in this league.'
const GUILLOTINE = 'Guillotine: one team is chopped every week'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Survivor All-Stars notes are gated on the confirmed format', () => {
  it('a plain guillotine league gets the guillotine notes and none of the Survivor All-Stars ones', async () => {
    league('guillotine', { ...WEEK_5 })
    const out = await (await load())(ARGS)
    const text = out.formatNotes.join('\n')

    // Positive control: the guillotine branch really ran, at a week the schedule has one ahead.
    expect(text).toContain(GUILLOTINE)
    for (const absent of [LINEUP, SUPERFLEX, IDOL, NO_TRADES]) {
      expect(text).not.toContain(absent)
    }
  })

  it('a confirmed Survivor Guillotine league gets them, with the no-trades note leading', async () => {
    league('guillotine', { ...WEEK_5, ...confirmed('survivor_guillotine') })
    const out = await (await load())(ARGS)
    const text = out.formatNotes.join('\n')

    expect(out.formatNotes[0]).toContain(NO_TRADES)
    expect(out.formatNotes[0]).toContain('FAAB is the only way to acquire a player')
    for (const present of [GUILLOTINE, LINEUP, SUPERFLEX, IDOL]) {
      expect(text).toContain(present)
    }
  })

  it('keeps them after an importer rewrites the column — the confirmation is read first', async () => {
    league('redraft', { ...WEEK_5, ...confirmed('survivor_guillotine') })
    const out = await (await load())(ARGS)
    const text = out.formatNotes.join('\n')

    expect(text).toContain(GUILLOTINE)
    expect(text).toContain(SUPERFLEX)
    expect(text).not.toContain('Redraft: there are no future picks')
  })
})

describe('a confirmed Pirate league keeps its trade notes whatever the column says', () => {
  it.each(['dynasty', 'redraft'])('column %s', async (column) => {
    league(column, { ...WEEK_5, ...confirmed('pirate', { baseFormat: column }) })
    const out = await (await load())(ARGS)
    expect(out.formatNotes.join('\n')).toContain('only your 3 protected players are safe')
  })

  it('an unconfirmed league with the same column gets no pirate notes', async () => {
    league('dynasty', { ...WEEK_5 })
    const out = await (await load())(ARGS)
    expect(out.formatNotes.join('\n')).not.toContain('protected players')
  })
})

describe('the rail keeps a confirmed Survivor Guillotine league flagged as an elimination format', () => {
  /*
   * `railMatchups.ts` reads `leagueTypeConfirmation.type` before the column in a
   * raw query with no test harness, so the predicate is pinned by source. It must
   * name both ids: the confirmation says `survivor_guillotine`, never `guillotine`.
   */
  it('matches survivor_guillotine as well as guillotine', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/core-app/railMatchups.ts'), 'utf8')
    expect(src).toContain("settings->'leagueTypeConfirmation'->>'type' AS \"confirmedType\"")
    expect(src).toContain("type === 'guillotine' || type === 'survivor_guillotine'")
  })
})
