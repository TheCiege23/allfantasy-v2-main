/**
 * NHL and MLB leagues offer no taxi squad and no devy / prospect slots (owner, 2026-10-20).
 *
 * No committed provider contract gives us an NHL or MLB prospect pool (AHL / CHL / NCAA hockey, MiLB):
 * see contracts/thesportsdb/GAPS.md G-16 and lib/league-creation/prospectStashPolicy.ts. The wizard,
 * the canonical create API and the commissioner write paths must agree, and NFL / NBA must not move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { getAllowedSportsFromCatalog } from '@/lib/league-creation/options-catalog'
import { isSportAllowedForType } from '@/lib/create-league-v2/rules-engine'
import { isLeagueFormatAllowedForSport } from '@/lib/league/format-engine'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { resolveDynastyCreationRoster } from '@/lib/league-creation/canonical/dynastyCreationRoster'
import { DEFAULT_V2_STATE, getDefaultDynastySetup, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { freshCreateLeagueState, nextStateForLeagueType, nextStateForSport } from '@/components/create-league-v2/CreateLeagueWizard'
import { resolveMlbRosterTemplate, MLB_ROSTER_TEMPLATES } from '@/lib/mlb-roster/MlbRosterTemplates'
import { resolveNhlRosterTemplate, NHL_ROSTER_TEMPLATES } from '@/lib/nhl-roster/NhlRosterTemplates'
import {
  PROSPECT_STASH_SLOT_KEYS,
  PROSPECT_STASH_UNAVAILABLE_CODE,
  filterRosterTemplatesForProspectPolicy,
  findAddedProspectStashSlots,
  isTaxiIncreaseRefused,
  sportSupportsProspectStash,
} from '@/lib/league-creation/prospectStashPolicy'

const NO_POOL = ['NHL', 'MLB'] as const
const stashKeysIn = (slots: Record<string, number>) => Object.keys(slots).filter((k) => (PROSPECT_STASH_SLOT_KEYS as readonly string[]).includes(k))

const dynastyBody = (sport: string, scoringPreset: string, conceptSetup: Record<string, unknown> = {}) => ({
  concept: 'dynasty', sport, scoringPreset, teamCount: 12, draftType: 'snake', leagueName: 'Stash test', conceptSetup,
})
const PRESET: Record<string, string> = { NHL: 'nhl_points', MLB: 'mlb_points', NFL: 'fb_half_ppr', NBA: 'nba_points' }

describe('option catalog: devy and C2C are not offered for NHL or MLB', () => {
  it.each(['devy', 'c2c'] as const)('%s', (concept) => {
    const allowed = getAllowedSportsFromCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1, concept)
    for (const sport of NO_POOL) {
      expect(allowed).not.toContain(sport)
      expect(isSportAllowedForType(sport, concept)).toBe(false)
      expect(isLeagueFormatAllowedForSport(sport, concept)).toBe(false)
    }
    expect(allowed).toContain('NFL')
  })

  it('the server refuses an NHL or MLB devy league', () => {
    for (const sport of NO_POOL) {
      const r = validateCreatePayload({ ...dynastyBody(sport, PRESET[sport]), concept: 'devy' })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors[0]?.path).toBe('concept')
    }
  })
})

describe('server validation: no taxi squad for NHL or MLB', () => {
  it.each(NO_POOL)('%s dynasty with taxi slots is refused with a stable code', (sport) => {
    const r = validateCreatePayload(dynastyBody(sport, PRESET[sport], { taxiSlots: 4 }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.errors[0]).toMatchObject({ path: 'conceptSetup.taxiSlots', code: PROSPECT_STASH_UNAVAILABLE_CODE })
    }
  })

  it.each(NO_POOL)('%s dynasty asking for devy rounds is refused', (sport) => {
    const r = validateCreatePayload(dynastyBody(sport, PRESET[sport], { devyRoundsEnabled: true }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.path).toBe('conceptSetup.devyRoundsEnabled')
  })

  it.each(NO_POOL)('%s dynasty with taxi 0 (or unset) is still creatable', (sport) => {
    for (const setup of [{ taxiSlots: 0 }, {}]) {
      const r = validateCreatePayload(dynastyBody(sport, PRESET[sport], setup))
      expect(r.ok, r.ok ? undefined : r.error).toBe(true)
    }
  })

  it.each(['NFL', 'NBA'])('%s dynasty keeps its taxi squad', (sport) => {
    const r = validateCreatePayload(dynastyBody(sport, PRESET[sport], { taxiSlots: 4 }))
    expect(r.ok, r.ok ? undefined : r.error).toBe(true)
  })
})

describe('creation roster: a new NHL / MLB dynasty league gets no stash slots', () => {
  it.each(NO_POOL)('%s', (sport) => {
    const roster = resolveDynastyCreationRoster(sport, {})
    expect(stashKeysIn(roster.slots)).toEqual([])
    expect(roster.taxiSlots).toBe(0)
    // Startup draft still fits the wizard's default depth.
    expect(roster.totalRosterSlots).toBeGreaterThanOrEqual(getDefaultDynastySetup(sport).startupRosterDepth)
  })

  it('NFL keeps its taxi slots', () => {
    expect(resolveDynastyCreationRoster('NFL', { taxiSlots: 5 }).taxiSlots).toBe(5)
  })

  it('the sport templates are unchanged, because existing leagues with no stored config read them', () => {
    expect(resolveMlbRosterTemplate('dynasty').slots).toMatchObject({ TAXI: 6, PROSPECT: 10 })
    expect(resolveNhlRosterTemplate('dynasty').slots).toMatchObject({ TAXI: 4, PROSPECT: 8 })
  })
})

describe('wizard: defaults and submit carry no taxi for NHL / MLB', () => {
  let bodies: Record<string, unknown>[] = []
  beforeEach(() => {
    bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return { ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) } as Response
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('default taxi count is 0 for NHL and MLB and unchanged for NFL / NBA', () => {
    expect(getDefaultDynastySetup('MLB').taxiSlotCount).toBe(0)
    expect(getDefaultDynastySetup('NHL').taxiSlotCount).toBe(0)
    expect(getDefaultDynastySetup('NFL').taxiSlotCount).toBe(5)
    expect(getDefaultDynastySetup('NBA').taxiSlotCount).toBe(4)
  })

  it.each(NO_POOL)('%s: a session still holding a taxi count submits 0, and the server accepts it', async (sport) => {
    const fresh = freshCreateLeagueState(DEFAULT_V2_STATE)
    const withSport = { ...fresh, ...nextStateForSport(fresh, sport) }
    const dyn = { ...withSport, ...nextStateForLeagueType(withSport, 'dynasty'), leagueTypeTouched: true }
    const state: CreateLeagueV2State = {
      ...dyn, name: 'Stash test', nameTouched: true, draftScheduleLater: true,
      dynasty: { ...dyn.dynasty, taxiSlotCount: 6 },
    }
    await submitCreateLeagueV2(state)
    const body = bodies.at(-1)!
    expect(body).toMatchObject({ concept: 'dynasty', sport })
    expect((body.conceptSetup as Record<string, unknown>).taxiSlots).toBe(0)
    const validated = validateCreatePayload(body)
    expect(validated.ok, validated.ok ? undefined : validated.error).toBe(true)
  })
})

describe('commissioner writes: existing NHL / MLB leagues may keep or lower, never add', () => {
  it('policy is NHL / MLB only', () => {
    expect(sportSupportsProspectStash('NHL')).toBe(false)
    expect(sportSupportsProspectStash('mlb')).toBe(false)
    for (const s of ['NFL', 'NBA', 'NCAAF', 'NCAAB', 'SOCCER']) expect(sportSupportsProspectStash(s)).toBe(true)
  })

  it('roster slots: adding or growing a stash slot is refused; keeping or lowering is not', () => {
    const existing = { C: 1, BN: 12, TAXI: 6, PROSPECT: 10 }
    expect(findAddedProspectStashSlots('MLB', existing, existing)).toEqual([])
    expect(findAddedProspectStashSlots('MLB', { ...existing, TAXI: 2, PROSPECT: 0 }, existing)).toEqual([])
    expect(findAddedProspectStashSlots('MLB', { ...existing, TAXI: 7 }, existing)).toEqual(['TAXI'])
    expect(findAddedProspectStashSlots('NHL', { C: 2, RIGHTS: 3 }, { C: 2 })).toEqual(['RIGHTS'])
    // NA is a standard MLB slot for players already in the pool, not a stash slot.
    expect(findAddedProspectStashSlots('MLB', { NA: 5 }, {})).toEqual([])
    expect(findAddedProspectStashSlots('NFL', { TAXI: 9 }, {})).toEqual([])
  })

  it('dynasty taxi count: an increase is refused for NHL / MLB only', () => {
    expect(isTaxiIncreaseRefused('NHL', 5, 4)).toBe(true)
    expect(isTaxiIncreaseRefused('NHL', 4, 4)).toBe(false)
    expect(isTaxiIncreaseRefused('MLB', 0, 6)).toBe(false)
    expect(isTaxiIncreaseRefused('MLB', 1, 0)).toBe(true)
    expect(isTaxiIncreaseRefused('NFL', 10, 0)).toBe(false)
  })

  it('template picker: drops the prospect-only templates and strips stash slots from the rest', () => {
    for (const [sport, templates] of [['MLB', MLB_ROSTER_TEMPLATES], ['NHL', NHL_ROSTER_TEMPLATES]] as const) {
      const offered = filterRosterTemplatesForProspectPolicy(sport, templates)
      expect(offered.map((t) => t.key)).not.toContain('devy')
      expect(offered.map((t) => t.key)).not.toContain('prospect')
      expect(offered.flatMap((t) => stashKeysIn(t.slots))).toEqual([])
      expect(offered.map((t) => t.key)).toContain('dynasty')
    }
    expect(filterRosterTemplatesForProspectPolicy('NFL', [{ key: 'devy', slots: { TAXI: 4 } }])).toEqual([{ key: 'devy', slots: { TAXI: 4 } }])
  })
})
