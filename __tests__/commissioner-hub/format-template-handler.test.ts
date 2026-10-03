import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const db = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(async () => []), league: { findUnique: vi.fn(), update: vi.fn(async () => ({})) } }
  return {
    tx,
    prisma: {
      league: { findUnique: vi.fn() },
      leagueTeam: { count: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))

import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/leagues/[leagueId]/commissioner-template/handler'
import { readCommissionerTemplatePin } from '@/lib/commissioner-os/profile/templatePin'
import { latestVersionOf } from '@/lib/commissioner-os/template/registry'

/*
 * The first writer of a Commissioner OS template pin. Owner-only, and the offer is recomputed on the
 * server, so a request cannot pin a template the league does not fit.
 */

const EFL = 'efl_promotion_relegation_dynasty'
const SETTINGS = { publicStandings: true, conceptRules: { concept: 'dynasty', version: 1, extensions: { aliasTags: ['efl'] } } }
const LEAGUE = { id: 'L1', userId: 'owner', platform: 'sleeper', sport: 'NFL', isDynasty: true, leagueType: 'dynasty', settings: SETTINGS }

const call = (templateId: unknown) =>
  PATCH(
    new NextRequest('http://localhost/api/leagues/L1/commissioner-template', { method: 'PATCH', body: JSON.stringify({ templateId }) }),
    { params: Promise.resolve({ leagueId: 'L1' }) },
  )
const writtenSettings = () => db.tx.league.update.mock.calls.at(-1)?.[0]?.data?.settings

beforeEach(() => {
  vi.clearAllMocks()
  getServerSession.mockResolvedValue({ user: { id: 'owner' } })
  db.prisma.league.findUnique.mockResolvedValue(LEAGUE)
  db.prisma.leagueTeam.count.mockResolvedValue(32)
  db.tx.league.findUnique.mockResolvedValue({ settings: SETTINGS })
})

describe('PATCH commissioner-template', () => {
  it('pins EFL for the owner of a league it fits, under the row lock, keeping the rest of settings', async () => {
    const res = await call(EFL)
    expect(res.status).toBe(200)
    expect(db.tx.$queryRaw).toHaveBeenCalledTimes(1)
    const next = writtenSettings()
    expect(readCommissionerTemplatePin(next)).toEqual({ id: EFL, version: latestVersionOf(EFL)!.version })
    expect(next.publicStandings).toBe(true)
    expect(next.conceptRules.extensions.aliasTags).toEqual(['efl'])
  })

  it('removes the pin', async () => {
    db.tx.league.findUnique.mockResolvedValue({ settings: { conceptRules: { extensions: { commissionerTemplate: { id: EFL, version: '1.2.0' } } } } })
    const res = await call(null)
    expect(res.status).toBe(200)
    expect(readCommissionerTemplatePin(writtenSettings())).toBeNull()
  })

  it('refuses anyone but the owner — a co-commissioner included', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'co-commissioner' } })
    expect((await call(EFL)).status).toBe(403)
    expect(db.tx.league.update).not.toHaveBeenCalled()
  })

  it('refuses without a session', async () => {
    getServerSession.mockResolvedValue(null)
    expect((await call(EFL)).status).toBe(401)
  })

  it('refuses a template the league does not fit, whatever the client sends', async () => {
    db.prisma.leagueTeam.count.mockResolvedValue(12)
    expect((await call(EFL)).status).toBe(400)
    db.prisma.leagueTeam.count.mockResolvedValue(32)
    expect((await call('survivor_all_stars_guillotine')).status).toBe(400)
    expect((await call('not_a_template')).status).toBe(400)
    expect((await call(42)).status).toBe(400)
    expect(db.tx.league.update).not.toHaveBeenCalled()
  })
})
