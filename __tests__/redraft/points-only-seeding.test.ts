import { describe, expect, it, vi } from 'vitest'
import { buildNflRedraftPlayoffRuntimeState } from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
const h = vi.hoisted(() => ({ updates: [] as any[], league: { sport: 'NFL', leagueVariant: 'best_ball', settings: {}, playoffSeedingRule: 'points_only', medianGame: false } }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: vi.fn(async () => h.league), update: vi.fn(async (args:any) => { h.updates.push(args); return {} }) },
  redraftSeason: { findUnique: vi.fn(async () => ({ league: h.league })) },
  redraftRoster: { findMany: vi.fn(async () => ['a','b','c','d'].map(id=>({id}))), update: vi.fn(async (args:any) => { h.updates.push(args); return {} }) },
  redraftMatchup: { findMany: vi.fn(async () => [
    { week:1, homeRosterId:'a', awayRosterId:'b', homeScore:100, awayScore:90, status:'final' },
    { week:1, homeRosterId:'c', awayRosterId:'d', homeScore:200, awayScore:210, status:'final' },
  ]) },
} }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn() }), EVENT: { STANDINGS_UPDATED:'standings.updated' } }))
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { bootstrapLeaguePlayoffConfig } from '@/lib/playoff-defaults/LeaguePlayoffBootstrapService'
import { resolveConfiguredPlayoffSeedingRule } from '@/lib/playoff-defaults/seedingRule'
import { getSeedingRulesForLeague } from '@/lib/playoff-defaults/PlayoffSeedingResolver'

describe('points-only playoff seeding', () => {
  it('reads the persisted league choice instead of the sport default', async () => {
    expect((await getSeedingRulesForLeague('league'))?.seeding_rules).toBe('points_only')
  })
  it('keeps the saved choice when bootstrapping playoff settings', async () => {
    h.updates=[]
    await bootstrapLeaguePlayoffConfig('league')
    expect(h.updates[0].data.settings.playoff_structure.seeding_rules).toBe('points_only')
  })
  it('keeps explicit settings-panel overrides ahead of the creation choice', () => {
    expect(resolveConfiguredPlayoffSeedingRule({ playoffSeedingRule:'points_only', settings:{playoff_structure:{seeding_rules:'standard_standings'}} })).toBe('standard_standings')
  })
  it('ranks a higher-scoring loser ahead of a lower-scoring winner', async () => {
    h.updates=[]
    await updateStandings('season',1)
    expect(h.updates.find(row=>row.where.id==='c').data).toMatchObject({ pointsFor:200, wins:0, playoffSeed:2 })
    expect(h.updates.find(row=>row.where.id==='a').data.playoffSeed).toBe(3)
  })
  it('qualifies the top points scorers even when record tiebreakers were inherited', () => {
    const state=buildNflRedraftPlayoffRuntimeState({ leagueId:'league', seasonId:'season', season:2026, week:16,
      rules:{ playoffs:{ teamCount:2, seedingRules:'points_only', standingsTiebreakers:['win_pct','wins','division_record','points_for'] }, schedule:{regularSeasonLength:15} },
      teams:[{ rosterId:'a', wins:15,losses:0,pointsFor:100 },{ rosterId:'b',wins:0,losses:15,pointsFor:200 },{rosterId:'c',wins:10,losses:5,pointsFor:150},{rosterId:'d',wins:5,losses:10,pointsFor:50}],
    })
    expect(state.seeds.map(row=>row.rosterId)).toEqual(['b','c'])
    expect(state.settings.divisionWinnersEnabled).toBe(false)
  })
})
