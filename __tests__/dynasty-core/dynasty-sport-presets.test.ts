import { describe, expect, it, vi } from 'vitest'
import {
  DYNASTY_SPORT_PRESETS,
  applyDynastySportPresetToSetup,
  getDynastySportPresets,
  matchDynastySportPreset,
  rosterSlotsWithDynastySportPreset,
} from '@/lib/dynasty-core/DynastySportPresets'
import { DEFAULT_V2_STATE, getDefaultDynastySetup, type CreateLeagueV2State, type SupportedSport } from '@/lib/create-league-v2/state'
import { resolveValidScoringPresetIdForSelection, getScoringPresetOptionsForSelection } from '@/lib/create-league-v2/rules-engine'
import { resolveDynastyCreationRoster } from '@/lib/league-creation/canonical/dynastyCreationRoster'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { resolveNbaRosterTemplate, NBA_SLOT_MAP } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveNhlRosterTemplate, NHL_SLOT_MAP } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveMlbRosterTemplate, MLB_SLOT_MAP } from '@/lib/mlb-roster/MlbRosterTemplates'
import { ROSTER_SECTION_KEYS } from '@/lib/roster-lineup-engine/types'
import { DYNASTY_SPORT_PRESET_COPY } from '@/lib/i18n/dynasty-format-copy'

const SPORTS = ['NBA', 'NHL', 'MLB'] as const
const templates = { NBA: resolveNbaRosterTemplate('dynasty'), NHL: resolveNhlRosterTemplate('dynasty'), MLB: resolveMlbRosterTemplate('dynasty') }
const slotMaps = { NBA: NBA_SLOT_MAP, NHL: NHL_SLOT_MAP, MLB: MLB_SLOT_MAP }

function dynastyState(sport: SupportedSport, patch: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'dynasty',
    sport,
    teamCount: 12,
    name: 'Preset league',
    draftType: 'snake',
    draftScheduleLater: true,
    scoringPresetId: resolveValidScoringPresetIdForSelection('', { leagueType: 'dynasty', sport, idpSelected: false }),
    dynasty: getDefaultDynastySetup(sport, 'snake'),
    ...patch,
  }
}

async function submittedBody(state: CreateLeagueV2State) {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    return { ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) } as Response
  }))
  try {
    await submitCreateLeagueV2(state)
  } finally {
    vi.unstubAllGlobals()
  }
  return bodies[0]!
}

