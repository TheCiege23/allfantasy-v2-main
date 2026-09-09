/**
 * IMP-03 (MFL half) — position restrictions must survive the adapter.
 *
 * `MflScoringRuleRaw` carries `positions`, but `MflAdapter` mapped only stat code and
 * points. Three reception rules (RB 0.5 / WR 1.0 / TE 1.5) therefore reached the canonical
 * normalizer as three rules sharing one key; the last won, and every RB and WR in the
 * league was silently scored at the TE rate.
 */

import { describe, expect, it } from 'vitest'

import { MflAdapter } from '@/lib/league-import/adapters/mfl/MflAdapter'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'

function mflPayload() {
  return {
    sourceInput: '54321',
    league: {
      leagueId: '54321',
      season: 2026,
      name: 'MFL Test League',
      sport: 'NFL',
      franchiseCount: 12,
      rosterSize: 20,
    },
    teams: [],
    playerMap: {},
    standings: [],
    schedule: [],
    transactions: [],
    draftPicks: [],
    futureDraftPicks: [],
    previousSeasons: [],
    settings: { scoringType: 'ppr', raw: {} },
    scoringRules: [
      { code: 'CC', name: 'Reception', positions: ['RB'], points: 0.5 },
      { code: 'CC', name: 'Reception', positions: ['WR'], points: 1.0 },
      { code: 'CC', name: 'Reception', positions: ['TE'], points: 1.5 },
      { code: 'PA', name: 'Passing TD', positions: [], points: 6 },
    ],
  }
}

describe('IMP-03 — MFL position-dependent scoring', () => {
  it('carries position restrictions out of the adapter', async () => {
    const out = await MflAdapter.normalize(mflPayload() as never)
    const recRules = (out.scoring?.rules ?? []).filter((r) => r.stat_key === 'mfl_stat_CC')
    expect(recRules).toHaveLength(3)
    expect(recRules.map((r) => r.positions?.[0])).toEqual(['RB', 'WR', 'TE'])
  })

  it('omits positions entirely for an unrestricted rule', async () => {
    const out = await MflAdapter.normalize(mflPayload() as never)
    const passTd = (out.scoring?.rules ?? []).find((r) => r.stat_key === 'mfl_stat_PA')
    /* Absent means "all positions"; an empty array would read as "no positions". */
    expect(passTd?.positions).toBeUndefined()
  })

  it('reaches the canonical snapshot as three distinct prices, not one', async () => {
    const out = await MflAdapter.normalize(mflPayload() as never)
    const bundle = buildCanonicalImportBundle(out)
    const rules = bundle.settingsSnapshot.scoringSettings?.rules as Record<string, unknown>

    expect(rules['mfl_stat_CC@RB']).toBe(0.5)
    expect(rules['mfl_stat_CC@WR']).toBe(1.0)
    expect(rules['mfl_stat_CC@TE']).toBe(1.5)
    expect(rules['mfl_stat_PA']).toBe(6)
  })
})
