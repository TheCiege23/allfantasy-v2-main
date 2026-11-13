/**
 * The create wizard's "Two-week elimination periods" box (MLB Guilly only) reaches the server as
 * `conceptSetup.guillotinePeriodWeeks: 2`; every other league's body is unchanged.
 */
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { resolveValidScoringPresetIdForSelection } from '@/lib/create-league-v2/rules-engine'

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

const base = (patch: Partial<CreateLeagueV2State>): CreateLeagueV2State => {
  const sport = patch.sport ?? 'MLB'
  const leagueType = patch.leagueType ?? 'guillotine'
  return {
    ...DEFAULT_V2_STATE,
    sport,
    teamCount: 10,
    name: 'Two-week Guilly',
    draftType: 'snake',
    draftScheduleLater: true,
    scoringPresetId: resolveValidScoringPresetIdForSelection('', { leagueType, sport, idpSelected: false }),
    leagueType,
    ...patch,
  }
}

describe('two-week periods in the create payload', () => {
  it('an MLB Guilly league with the box ticked sends it', async () => {
    expect((await submitted(base({ guillotineTwoWeekPeriods: true }))).guillotinePeriodWeeks).toBe(2)
  })

  it('unticked, another sport, or another format sends nothing', async () => {
    expect(await submitted(base({ guillotineTwoWeekPeriods: false }))).not.toHaveProperty('guillotinePeriodWeeks')
    expect(await submitted(base({ sport: 'NBA', guillotineTwoWeekPeriods: true }))).not.toHaveProperty('guillotinePeriodWeeks')
    expect(await submitted(base({ leagueType: 'redraft', guillotineTwoWeekPeriods: true }))).not.toHaveProperty('guillotinePeriodWeeks')
  })
})
