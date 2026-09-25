import { expect, it } from 'vitest'
import { resolveLeagueRuntimeV2, leagueRuntimeFromWorld, leagueRuntimeFromNormalized } from '@/lib/decision-os/value-v2/league'
import { scoreComponents } from '@/lib/decision-os/value-v2/value'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import type { CanonicalWorldRawInput } from '@/lib/decision-os/world/facts'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'

const input = { leagueId: 'L1', sport: 'NFL', format: 'dynasty', teamCount: 14,
  scoringSettings: { scoring_settings: { rec: 0.75, bonus_rec_te: 1.25, rec_yd: 0.1 } },
  starterSlots: ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX', 'FLEX', 'DL', 'DE', 'DT', 'IDP_FLEX', 'K', 'BN'],
  rosterSize: 22, irSlots: 3, taxiSlots: 5, formatRules: { waiverBudget: 150, keeper: null } }

it('preserves exact custom PPR and additive position bonuses from wrapped runtime settings', () => {
  const result = resolveLeagueRuntimeV2(input)
  expect(result.gaps).toEqual([])
  expect(scoreComponents('TE', { rec: 4, rec_yd: 50 }, result.scoring!)).toBe(13)
  expect(scoreComponents('WR', { rec: 4, rec_yd: 50 }, result.scoring!)).toBe(8)
  expect(result.benchSlots).toBe(11)
  expect(result.reserveSlots).toBe(3)
  expect(result.taxiSlots).toBe(5)
  expect(result.fingerprint).not.toBeNull()
})
it('keeps specific IDP eligibility and superflex membership instead of flattening positions', () => {
  const result = resolveLeagueRuntimeV2(input)
  const eligibility = (name: string) => result.slots!.find(s => s.id.startsWith(`${name}:`))!.eligiblePositions
  expect(eligibility('DE')).toEqual(['DE'])
  expect(eligibility('DT')).toEqual(['DT'])
  expect(eligibility('DL')).toContain('DT')
  expect(eligibility('SUPER_FLEX')).toContain('QB')
  expect(eligibility('FLEX')).not.toContain('QB')
  expect(eligibility('IDP_FLEX')).toContain('CB')
})
it.each(['MYSTERY', '', 12])('refuses the entire topology for unknown slot %s', slot => {
  const result = resolveLeagueRuntimeV2({ ...input, starterSlots: ['QB', slot] })
  expect(result.slots).toBeNull()
  expect(result.fingerprint).toBeNull()
})
it('refuses invalid, conflicting and unmapped scoring instead of silently dropping rules', () => {
  expect(resolveLeagueRuntimeV2({ ...input, scoringSettings: { rec: '0.75' } }).scoring).toBeNull()
  expect(resolveLeagueRuntimeV2({ ...input, scoringSettings: { scoring_settings: { rec: 1 }, scoringSettings: { rec: 0.5 } } }).gaps).toContain('league_scoring_conflict:rec')
  const result = resolveLeagueRuntimeV2({ ...input, scoringSettings: { rec: 1, yahoo_stat_55: 3 } })
  expect(result.scoring).toBeNull()
  expect(result.gaps).toContain('league_scoring_unmapped:yahoo_stat_55')
})
it('cannot infer kick distances or threshold events from yardage totals', () => {
  const result = resolveLeagueRuntimeV2({ ...input, scoringSettings: { fgm_50p: 5, fgm_yds: 0.1 } })
  expect(scoreComponents('K', { fgm: 3 }, result.scoring!)).toBeNull()
  expect(scoreComponents('K', { fgm_50p: 1, fgm_yds: 118 }, result.scoring!)).toBe(16.8)
})
it('keeps unknown capacity distinct from zero and rejects inconsistent active roster size', () => {
  expect(resolveLeagueRuntimeV2({ ...input, teamCount: null }).teamCount).toBeNull()
  expect(resolveLeagueRuntimeV2({ ...input, teamCount: 0 }).fingerprint).toBeNull()
  expect(resolveLeagueRuntimeV2({ ...input, rosterSize: 3 }).benchSlots).toBeNull()
  expect(resolveLeagueRuntimeV2({ ...input, irSlots: null }).reserveSlots).toBeNull()
  expect(resolveLeagueRuntimeV2({ ...input, irSlots: 0 }).reserveSlots).toBe(0)
})
it('fingerprints settings independently of lineup order while tracking exact rule changes', () => {
  const fingerprint = resolveLeagueRuntimeV2(input).fingerprint
  expect(resolveLeagueRuntimeV2({ ...input, starterSlots: [...input.starterSlots].reverse() }).fingerprint).toBe(fingerprint)
  expect(resolveLeagueRuntimeV2({ ...input, scoringSettings: { rec: 0.75, bonus_rec_te: 1.5, rec_yd: 0.1 } }).fingerprint).not.toBe(fingerprint)
  expect(resolveLeagueRuntimeV2({ ...input, taxiSlots: 6 }).fingerprint).not.toBe(fingerprint)
})
it('assembles recorded team capacity and nested scoring from the actual canonical world contract', () => {
  const raw = { league: { id: 'L1', sport: 'NFL', season: 2026, leagueType: 'dynasty', isDynasty: true,
      leagueSize: 14, starters: input.starterSlots, rosterSize: 22, irSlots: 3, taxiSlots: 5,
      settings: input.scoringSettings, lastSyncedAt: null },
    teams: [], rosters: [], performances: [] } as unknown as CanonicalWorldRawInput
  // An import with zero loaded teams is still a 14-team league, never a zero-team market.
  const world = assembleCanonicalWorld(raw, { now: new Date('2026-09-09T00:00:00Z') })
  const result = leagueRuntimeFromWorld(world)
  expect(result.teamCount).toBe(14)
  expect(result.scoring).toContainEqual({ stat: 'rec', points: 1.25, positions: ['TE'] })
})
it('takes the authenticated normalized scoring values rather than rounded scoring labels', () => {
  const context = { leagueId: 'L1', sport: 'NFL', leagueType: 'dynasty', leagueVariant: null,
    scoring: { scoringModel: 'points', pointsByStat: { rec: 0.75, bonus_rec_te: 1.25 }, labels: { receptionFormat: 'ppr', tePremiumExtra: 0.5 } },
    roster: { starters: input.starterSlots, rosterSize: 22, irSlots: 3, taxiSlots: 5, taxiAllowNonRookies: false, taxiYearsLimit: 2 },
    flags: { isDynasty: true }, waiver: {}, trade: {}, playoff: {}, salaryCap: {} } as unknown as NormalizedLeagueContext
  const result = leagueRuntimeFromNormalized(context, 14)
  expect(scoreComponents('TE', { rec: 4 }, result.scoring!)).toBe(8)
  expect(result.fingerprint).not.toBeNull()
  expect(leagueRuntimeFromNormalized(context, null).teamCount).toBeNull()
})
