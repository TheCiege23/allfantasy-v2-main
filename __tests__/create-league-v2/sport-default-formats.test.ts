/**
 * Each sport starts on a specialty format: Survivor during the NBA-only creation pilot,
 * else Guillotine (MLB), else Big Brother (NCAAB, Soccer). Changing sport follows that default
 * until the manager picks a format themselves; after that their pick is kept whenever the new
 * sport allows it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

import {
  defaultLeagueTypeForSport,
  freshCreateLeagueState,
  nextStateForLeagueType,
  nextStateForSport,
} from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE, SUPPORTED_SPORTS, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

const EXPECTED: Record<string, string> = {
  NFL: 'guillotine', NCAAF: 'big_brother', NBA: 'survivor', NHL: 'guillotine',
  MLB: 'guillotine', NCAAB: 'big_brother', SOCCER: 'big_brother',
}

const named = (s: CreateLeagueV2State): CreateLeagueV2State => ({ ...s, name: 'Default League', nameTouched: true, draftScheduleLater: true })

describe('every sport starts on its specialty default', () => {
  let bodies: Record<string, unknown>[] = []
  beforeEach(() => {
    bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return { ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) } as Response
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('names the default for each sport', () => {
    for (const sport of SUPPORTED_SPORTS) expect(defaultLeagueTypeForSport(sport), sport).toBe(EXPECTED[sport])
  })

  it('switching sport from a fresh create lands on that sport\'s default, and it is creatable', async () => {
    const fresh = freshCreateLeagueState(DEFAULT_V2_STATE)
    const refused: string[] = []
    for (const sport of SUPPORTED_SPORTS) {
      const state = named({ ...fresh, ...nextStateForSport(fresh, sport) })
      expect(state.leagueType, sport).toBe(EXPECTED[sport])
      expect(state.leagueTypeTouched, sport).toBe(false)
      const issues = analyzeCreateLeagueCompletion(state)
      if (issues.length) { refused.push(`${sport}: ${issues.map((i) => i.code)}`); continue }
      await submitCreateLeagueV2(state)
      const body = bodies.at(-1)!
      expect(body.concept, sport).toBe(EXPECTED[sport])
      const validated = validateCreatePayload(body)
      if (!validated.ok) refused.push(`${sport} server: ${JSON.stringify(validated).slice(0, 200)}`)
    }
    expect(refused).toEqual([])
  })

  it('an untouched default follows the sport back and forth', () => {
    let state = freshCreateLeagueState(DEFAULT_V2_STATE)
    for (const sport of ['MLB', 'NBA', 'SOCCER', 'NHL'] as const) {
      state = { ...state, ...nextStateForSport(state, sport) }
      expect(state.leagueType, sport).toBe(EXPECTED[sport])
    }
  })

  it('a format the manager picked is kept when the new sport allows it', () => {
    const fresh = freshCreateLeagueState(DEFAULT_V2_STATE)
    const picked = { ...fresh, ...nextStateForLeagueType(fresh, 'dynasty'), leagueTypeTouched: true }
    const onMlb = { ...picked, ...nextStateForSport(picked, 'MLB') }
    expect(onMlb.leagueType).toBe('dynasty')
    // Guillotine picked on MLB, then NBA: NBA allows Guillotine, so it stays rather than jumping
    // to NBA's Survivor default.
    const guillotine = { ...onMlb, ...nextStateForLeagueType(onMlb, 'guillotine'), leagueTypeTouched: true }
    expect({ ...guillotine, ...nextStateForSport(guillotine, 'NBA') }.leagueType).toBe('guillotine')
  })

  it('a picked format the new sport does not allow falls back to that sport\'s default', () => {
    const fresh = freshCreateLeagueState(DEFAULT_V2_STATE)
    const devy = { ...fresh, ...nextStateForLeagueType(fresh, 'devy'), leagueTypeTouched: true }
    expect({ ...devy, ...nextStateForSport(devy, 'NBA') }.leagueType).toBe('survivor')
    expect({ ...devy, ...nextStateForSport(devy, 'SOCCER') }.leagueType).toBe('big_brother')
  })
})
