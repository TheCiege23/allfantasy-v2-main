/**
 * Every option the create wizard puts on screen must produce a league the server accepts.
 *
 * The neighbouring suites each pin one past refusal (soccer pipeline, Best Ball 3RR, presets the
 * server rejected). This one walks the whole menu the way a manager does — sport tile, then
 * format tile, then draft type and scoring preset, at the smallest, default and largest team
 * size — through the wizard's own transition functions and the real submit body, and asks the
 * server validator about every combination. A choice the wizard offers and the server refuses
 * is a dead end with nothing red anywhere until someone taps Create.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

import {
  nextStateForIdp,
  nextStateForLeagueType,
  nextStateForSport,
} from '@/components/create-league-v2/CreateLeagueWizard'
import {
  DEFAULT_V2_STATE,
  SUPPORTED_SPORTS,
  getEffectiveLeagueType,
  type CreateLeagueV2State,
  type WizardDraftType,
} from '@/lib/create-league-v2/state'
import {
  getDefaultTeamCount,
  getDraftTypeOptions,
  getIdpDraftTypeOptions,
  getScoringPresetOptionsForSelection,
  getSurvivorTribeOptions,
  getTeamCountOptions,
  isSportAllowedForType,
} from '@/lib/create-league-v2/rules-engine'
import { getClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'

type Choice = { label: string; state: CreateLeagueV2State }

function apply(state: CreateLeagueV2State, patch: Partial<CreateLeagueV2State>): CreateLeagueV2State {
  return { ...state, ...patch }
}

/** Mirrors LeagueBasicsStep: the concepts shown for a sport, plus IDP for the football sports. */
function formatsShownFor(state: CreateLeagueV2State): Array<{ id: string; next: Partial<CreateLeagueV2State> }> {
  const catalog = getClientLeagueCreateOptionsCatalog()
  const shown = catalog.concepts
    .filter((concept) => concept.id !== 'idp' && isSportAllowedForType(state.sport, concept.id as LeagueTypeId))
    .map((concept) => ({ id: concept.id, next: nextStateForLeagueType(state, concept.id as LeagueTypeId) }))
  if (catalog.concepts.some((concept) => concept.id === 'idp') && (state.sport === 'NFL' || state.sport === 'NCAAF')) {
    shown.push({ id: 'idp', next: nextStateForIdp(state) })
  }
  return shown
}

/** Builds every combination a manager can reach by tapping through the wizard. */
function everyReachableChoice(): Choice[] {
  const choices: Choice[] = []
  const base: CreateLeagueV2State = {
    ...DEFAULT_V2_STATE,
    name: 'Every Option League',
    nameTouched: true,
    draftDate: '2026-10-19',
    draftTime: '20:00',
    timezone: 'America/New_York',
  }
  for (const sport of SUPPORTED_SPORTS) {
    const afterSport = apply(base, nextStateForSport(base, sport))
    for (const format of formatsShownFor(afterSport)) {
      const afterFormat = apply(afterSport, format.next)
      const leagueType = getEffectiveLeagueType(afterFormat) ?? 'redraft'
      const draftTypes = afterFormat.idpSelected ? getIdpDraftTypeOptions() : getDraftTypeOptions(leagueType, sport)
      const presets = getScoringPresetOptionsForSelection({ leagueType, sport, idpSelected: afterFormat.idpSelected })
      const sizes = getTeamCountOptions(sport, leagueType, afterFormat.soccerPipeline)
      const teamCounts = [...new Set([sizes[0], getDefaultTeamCount(sport, leagueType, afterFormat.soccerPipeline), sizes.at(-1)])]
      for (const draft of draftTypes) {
        for (const preset of presets) {
          for (const teamCount of teamCounts) {
            if (teamCount == null) continue
            // Team count is typed on the Basics step after the format tile; the input handler
            // also refits the dynasty and Best Ball playoff blocks and the survivor tribe count, which this reproduces.
            let state = apply(afterFormat, { teamCount })
            if (leagueType === 'dynasty') {
              const playoffTeamCount = Math.min(state.dynasty.playoffTeamCount, Math.max(2, teamCount))
              state = apply(state, { dynasty: { ...state.dynasty, playoffTeamCount, playoffByeCount: 2 ** Math.ceil(Math.log2(playoffTeamCount)) - playoffTeamCount } })
            }
            if (leagueType === 'survivor') {
              const tribeOptions = getSurvivorTribeOptions(teamCount)
              if (!tribeOptions.includes(state.survivorTribeCount)) state = apply(state, { survivorTribeCount: tribeOptions[0] ?? 2 })
            }
            if (leagueType === 'best_ball') {
              state = apply(state, { bestBall: { ...state.bestBall, playoffTeams: Math.min(state.bestBall.playoffTeams, teamCount) } })
            }
            // ...and the Survivor tribe count, which must split the cast. The NFL cast sizes on offer
            // shrink as the season runs (`survivorCastSizesThatFitNow` reads the real clock while this
            // matrix is built), so a size whose default tribe count does not divide it appears mid-season.
            if (leagueType === 'survivor' && !getSurvivorTribeOptions(teamCount).includes(state.survivorTribeCount)) {
              state = apply(state, { survivorTribeCount: getSurvivorTribeOptions(teamCount)[0] ?? 2 })
            }
            state = apply(state, { draftType: draft.id as WizardDraftType, scoringPresetId: preset.id })
            choices.push({ label: `${sport}/${format.id}/${draft.id}/${preset.id}/${teamCount}`, state })
          }
        }
      }
    }
  }
  return choices
}

