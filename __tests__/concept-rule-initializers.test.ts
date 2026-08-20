import { describe, expect, it, vi } from 'vitest'

import {
  buildConceptRulesSnapshot,
  initializeConceptRulesForLeague,
  survivorRecommendedTribeStructure,
} from '@/lib/league-creation/concept-rule-initializers'

describe('buildConceptRulesSnapshot', () => {
  it('Survivor: advantagePool count scales with teamCount (35% rounded)', () => {
    const s16 = buildConceptRulesSnapshot({
      concept: 'survivor',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 16,
      initializedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(s16.advantagePool).toMatchObject({
      enabled: true,
      defaultPoolPercent: 0.35,
      count: 6,
    })
    expect(Math.round(16 * 0.35)).toBe(6)

    const s20 = buildConceptRulesSnapshot({
      concept: 'survivor',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 20,
    })
    expect(s20.advantagePool?.count).toBe(7)
    expect(s20.tribeAssignmentMode).toBe('random_when_full')
    expect(s20.commissionerCanOverrideTribes).toBe(true)
  })

  it('Survivor 20 recommends 4 tribes of 5', () => {
    const s = buildConceptRulesSnapshot({
      concept: 'survivor',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 20,
    })
    expect(s.recommendedTribeStructure).toEqual({ tribeCount: 4, playersPerTribe: 5 })
    expect(survivorRecommendedTribeStructure(20)).toEqual({ tribeCount: 4, playersPerTribe: 5 })
  })

  it('Zombie 20: 1 whisperer, 19 humans', () => {
    const z = buildConceptRulesSnapshot({
      concept: 'zombie',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 20,
    })
    expect(z.whispererCount).toBe(1)
    expect(z.startingHumans).toBe(19)
    expect(z.assignmentStatus).toBe('pending')
  })

  it('Zombie 32: 2 whisperers', () => {
    const z = buildConceptRulesSnapshot({
      concept: 'zombie',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 32,
    })
    expect(z.whispererCount).toBe(2)
    expect(z.startingHumans).toBe(30)
  })

  it('Big Brother: week 1 and schedule arrays', () => {
    const bb = buildConceptRulesSnapshot({
      concept: 'big_brother',
      sport: 'NBA',
      draftType: 'snake',
      teamCount: 16,
    })
    expect(bb.competitionStartWeek).toBe(1)
    expect(bb.evictionStartWeek).toBe(1)
    expect(bb.skipWeeks).toEqual([])
    expect(bb.doubleEliminationWeeks).toEqual([])
    expect(bb.commissionerCanEditSchedule).toBe(true)
  })

  it('Guillotine: week 1 elimination schedule', () => {
    const g = buildConceptRulesSnapshot({
      concept: 'guillotine',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 18,
    })
    expect(g.eliminationStartWeek).toBe(1)
    expect(g.eliminationFrequency).toBe('weekly')
    expect(g.teamsEliminatedPerWeek).toBe(1)
  })

  it('Dynasty: startup snake, rookie linear options', () => {
    const d = buildConceptRulesSnapshot({
      concept: 'dynasty',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 12,
    })
    expect(d.startupDraftType).toBe('snake')
    expect(d.thirdRoundReversalAllowed).toBe(true)
    expect(d.rookieDraftDefaultType).toBe('linear')
    expect(d.rookieDraftStartsYear).toBe(2)
    expect(d.futureDraftOrderOptions).toContain('lottery')
  })

  it('Salary Cap: auction default and contract rounds', () => {
    const sc = buildConceptRulesSnapshot({
      concept: 'salary_cap',
      sport: 'NFL',
      draftType: 'auction',
      teamCount: 12,
    })
    expect(sc.defaultDraftType).toBe('auction')
    expect(sc.auctionRecommended).toBe(true)
    expect(sc.allowedFallbackDraftTypes).toEqual(['offline', 'auto', 'snake'])
    expect(sc.draftSlotContractScaleEnabled).toBe(true)
    expect(sc.defaultContractYearsByRound).toMatchObject({ round1: 4, later: 2 })
  })

  it('Redraft: minimal default snapshot', () => {
    const r = buildConceptRulesSnapshot({
      concept: 'redraft',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 12,
    })
    expect(r.version).toBe(1)
    expect(r.concept).toBe('redraft')
    expect(r.teamCount).toBe(12)
    expect(r.sport).toBe('NFL')
  })
})

describe('initializeConceptRulesForLeague persistence', () => {
  it('merges conceptRules into league.settings and extended settingsJson', async () => {
    const leagueSettings = { league_type: 'redraft', foo: 1 }
    const extendedJson = { tradeReviewMode: 'commissioner' }

    const tx = {
      league: {
        findUnique: vi.fn().mockResolvedValue({ settings: leagueSettings }),
        update: vi.fn().mockResolvedValue({ id: 'L1' }),
      },
      redraftLeagueExtendedSettings: {
        findUnique: vi.fn().mockResolvedValue({ settingsJson: extendedJson }),
        update: vi.fn().mockResolvedValue({ id: 'E1' }),
      },
    }

    const snap = await initializeConceptRulesForLeague({
      tx: tx as never,
      leagueId: 'league-1',
      concept: 'redraft',
      sport: 'NFL',
      draftType: 'snake',
      teamCount: 12,
    })

    expect(snap.concept).toBe('redraft')
    expect(tx.league.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'league-1' },
        data: expect.objectContaining({
          settings: expect.objectContaining({
            foo: 1,
            conceptRules: expect.objectContaining({ concept: 'redraft', version: 1 }),
          }),
        }),
      }),
    )
    expect(tx.redraftLeagueExtendedSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-1' },
        data: expect.objectContaining({
          settingsJson: expect.objectContaining({
            tradeReviewMode: 'commissioner',
            conceptRules: expect.objectContaining({ concept: 'redraft' }),
          }),
        }),
      }),
    )
  })
})
