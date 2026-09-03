import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { loadVorp, resolveKicker, loadValues } = vi.hoisted(() => ({
  loadVorp: vi.fn(),
  resolveKicker: vi.fn(),
  loadValues: vi.fn(),
}))

vi.mock('@/lib/idp-projections/leagueIdpVorp', () => ({ loadLeagueIdpVorp: loadVorp }))
vi.mock('@/lib/kicker-values/leagueKickerValue', () => ({ resolveLeagueKickerValue: resolveKicker }))
vi.mock('@/lib/decision-os/value/idpKickerAdapter', () => ({ loadIdpKickerValues: loadValues }))

import {
  loadIdpKickerValueSlice,
  rosterSleeperIdsFrom,
  rosterPositionsFrom,
} from '@/lib/decision-os/grounding/idpKickerSlice'

/**
 * ── R3.1 — the IDP + kicker slice ───────────────────────────────────────────────────────────
 *
 * 🛑 The adapter was already complete. What was missing is the `IdpLeagueValuationContext` it
 * takes — NOTHING in the repo built one, so wiring the adapter with `null` would have produced
 * `not_computed` forever, for every league, while looking wired. These tests pin the context
 * construction and the cheap exit that keeps it off four leagues in five.
 */
describe('R3.1 — IDP/kicker value slice', () => {
  beforeEach(() => vi.clearAllMocks())

  const base = {
    sport: 'NFL',
    leagueId: 'L1',
    rosterPlayerIds: ['p1', 'p2'],
    numTeams: 12,
    isDynasty: false,
  }

  it('🛑 THE CHEAP EXIT: a league rostering neither runs NO query at all', async () => {
    // Measured: 10 of 94 NFL leagues carry IDP slots, 19 carry a kicker. For the rest this slice
    // must cost nothing — checked on ROSTER SLOTS, before any load.
    const s = await loadIdpKickerValueSlice({ ...base, rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'] })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('no_producer')
    expect(loadVorp).not.toHaveBeenCalled()
    expect(resolveKicker).not.toHaveBeenCalled()
    expect(loadValues).not.toHaveBeenCalled()
  })

  it('🛑 an EMPTY vorp map is passed as undefined, never as an empty Map', async () => {
    // The guard three other modules already carry. An empty Map reads to the adapter as "this
    // league prices IDP and every defender is worth nothing"; undefined reads as "not priced here",
    // which leaves them out rather than valuing them at zero.
    loadVorp.mockResolvedValue({ vorpBySleeperId: new Map(), skipped: null })
    resolveKicker.mockReturnValue({ value: 240 })
    loadValues.mockResolvedValue([{ status: 'ok', value: { playerId: 'c1' } }])
    await loadIdpKickerValueSlice({ ...base, rosterPositions: ['LB', 'DB', 'K', 'QB'] })
    expect(loadValues).toHaveBeenCalledTimes(1)
    const ctx = loadValues.mock.calls[0][0].leagueContext
    expect(ctx.vorpBySleeperId).toBeUndefined()
    expect(ctx.kickerValue).toBe(240)
  })

  it('a non-empty vorp map IS passed through', async () => {
    const m = new Map([['p1', 4.5]])
    loadVorp.mockResolvedValue({ vorpBySleeperId: m, skipped: null })
    resolveKicker.mockReturnValue({ value: null })
    loadValues.mockResolvedValue([{ status: 'ok', value: { playerId: 'c1' } }])
    const s = await loadIdpKickerValueSlice({ ...base, rosterPositions: ['LB', 'DB'] })
    expect(loadValues.mock.calls[0][0].leagueContext.vorpBySleeperId).toBe(m)
    expect(s.present).toBe(true)
    // Roster-and-league scoped: there is no store entry behind this, so `live` is the only honest answer.
    expect(s.servedFrom).toBe('live')
    expect(s.confidence).toBeNull()
  })

  it('⚠ surfaces the loader’s OWN skip reason, with the remedy that matches it', async () => {
    // "no scoring settings" and "no rostered defenders" are different problems. Collapsing them
    // into one gap is what makes a gap useless to the person reading it.
    loadVorp.mockResolvedValue({ vorpBySleeperId: new Map(), skipped: 'no_scoring_settings' })
    resolveKicker.mockReturnValue({ value: null })
    const s = await loadIdpKickerValueSlice({ ...base, rosterPositions: ['LB', 'DB'] })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_synced')
    expect(s.gap?.detail).toMatch(/scoring settings/i)
    expect(s.gap?.remedy).toMatch(/re-sync/i)
    expect(loadValues).not.toHaveBeenCalled()
  })

  it('a KICKER-ONLY league still prices — an absent IDP half must not block it', async () => {
    resolveKicker.mockReturnValue({ value: 180 })
    loadValues.mockResolvedValue([{ status: 'ok', value: { playerId: 'k1' } }])
    const s = await loadIdpKickerValueSlice({ ...base, rosterPositions: ['QB', 'RB', 'K'] })
    expect(loadVorp).not.toHaveBeenCalled() // not an IDP league — do not pay for the query
    expect(s.present).toBe(true)
    expect(loadValues.mock.calls[0][0].leagueContext.kickerValue).toBe(180)
  })

  it('no league, no roster, and a thrown loader each become an honest gap rather than an error', async () => {
    const a = await loadIdpKickerValueSlice({ ...base, leagueId: null, rosterPositions: ['LB'] })
    expect(a.gap?.reason).toBe('not_requested')

    const b = await loadIdpKickerValueSlice({ ...base, rosterPlayerIds: [], rosterPositions: ['LB'] })
    expect(b.gap?.reason).toBe('not_synced')

    loadVorp.mockRejectedValue(new Error('vorp exploded'))
    const c = await loadIdpKickerValueSlice({ ...base, rosterPositions: ['LB'] })
    expect(c.present).toBe(false)
    expect(c.gap?.detail).toMatch(/vorp exploded/)
  })
})

/**
 * ── The shape-aware glue between the packet and the adapter ─────────────────────────────────
 *
 * 🛑 THIS IS WHERE AN ID-SPACE MISTAKE WOULD HIDE. `loadLeagueIdpVorp` queries
 * `SportsPlayer.sleeperId`, so these ids must be PROVIDER ids. They are: `RosterContextProvider`
 * reads `Roster.playerData`, which stores provider ids deliberately — only the NAMES are enriched
 * from the canonical registry. Hand it canonical ids instead and every query matches nothing, the
 * map comes back empty, and the slice reports "no rostered defenders" forever while looking wired.
 */
describe('R3.1 — roster extractors', () => {
  it('pulls starters AND bench, dedupes, and ignores anything that is not a string id', () => {
    const slice = {
      starters: [{ playerId: '4034' }, { playerId: '6804' }, { playerId: null }, null],
      bench: [{ playerId: '6804' }, { playerId: '1234' }, { notAnId: 'x' }],
    }
    expect(rosterSleeperIdsFrom(slice).sort()).toEqual(['1234', '4034', '6804'])
  })

  it('returns [] for garbage rather than throwing — the packet must not die on a bad slice', () => {
    // The roster slice is GroundedSlice<unknown>; a provider change must degrade, not crash.
    for (const junk of [null, undefined, 'nope', 42, {}, { starters: 'no' }, { bench: {} }]) {
      expect(rosterSleeperIdsFrom(junk)).toEqual([])
    }
  })

  it('reads roster positions off rules.roster.starters, which is typed `unknown`', () => {
    expect(rosterPositionsFrom({ roster: { starters: ['QB', 'RB', 'LB', 'K'] } })).toEqual(['QB', 'RB', 'LB', 'K'])
    // Narrowed rather than trusted: CanonicalLeagueRules types this member as unknown.
    expect(rosterPositionsFrom({ roster: { starters: 'QB,RB' } })).toEqual([])
    expect(rosterPositionsFrom(null)).toEqual([])
    expect(rosterPositionsFrom({})).toEqual([])
  })

  it('⚠ an EMPTY position list reaches the cheap exit, not a query', async () => {
    // A league whose rules we could not read must not be treated as an IDP league on a guess.
    const s = await loadIdpKickerValueSlice({
      sport: 'NFL', leagueId: 'L1', rosterPlayerIds: ['p1'],
      rosterPositions: rosterPositionsFrom(null), numTeams: 12, isDynasty: false,
    })
    expect(s.gap?.reason).toBe('no_producer')
  })
})