describe('every option the create wizard offers is creatable', () => {
  let bodies: Record<string, unknown>[] = []

  beforeEach(() => {
    bodies = []
    // Survivor's season-fit check reads the clock: a 24-manager NBA cast needs 24 of the 25
    // scoring weeks, so it fits only when the draft lands in the opening week (NBA 2026 opens
    // 2026-10-20). Pin "now" ahead of that draft so the matrix is the same on every day it runs,
    // instead of losing sizes as the real season advances.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T12:00:00Z') })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return { ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) } as Response
    }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const choices = everyReachableChoice()

  it('reaches every sport, and every format tile each sport shows', () => {
    const sports = new Set(choices.map((c) => c.state.sport))
    expect([...sports].sort()).toEqual([...SUPPORTED_SPORTS].sort())
    // Positive control on the walk itself: if the format filter ever went empty the matrix would
    // shrink to nothing and "zero refusals" would be vacuously true.
    expect(choices.length).toBeGreaterThan(200)
    expect(choices.some((c) => c.label.startsWith('NFL/idp/'))).toBe(true)
    expect(choices.some((c) => c.label.startsWith('SOCCER/'))).toBe(true)
  })

  it('every reachable combination passes the wizard checks and the server validator', async () => {
    const refused: string[] = []
    for (const choice of choices) {
      const issues = analyzeCreateLeagueCompletion(choice.state)
      if (issues.length > 0) {
        refused.push(`${choice.label} wizard: ${issues.map((i) => i.code).join(',')}`)
        continue
      }
      const before = bodies.length
      const result = await submitCreateLeagueV2(choice.state)
      if (!result.ok || bodies.length !== before + 1) {
        refused.push(`${choice.label} submit: ${result.error ?? 'no POST'}`)
        continue
      }
      const body = bodies.at(-1)!
      // The tournament route has its own validator; nothing in this wizard reaches it.
      expect(body.concept, choice.label).not.toBe('tournament')
      const validated = validateCreatePayload(body)
      if (!validated.ok) refused.push(`${choice.label} server: ${JSON.stringify(validated).slice(0, 240)}`)
    }
    expect(refused).toEqual([])
  })

  it('keeper and devy-round controls produce accepted payloads at every value they offer', async () => {
    const base = choices.find((c) => c.label === 'NFL/keeper/snake/fb_half_ppr/12')?.state
    expect(base, 'NFL keeper snake half-PPR 12 must be reachable').toBeTruthy()
    const refused: string[] = []
    for (const keeperMaxKeepers of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const keeperRoundPenalty of [0, 1, 2, 3]) {
        for (const keeperMaxYears of [1, 2, 3, 4, 5, 0]) {
          const state = apply(base!, { keeper: { ...base!.keeper, keeperMaxKeepers, keeperRoundPenalty, keeperMaxYears } })
          const issues = analyzeCreateLeagueCompletion(state)
          if (issues.length) { refused.push(`keeper ${keeperMaxKeepers}/${keeperRoundPenalty}/${keeperMaxYears}: ${issues.map((i) => i.code)}`); continue }
          await submitCreateLeagueV2(state)
          const validated = validateCreatePayload(bodies.at(-1)!)
          if (!validated.ok) refused.push(`keeper ${keeperMaxKeepers}/${keeperRoundPenalty}/${keeperMaxYears}: server`)
        }
      }
    }
    const dynasty = choices.find((c) => c.label === 'NFL/dynasty/snake/fb_half_ppr/12')?.state
    expect(dynasty, 'NFL dynasty snake half-PPR 12 must be reachable').toBeTruthy()
    for (const devyRoundCount of [1, 2, 3, 4]) {
      const state = apply(dynasty!, { dynasty: { ...dynasty!.dynasty, devyRoundsEnabled: true, devyRoundCount } })
      const issues = analyzeCreateLeagueCompletion(state)
      if (issues.length) { refused.push(`devy ${devyRoundCount}: ${issues.map((i) => i.code)}`); continue }
      await submitCreateLeagueV2(state)
      const validated = validateCreatePayload(bodies.at(-1)!)
      if (!validated.ok) refused.push(`devy ${devyRoundCount}: server ${JSON.stringify(validated).slice(0, 200)}`)
    }
    expect(refused).toEqual([])
  })

  it('"Schedule later" creates every sport and format without a draft date', async () => {
    // One combination per sport × format is enough here: the draft date is independent of draft
    // type and preset, and the full matrix above already covers those with a date.
    const seen = new Set<string>()
    const refused: string[] = []
    for (const choice of choices) {
      const [sport, format] = choice.label.split('/')
      if (seen.has(`${sport}/${format}`)) continue
      seen.add(`${sport}/${format}`)
      const state = apply(choice.state, { draftScheduleLater: true, draftDate: '', draftTime: '' })
      const issues = analyzeCreateLeagueCompletion(state)
      if (issues.length) { refused.push(`${sport}/${format} wizard: ${issues.map((i) => i.code)}`); continue }
      await submitCreateLeagueV2(state)
      const body = bodies.at(-1)!
      const setup = body.conceptSetup as Record<string, unknown>
      // 🛑 Absent, never ''. The NBA/NHL Survivor calendar reads any *string* as a draft time.
      if ('draftDate' in setup || 'draftTime' in setup) refused.push(`${sport}/${format}: sent draftDate/draftTime keys`)
      const validated = validateCreatePayload(body)
      if (!validated.ok) refused.push(`${sport}/${format} server: ${JSON.stringify(validated).slice(0, 200)}`)
    }
    expect(seen.has('NBA/survivor')).toBe(true)
    expect(refused).toEqual([])
  })

  it('without "Schedule later" a missing date still blocks creation', () => {
    const base = choices.find((c) => c.label === 'NFL/redraft/snake/fb_half_ppr/12')!.state
    const codes = analyzeCreateLeagueCompletion(apply(base, { draftDate: '', draftTime: '' })).map((i) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['draft_date_required', 'draft_time_required']))
  })

  it('privacy and the median game reach the request body', async () => {
    const base = choices.find((c) => c.label === 'NFL/redraft/snake/fb_half_ppr/12')!.state
    await submitCreateLeagueV2(apply(base, { privacy: 'public', medianGame: true }))
    const setup = bodies.at(-1)!.conceptSetup as Record<string, unknown>
    expect(setup).toMatchObject({ visibility: 'public', isPublic: true, medianGame: true })
    expect(validateCreatePayload(bodies.at(-1)!).ok).toBe(true)
  })
})
