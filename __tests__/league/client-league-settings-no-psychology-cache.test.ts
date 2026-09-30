// @vitest-environment node
/**
 * Milestone 32: manager characterisation labels are shown to NOBODY.
 *
 * The retired power-rankings "psychology" job wrote an archetype, trait scores, a blind spot and a
 * negotiation style for any manager a viewer expanded into `League.settings.psychologyCache[rosterId]`
 * (+ `psychologyCachedAt`). The writer is gone and nothing reads the keys, but rows written before
 * 2026-09-10 still carry them, and `/api/league/list` (without `summary=1`) hands every league's
 * `settings` to every member — so the labels were one DevTools tab away.
 *
 * This pins the READ-SIDE strip. The stored rows are untouched on purpose: deleting production data
 * is the owner's decision.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
  rawResult: null as null | (() => unknown),
}))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) => (method === 'count' ? 0 : method === 'findMany' || method === 'groupBy' ? [] : null)
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            const answer = db.answers[`${name}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === '$queryRaw') return vi.fn(async () => (db.rawResult ? db.rawResult() : []))
        if (key === 'then') return undefined
        return model(key)
      },
    },
  )
  return { prisma, default: prisma }
})

import { clientLeagueSettings, withClientLeagueSettings } from '@/lib/league/clientLeagueSettings'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'

const LABELS = {
  psychologyCache: { '3': { archetype: 'Shark', blindSpot: 'Overpays for RBs' } },
  psychologyCachedAt: '2026-09-01T00:00:00.000Z',
}

describe('clientLeagueSettings', () => {
  it('drops the psychology keys and keeps every other key', () => {
    const out = clientLeagueSettings({ entry_fee_usd: 25, lineupLockRule: 'game', ...LABELS })
    expect(out).toEqual({ entry_fee_usd: 25, lineupLockRule: 'game' })
    expect(JSON.stringify(out)).not.toMatch(/Shark|psychology/)
  })

  it('returns the same object when there is nothing to strip, and passes non-objects through', () => {
    const clean = { a: 1 }
    expect(clientLeagueSettings(clean)).toBe(clean)
    expect(clientLeagueSettings(null)).toBeNull()
    expect(clientLeagueSettings([1, 2])).toEqual([1, 2])
    expect(clientLeagueSettings('x')).toBe('x')
  })

  it('does not mutate the stored object it was given', () => {
    const stored = { a: 1, ...LABELS }
    clientLeagueSettings(stored)
    expect(stored).toHaveProperty('psychologyCache')
  })

  it('withClientLeagueSettings strips a league row’s settings and keeps its other fields', () => {
    const out = withClientLeagueSettings({ id: 'L1', name: 'N', settings: { a: 1, ...LABELS } })
    expect(out).toEqual({ id: 'L1', name: 'N', settings: { a: 1 } })
  })
})

const USER = 'user-1'
const leagueRow = (id: string) => ({
  id,
  userId: USER,
  name: `League ${id}`,
  sport: 'NFL',
  leagueVariant: null,
  platform: 'allfantasy',
  platformLeagueId: null,
  leagueSize: 12,
  season: 2026,
  status: 'in_season',
  rosters: [],
  redraftMembers: [],
  teams: [],
  leagueSettings: null,
})

describe('/api/league/list data — the dashboard league list never carries psychologyCache', () => {
  beforeEach(() => {
    db.rawResult = null
    db.answers = {
      'league.findMany': (args) =>
        args?.select?.settings === true && args?.where?.id?.in
          ? [{ id: 'L1', settings: { entry_fee_usd: 25, ...LABELS } }]
          : [leagueRow('L1')],
    }
  })

  it('slim read: settings keep their facts and lose the labels', async () => {
    db.rawResult = () => [{ id: 'L1', settings: { entry_fee_usd: 25, ...LABELS } }]
    const { leagues } = (await getDashboardLeagueListForUser(USER)) as { leagues: any[] }
    const l1 = leagues.find((l) => l.id === 'L1')
    // Positive control: settings made it through, and a fact derived from them still derives.
    expect(l1.settings).toEqual({ entry_fee_usd: 25 })
    expect(l1.isPaid).toBe(true)
    expect(JSON.stringify(leagues)).not.toMatch(/psychologyCache|psychologyCachedAt|Shark/)
  })

  it('fallback read (slim read failed): same strip on the full column', async () => {
    db.rawResult = () => {
      throw new Error('boom')
    }
    const { leagues } = (await getDashboardLeagueListForUser(USER)) as { leagues: any[] }
    const l1 = leagues.find((l) => l.id === 'L1')
    expect(l1.settings).toEqual({ entry_fee_usd: 25 })
    expect(JSON.stringify(leagues)).not.toMatch(/psychologyCache|Shark/)
  })
})
