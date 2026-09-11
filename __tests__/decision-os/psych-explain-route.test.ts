import { expect, it, vi } from 'vitest'
const engine = vi.hoisted(() => vi.fn())
vi.mock('@/lib/psychological-profiles/PsychologicalProfileEngine', () => ({ runPsychologicalProfileEngine: engine }))
const modules = [
  ['rankings narrative profile', () => import('@/app/api/rankings/manager-psychology/route'), 'POST'],
  ['list/compare/rollup', () => import('@/app/api/leagues/[leagueId]/psychological-profiles/handler'), 'GET'],
  ['detail', () => import('@/app/api/leagues/[leagueId]/psychological-profiles/[profileId]/route'), 'GET'],
  ['evidence', () => import('@/app/api/leagues/[leagueId]/psychological-profiles/[profileId]/evidence/route'), 'GET'],
  ['explain', () => import('@/app/api/leagues/[leagueId]/psychological-profiles/explain/route'), 'POST'],
  ['generate', () => import('@/app/api/leagues/[leagueId]/psychological-profiles/run/route'), 'POST'],
  ['generate all', () => import('@/app/api/leagues/[leagueId]/psychological-profiles/run-all/route'), 'POST'],
  ['legacy opponent read', () => import('@/server/api-route-modules/legacy/opponent-tendencies/route'), 'GET'],
  ['legacy opponent generate', () => import('@/server/api-route-modules/legacy/opponent-tendencies/route'), 'POST'],
] as const
it.each(modules)('retires %s without reading profiles or generating new ones', async (_name, load, method) => {
  const module = await load() as unknown as Record<string, Function>
  const request = new Request('https://allfantasy.ai/api/profiles?managerId=other&rollup=other', { method })
  const result = await module[method](request, { params: Promise.resolve({ leagueId: 'L', profileId: 'P' }) })
  expect(result.status).toBe(410)
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(await result.json()).toEqual({ error: 'Use Competitive Edge within a league decision.', code: 'PROFILE_SURFACE_RETIRED' })
  expect(engine).not.toHaveBeenCalled()
})