describe('NBA / NHL / MLB dynasty format presets', () => {
  it('offers presets for NBA, NHL and MLB only', () => {
    for (const sport of SPORTS) expect(getDynastySportPresets(sport).length).toBeGreaterThanOrEqual(2)
    for (const sport of ['NFL', 'NCAAF', 'NCAAB', 'SOCCER']) expect(getDynastySportPresets(sport)).toEqual([])
  })

  it.each(SPORTS)('%s: the first preset IS the wizard default, so offering presets changes no default', (sport) => {
    const state = dynastyState(sport)
    const first = getDynastySportPresets(sport)[0]!
    expect(matchDynastySportPreset(sport, state.scoringPresetId, state.dynasty)?.id).toBe(first.id)
  })

  it('the wizard defaults themselves are unchanged (NFL included)', () => {
    const pick = (s: SupportedSport) => {
      const d = getDefaultDynastySetup(s, 'snake')
      return [d.benchCount, d.irCount, d.taxiSlotCount, d.taxiEligibilityYears, d.startupRosterDepth]
    }
    expect(pick('NFL')).toEqual([14, 3, 5, 2, 28])
    expect(pick('NBA')).toEqual([8, 3, 4, 2, 24])
    expect(pick('NHL')).toEqual([9, 3, 4, 2, 26])
    expect(pick('MLB')).toEqual([12, 4, 6, 2, 34])
    expect(resolveValidScoringPresetIdForSelection('', { leagueType: 'dynasty', sport: 'NFL', idpSelected: false })).toBe('fb_half_ppr')
    expect(resolveValidScoringPresetIdForSelection('', { leagueType: 'redraft', sport: 'NBA', idpSelected: false })).toBe('nba_points')
  })

  it.each(DYNASTY_SPORT_PRESETS.map((p) => [p.id, p] as const))('%s: scoring is an allowed dynasty preset for its sport', (_id, preset) => {
    const allowed = getScoringPresetOptionsForSelection({ leagueType: 'dynasty', sport: preset.sport, idpSelected: false }).map((o) => o.id)
    expect(allowed).toContain(preset.scoringPresetId)
  })

  it.each(DYNASTY_SPORT_PRESETS.map((p) => [p.id, p] as const))('%s: only touches BN / IR / TAXI — slot types the roster engine has', (_id, preset) => {
    const template = templates[preset.sport]
    const next = rosterSlotsWithDynastySportPreset(template.slots, preset)
    const changed = Object.keys(next).filter((k) => next[k] !== template.slots[k])
    const irKey = preset.sport === 'NHL' ? 'IR' : 'IL'
    for (const key of changed) expect(['BN', irKey, 'TAXI']).toContain(key)
    // Every key exists in that sport's slot catalog, within its maximum.
    for (const [key, count] of Object.entries(next)) {
      const def = slotMaps[preset.sport].get(key)
      expect(def, key).toBeDefined()
      expect(count).toBeLessThanOrEqual(def!.maxCount)
    }
    // Starters are the template's own.
    expect(resolveDynastyCreationRoster(preset.sport, {}).starters)
      .toEqual(resolveDynastyCreationRoster(preset.sport, { benchCount: preset.benchCount, irCount: preset.irCount, taxiSlots: preset.taxiSlotCount }).starters)
    expect(ROSTER_SECTION_KEYS).toContain('taxi')
  })

  it.each(DYNASTY_SPORT_PRESETS.map((p) => [p.id, p] as const))('%s: applied in the wizard, it is sent and the server accepts and builds it', async (_id, preset) => {
    const base = dynastyState(preset.sport)
    const state = { ...base, scoringPresetId: preset.scoringPresetId, dynasty: applyDynastySportPresetToSetup(base.dynasty, preset) }
    expect(matchDynastySportPreset(preset.sport, state.scoringPresetId, state.dynasty)?.id).toBe(preset.id)

    const body = await submittedBody(state)
    const setup = body.conceptSetup as Record<string, unknown>
    expect(body.scoringPreset).toBe(preset.scoringPresetId)
    expect(setup).toMatchObject({
      benchCount: preset.benchCount,
      irCount: preset.irCount,
      taxiSlots: preset.taxiSlotCount,
      taxiEligibilityYears: preset.taxiEligibilityYears,
      startupRosterDepth: preset.startupRosterDepth,
    })
    expect(validateCreatePayload(body).ok).toBe(true)

    const roster = resolveDynastyCreationRoster(preset.sport, setup)
    expect(roster.benchSlots).toBe(preset.benchCount)
    expect(roster.irSlots).toBe(preset.irCount)
    expect(roster.taxiSlots).toBe(preset.taxiSlotCount)
    expect(roster.totalRosterSlots).toBeGreaterThanOrEqual(preset.startupRosterDepth)
  })

  it('MLB minor-league depth is TAXI; the template NA / PROSPECT slots are left as they are', () => {
    const deep = getDynastySportPresets('MLB').find((p) => p.id === 'mlb_dynasty_points_deep')!
    const slots = rosterSlotsWithDynastySportPreset(templates.MLB.slots, deep)
    expect(slots.TAXI).toBe(10)
    expect(slots.NA).toBe(templates.MLB.slots.NA)
    expect(slots.PROSPECT).toBe(templates.MLB.slots.PROSPECT)
  })

  it('editing any value afterwards reads as Custom', () => {
    const state = dynastyState('NBA')
    expect(matchDynastySportPreset('NBA', state.scoringPresetId, { ...state.dynasty, benchCount: 9 })).toBeNull()
    expect(matchDynastySportPreset('NBA', 'nba_9cat', state.dynasty)).toBeNull()
  })

  it('every preset has English and Spanish copy', () => {
    for (const p of DYNASTY_SPORT_PRESETS) {
      expect(DYNASTY_SPORT_PRESET_COPY[p.id]?.en.label).toBeTruthy()
      expect(DYNASTY_SPORT_PRESET_COPY[p.id]?.es.label).toBeTruthy()
      expect(DYNASTY_SPORT_PRESET_COPY[p.id]?.es.label).not.toBe(DYNASTY_SPORT_PRESET_COPY[p.id]?.en.label)
    }
  })
})
