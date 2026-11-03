/**
 * Best ball Guilly (lib/guillotine/guillotineBestBall.ts): a guillotine league whose lineups set
 * themselves. Stored as `settings.best_ball` — never `bestBallMode` — and read by the places that decide
 * a lineup: scoring, the create payload, the chop warning.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  canChangeGuillotineBestBall,
  isBestBallGuillotine,
  readGuillotineBestBall,
} from '@/lib/guillotine/guillotineBestBall'
import { leagueIsBestBall } from '@/lib/redraft/scoringEngine'
import { chopZoneWarning } from '@/lib/guillotine/chopAlertCopy'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
import { isBestBallLeagueRow } from '@/lib/core-app/leagueBestBall'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { resolveValidScoringPresetIdForSelection } from '@/lib/create-league-v2/rules-engine'

const guilly = (settings: unknown) => ({ guillotineMode: true, leagueType: 'guillotine', leagueVariant: 'guillotine', bestBallMode: false, settings })

describe('the flag', () => {
  it('a Guilly league with settings.best_ball is best ball; without it, it is not', () => {
    expect(readGuillotineBestBall({ best_ball: true })).toBe(true)
    expect(isBestBallGuillotine(guilly({ best_ball: true }))).toBe(true)
    expect(isBestBallGuillotine(guilly({}))).toBe(false)
    expect(isBestBallGuillotine(guilly({ best_ball: false }))).toBe(false)
    expect(isBestBallGuillotine(guilly(null))).toBe(false)
  })

  it('changeable only before the draft', () => {
    for (const status of ['setup', 'pre_draft', 'predraft']) expect(canChangeGuillotineBestBall({ status })).toBe(true)
    for (const status of ['drafting', 'post_draft', 'in_season', 'completed']) expect(canChangeGuillotineBestBall({ status })).toBe(false)
    expect(canChangeGuillotineBestBall({})).toBe(false)
  })
})

describe('scoring (lib/redraft/scoringEngine.ts leagueIsBestBall)', () => {
  it('scores a best ball Guilly league on each team’s best lineup', () => {
    expect(leagueIsBestBall(guilly({ best_ball: true }))).toBe(true)
    expect(leagueIsBestBall(guilly({}))).toBe(false)
  })

  it('leaves every other league exactly as it was: an imported league carrying the provider’s flag still scores its starters', () => {
    expect(leagueIsBestBall({ bestBallMode: false, leagueVariant: 'redraft', leagueType: 'redraft', settings: { best_ball: true } })).toBe(false)
    expect(leagueIsBestBall({ bestBallMode: true, leagueVariant: 'redraft', leagueType: 'redraft' })).toBe(true)
  })

  it('the lineup surfaces that already read settings.best_ball see a best ball Guilly league as automatic', () => {
    expect(automaticLineup('guillotine', { best_ball: true })).toBe(true)
    expect(isBestBallLeagueRow({ ...guilly({ best_ball: true }) })).toBe(true)
    expect(automaticLineup('guillotine', {})).toBe(false)
  })
})

describe('the chop warning (lib/guillotine/chopAlertCopy.ts)', () => {
  it('a best ball league is not told to check a lineup it cannot set', () => {
    for (const status of ['chopped', 'danger'] as const) {
      const bb = chopZoneWarning({ leagueName: 'Guilly', week: 5, status, margin: 2, bestBall: true })
      expect(bb.body).not.toMatch(/check your lineup/i)
      expect(bb.body).toContain('Your best lineup is picked for you')
      expect(chopZoneWarning({ leagueName: 'Guilly', week: 5, status, margin: 2 }).body).toContain('Check your lineup before the last games.')
    }
  })
})

describe('creating one (lib/create-league-v2/submit.ts)', () => {
  async function submitted(state: CreateLeagueV2State) {
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
    expect(bodies).toHaveLength(1) // the submit reached the server; an empty body proves nothing
    return (bodies[0]?.conceptSetup ?? {}) as Record<string, unknown>
  }
  const base = (patch: Partial<CreateLeagueV2State>): CreateLeagueV2State => ({
    ...DEFAULT_V2_STATE,
    sport: 'NBA',
    teamCount: 12,
    name: 'Best ball Guilly',
    draftType: 'snake',
    draftScheduleLater: true,
    scoringPresetId: resolveValidScoringPresetIdForSelection('', { leagueType: patch.leagueType ?? 'redraft', sport: 'NBA', idpSelected: false }),
    ...patch,
  })

  it('a Guilly league with the box ticked sends it; unticked sends nothing', async () => {
    expect((await submitted(base({ leagueType: 'guillotine', guillotineBestBall: true }))).guillotineBestBall).toBe(true)
    expect(await submitted(base({ leagueType: 'guillotine', guillotineBestBall: false }))).not.toHaveProperty('guillotineBestBall')
  })

  it('another format never sends it, even with the field left set', async () => {
    expect(await submitted(base({ leagueType: 'redraft', guillotineBestBall: true }))).not.toHaveProperty('guillotineBestBall')
  })
})
