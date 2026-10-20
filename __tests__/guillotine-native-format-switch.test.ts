import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ league: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, guillotineLeagueConfig: { findUnique: m.config } } }))
import { getGuillotineConfig, isGuillotineLeague } from '@/lib/guillotine/GuillotineLeagueConfig'
beforeEach(() => { vi.clearAllMocks(); m.config.mockResolvedValue({id:'old',leagueId:'L',eliminationStartWeek:10,eliminationEndWeek:24,tiebreakerOrder:[]}) })
it('does not let an old Guillotine config activate elimination in a converted native NBA redraft league', async () => {
  m.league.mockResolvedValue({ id:'L', sport:'NBA', platform:'manual', leagueType:'redraft', leagueVariant:'redraft', guillotineMode:false })
  expect(await isGuillotineLeague('L')).toBe(false)
  expect(await getGuillotineConfig('L')).toBeNull()
  expect(m.config).not.toHaveBeenCalled()
})
it('keeps native Guillotine elimination active', async () => {
  m.league.mockResolvedValue({ id:'L', sport:'NBA', platform:'manual', leagueType:'guillotine', leagueVariant:'guillotine', guillotineMode:true })
  expect(await isGuillotineLeague('L')).toBe(true)
  expect(await getGuillotineConfig('L')).toMatchObject({leagueId:'L',eliminationEndWeek:24})
})
it('preserves configuration-based classification for imported leagues', async () => {
  m.league.mockResolvedValue({ id:'L', sport:'NBA', platform:'sleeper', leagueType:'redraft', leagueVariant:null, guillotineMode:false })
  expect(await isGuillotineLeague('L')).toBe(true)
})
it('preserves configuration-based classification for untyped legacy native leagues', async () => {
  m.league.mockResolvedValue({ id:'L', platform:'manual', leagueType:null, leagueVariant:null, guillotineMode:false })
  expect(await isGuillotineLeague('L')).toBe(true)
})
