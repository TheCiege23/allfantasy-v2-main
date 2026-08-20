import { describe, expect, it } from 'vitest'

import {
  getDefaultTeamCountForSelection,
  getTeamCountOptionsForSelection,
  normalizeDraftTypeForTeamCount,
  TEAM_COUNT_DRAFT_OVERRIDES,
} from '@/lib/create-league-v2/team-count-rules'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'

const snake = 'snake'
const auction = 'auction'

describe('team-count-rules — product tables', () => {
  it('1. Redraft NFL Snake returns 4–20 even', () => {
    const opts = getTeamCountOptionsForSelection({ concept: 'redraft', sport: 'NFL', draftType: snake })
    expect(opts).toEqual([4, 6, 8, 10, 12, 14, 16, 18, 20])
  })

  it('2. Redraft NCAAF Snake returns college redraft ladder', () => {
    const opts = getTeamCountOptionsForSelection({ concept: 'redraft', sport: 'NCAAF', draftType: snake })
    expect(opts).toEqual([4, 6, 8, 10, 12, 14, 16, 20, 24, 28])
  })

  it('3. Dynasty NFL Snake returns even 4–32', () => {
    const opts = getTeamCountOptionsForSelection({ concept: 'dynasty', sport: 'NFL', draftType: snake })
    expect(opts[0]).toBe(4)
    expect(opts[opts.length - 1]).toBe(32)
    expect(opts.every((n) => n % 2 === 0)).toBe(true)
  })

  it('4. Dynasty NBA Snake returns even 4–30', () => {
    const opts = getTeamCountOptionsForSelection({ concept: 'dynasty', sport: 'NBA', draftType: snake })
    expect(opts[0]).toBe(4)
    expect(opts[opts.length - 1]).toBe(30)
  })

  it('5. Dynasty NCAAF Snake returns smart tiers up to 134', () => {
    const opts = getTeamCountOptionsForSelection({ concept: 'dynasty', sport: 'NCAAF', draftType: snake })
    expect(opts[opts.length - 1]).toBe(134)
    expect(opts).toContain(64)
  })

  it('6. Dynasty NCAAB Snake returns smart tiers up to 364', () => {
    const opts = getTeamCountOptionsForSelection({ concept: 'dynasty', sport: 'NCAAB', draftType: snake })
    expect(opts[opts.length - 1]).toBe(364)
    expect(opts).toContain(320)
  })

  it('7. Best Ball NFL matches redraft launch-small counts', () => {
    const bb = getTeamCountOptionsForSelection({ concept: 'best_ball', sport: 'NFL', draftType: snake })
    const rd = getTeamCountOptionsForSelection({ concept: 'redraft', sport: 'NFL', draftType: snake })
    expect(bb).toEqual(rd)
  })

  it('8. Guillotine NFL returns fixed rungs and default 18', () => {
    const opts = getTeamCountOptionsForSelection({ concept: 'guillotine', sport: 'NFL', draftType: snake })
    expect(opts).toEqual([12, 14, 16, 18, 20, 22])
    expect(getDefaultTeamCountForSelection({ concept: 'guillotine', sport: 'NFL', draftType: snake })).toBe(18)
  })

  it('9. Zombie NCAAB returns extended ladder', () => {
    expect(getTeamCountOptionsForSelection({ concept: 'zombie', sport: 'NCAAB', draftType: snake })).toEqual([
      16, 20, 24, 28, 32, 40, 48, 64,
    ])
  })

  it('10. Survivor NFL returns full cast list and default 16', () => {
    const opts = getTeamCountOptionsForSelection({ concept: 'survivor', sport: 'NFL', draftType: snake })
    expect(opts).toEqual([12, 15, 16, 20, 24])
    expect(getDefaultTeamCountForSelection({ concept: 'survivor', sport: 'NFL', draftType: snake })).toBe(16)
  })

  it('11. Tournament unchanged', () => {
    expect(getTeamCountOptionsForSelection({ concept: 'tournament', sport: 'NFL', draftType: snake })).toEqual([
      32, 64, 96, 128, 160, 192, 224,
    ])
  })

  it('12. Big Brother NFL returns 12,14,16,18', () => {
    expect(getTeamCountOptionsForSelection({ concept: 'big_brother', sport: 'NFL', draftType: snake })).toEqual([
      12, 14, 16, 18,
    ])
  })

  it('13. Big Brother NBA returns 14–24 evens', () => {
    expect(getTeamCountOptionsForSelection({ concept: 'big_brother', sport: 'NBA', draftType: snake })).toEqual([
      14, 16, 18, 20, 22, 24,
    ])
  })

  it('14. Draft type hooks: snake vs auction share counts until overrides exist', () => {
    expect(TEAM_COUNT_DRAFT_OVERRIDES).toBeDefined()
    const a = getTeamCountOptionsForSelection({ concept: 'dynasty', sport: 'NFL', draftType: snake })
    const b = getTeamCountOptionsForSelection({ concept: 'dynasty', sport: 'NFL', draftType: auction })
    expect(a).toEqual(b)
    expect(normalizeDraftTypeForTeamCount('devy_snake')).toBe('snake')
  })

  it('15. Backend rejects Big Brother NFL 10', () => {
    const r = validateCreatePayload({
      concept: 'big_brother',
      sport: 'NFL',
      scoringPreset: 'fb_half_ppr_one_qb',
      teamCount: 10,
      draftType: 'snake',
      leagueName: 'Valid League Name Here',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors?.[0]?.message).toContain('Allowed values')
  })

  it('16. Backend rejects Dynasty NFL 34', () => {
    const r = validateCreatePayload({
      concept: 'dynasty',
      sport: 'NFL',
      scoringPreset: 'fb_half_ppr_one_qb',
      teamCount: 34,
      draftType: 'snake',
      leagueName: 'Valid League Name Here',
    })
    expect(r.ok).toBe(false)
  })

  it('17. Survivor NFL + snake team count 16 validates', () => {
    const r = validateCreatePayload({
      concept: 'survivor',
      sport: 'NFL',
      scoringPreset: 'fb_half_ppr_one_qb',
      teamCount: 16,
      draftType: 'snake',
      leagueName: 'Valid League Name Here',
    })
    expect(r.ok).toBe(true)
  })

  it('18. Form completion flags invalid dynasty NFL team count', () => {
    const issues = analyzeCreateLeagueCompletion({
      ...DEFAULT_V2_STATE,
      leagueType: 'dynasty',
      dynasty: { ...DEFAULT_V2_STATE.dynasty, draftMode: 'offline' },
      teamCount: 34,
      scoringPresetId: 'fb_half_ppr_one_qb',
      name: 'Valid Length League Name Here',
      draftType: 'snake',
    })
    expect(issues.some((i) => i.code === 'team_count_invalid')).toBe(true)
  })
})
