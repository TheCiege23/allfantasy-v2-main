// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The dashboard league list reads `settings` WITHOUT `identity_mappings`.
 *
 * 🛑 WHY. `identity_mappings` is ~98% of this list's payload and nothing that reads the list uses it.
 * Measured read-only on the test database 2026-09-26: 13.5 MB across 229 leagues, up to 211 KB for one
 * league. The full `getDashboardLeagueListForUser` for the heaviest account went from 5.4 MB to 2.1 MB,
 * and its output was byte-identical once that one key was removed from the old side (sorted-key
 * SHA-256, both sides `20c8df5fa413b516`). It is the first serial read of every /core render.
 *
 * These pin the three things that make that safe: the membership query no longer hauls the column,
 * the slim read is merged back BEFORE anything derived from settings (entry fee → `isPaid`), and a
 * failed slim read falls back to the full column rather than to no settings at all.
 */

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
  calls: [] as Array<{ key: string; args: any }>,
  rawCalls: [] as Array<{ sql: string; values: unknown[] }>,
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
            db.calls.push({ key: `${name}.${method}`, args })
            const answer = db.answers[`${name}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === '$queryRaw') {
          return vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            db.rawCalls.push({ sql: strings.join('?'), values })
            return db.rawResult ? db.rawResult() : []
          })
        }
        if (key === 'then') return undefined
        return model(key)
      },
    },
  )
  return { prisma, default: prisma }
})

import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'

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

beforeEach(() => {
  db.calls = []
  db.rawCalls = []
  db.rawResult = null
  db.answers = {
    // The membership query, as the database answers it: no `settings` selected, so none returned.
    'league.findMany': (args) =>
      args?.select?.settings === true && args?.where?.id?.in
        ? // the fallback read of the full column
          [{ id: 'paid', settings: { entry_fee_usd: 25, identity_mappings: ['big'] } }, { id: 'free', settings: {} }]
        : [leagueRow('paid'), leagueRow('free')],
  }
})

const membershipCall = () =>
  db.calls.find((c) => c.key === 'league.findMany' && c.args?.where?.AND)!

describe('dashboard league list — slim settings', () => {
  it('🛑 the membership query no longer selects the settings column', async () => {
    await getDashboardLeagueListForUser(USER)
    expect(membershipCall(), 'membership query not found — the matcher is blind').toBeTruthy()
    expect(membershipCall().args.select).not.toHaveProperty('settings')
  })

  it('reads settings minus identity_mappings, guarded against non-object jsonb, for exactly the listed ids', async () => {
    db.rawResult = () => [
      { id: 'paid', settings: { entry_fee_usd: 25 } },
      { id: 'free', settings: {} },
    ]
    await getDashboardLeagueListForUser(USER)
    expect(db.rawCalls).toHaveLength(1)
    const { sql, values } = db.rawCalls[0]
    expect(sql).toMatch(/-\s*'identity_mappings'/)
    expect(sql).toMatch(/jsonb_typeof\(settings::jsonb\)\s*=\s*'object'/)
    expect(values).toEqual([['paid', 'free']])
  })

  it('🛑 merges settings back BEFORE deriving from them — a paid league still reads as paid', async () => {
    db.rawResult = () => [
      { id: 'paid', settings: { entry_fee_usd: 25 } },
      { id: 'free', settings: {} },
    ]
    const { leagues } = (await getDashboardLeagueListForUser(USER)) as { leagues: any[] }
    const paid = leagues.find((l) => l.id === 'paid')
    expect(paid.settings).toEqual({ entry_fee_usd: 25 })
    expect(paid.isPaid).toBe(true)
    expect(paid.entryFee).toBe(25)
    expect(leagues.find((l) => l.id === 'free').isPaid).toBe(false)
  })

  it('🛑 a failed slim read falls back to the FULL column, never to missing settings', async () => {
    db.rawResult = () => {
      throw new Error('boom')
    }
    const { leagues } = (await getDashboardLeagueListForUser(USER)) as { leagues: any[] }
    expect(leagues.find((l) => l.id === 'paid').isPaid).toBe(true)
    const fallback = db.calls.find((c) => c.key === 'league.findMany' && c.args?.where?.id?.in)
    expect(fallback?.args).toEqual({ where: { id: { in: ['paid', 'free'] } }, select: { id: true, settings: true } })
  })
})

/*
 * `rosterDetail: 'count'` — the /core page's opt-in. Measured on the test DB 2026-09-26 for the heaviest
 * account: 2,051 KB → 1,000 KB and ~530 ms → ~260 ms warm, with the output identical once `rosters` is
 * removed from both sides (sorted-key sha256 7032c9273c3c2bb1) and the same 906 roster rows counted.
 */
describe('dashboard league list — rosterDetail', () => {
  it('🛑 the default still returns every roster with its playerData — eleven callers read it', async () => {
    await getDashboardLeagueListForUser(USER)
    expect(membershipCall().args.select.rosters).toEqual({
      select: { id: true, platformUserId: true, playerData: true, faabRemaining: true },
    })
  })

  it("🛑 'count' selects roster ids only", async () => {
    await getDashboardLeagueListForUser(USER, { rosterDetail: 'count' })
    expect(membershipCall().args.select.rosters).toEqual({ select: { id: true } })
  })

  it("'count' keeps the team-count fallback, which is the only thing the loader reads rosters for", async () => {
    db.answers['league.findMany'] = (args) =>
      args?.where?.id?.in
        ? []
        : [{ ...leagueRow('sized'), leagueSize: null, rosters: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] }]
    const { leagues } = (await getDashboardLeagueListForUser(USER, { rosterDetail: 'count' })) as { leagues: any[] }
    expect(leagues.find((l) => l.id === 'sized').teamCount).toBe(3)
  })
})

