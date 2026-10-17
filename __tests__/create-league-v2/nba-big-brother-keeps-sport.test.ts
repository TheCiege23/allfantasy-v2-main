/**
 * Regression: an NBA Big Brother league ("Blah") was persisted as "NFL · Half PPR" with NFL roster
 * slots. A league must be created with the sport the manager picked, and a non-football league must
 * never carry a football scoring preset (the only Big Brother concept preset is NFL fb_half_ppr).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

import {
  freshCreateLeagueState,
  nextStateForLeagueType,
  nextStateForSport,
} from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { receptionPointsForScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'

const named = (s: CreateLeagueV2State): CreateLeagueV2State => ({ ...s, name: 'Blah', nameTouched: true, draftScheduleLater: true })

describe('NBA Big Brother is created as NBA with NBA scoring', () => {
  let bodies: Record<string, unknown>[] = []
  beforeEach(() => {
    bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return { ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) } as Response
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const fresh = freshCreateLeagueState(DEFAULT_V2_STATE)
  const sportThenFormat = (() => {
    const nba = { ...fresh, ...nextStateForSport(fresh, 'NBA') }
    return named({ ...nba, ...nextStateForLeagueType(nba, 'big_brother'), leagueTypeTouched: true })
  })()
  const formatThenSport = (() => {
    const bb = { ...fresh, ...nextStateForLeagueType(fresh, 'big_brother'), leagueTypeTouched: true }
    return named({ ...bb, ...nextStateForSport(bb, 'NBA') })
  })()

  it.each([
    ['sport, then format', sportThenFormat],
    ['format, then sport', formatThenSport],
  ])('the wizard (%s) submits sport NBA and a non-football preset, and the server accepts it', async (_label, state) => {
    expect(state.sport).toBe('NBA')
    expect(state.leagueType).toBe('big_brother')
    await submitCreateLeagueV2(state)
    const body = bodies.at(-1)!
    expect(body).toMatchObject({ concept: 'big_brother', sport: 'NBA', scoringPreset: 'nba_points' })
    expect(receptionPointsForScoringPresetId(String(body.scoringPreset))).toBeNull()

    const validated = validateCreatePayload(body)
    expect(validated.ok).toBe(true)
    if (validated.ok) expect(validated.data.sport).toBe('NBA')
  })

  it('the server resolves NBA defaults — never the NFL Big Brother concept preset', () => {
    const engine = runPresetEngine({ concept: 'big_brother', sport: 'NBA', draftType: 'snake', scoringPreset: 'nba_points', teamCount: 12 } as never)
    expect(engine.presetKey).toContain('sport=NBA')
    expect(engine.settingsSnapshot.sport_type).toBe('NBA')

    const defaults = getLeagueDefaults({ sport: 'NBA', format: 'big_brother', draftType: 'snake', managerCount: 12, scoringPreset: 'nba_points' })
    expect(defaults.sport).toBe('NBA')
    expect(defaults.conceptPreset.presetKey ?? '').not.toContain('sport=NFL')
    expect(defaults.scoringSettings.preset).toBe('nba_points')
    const starters = Object.keys((defaults.rosterSettings.starterSlots ?? {}) as Record<string, number>)
    expect(starters).toContain('PG')
    expect(starters).not.toContain('QB')
  })

  it('the server refuses a football preset on a non-football league', () => {
    const refused = validateCreatePayload({
      concept: 'big_brother', sport: 'NBA', scoringPreset: 'fb_half_ppr', teamCount: 12, draftType: 'snake', leagueName: 'Blah',
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.errors[0]?.path).toBe('scoringPreset')
    // Control: the same preset is still fine for NFL.
    expect(validateCreatePayload({
      concept: 'big_brother', sport: 'NFL', scoringPreset: 'fb_half_ppr', teamCount: 12, draftType: 'snake', leagueName: 'Blah',
    }).ok).toBe(true)
  })
})
