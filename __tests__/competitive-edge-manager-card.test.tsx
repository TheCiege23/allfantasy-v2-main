/**
 * The manager card (2026-11-16, re-score item 11 — Manager Psychology as facts only, paid): its route
 * withholds the record without Competitive Edge, and the sheet draws the record, the lock or the
 * error in the reader's language.
 */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ session: vi.fn(), depth: vi.fn(), load: vi.fn(), language: 'en' }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/core-app/corePaywall', () => ({ resolveCoreDepth: h.depth }))
vi.mock('@/lib/competitive-edge/managerRecordLoader', () => ({ loadLeagueManagerRecords: h.load }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: h.language }) }))

import { GET } from '@/app/api/leagues/[leagueId]/manager-record/route'
import { ManagerRecordSheet } from '@/components/core-app/manager-record/ManagerRecordSheet'
import { buildManagerRecord, type ManagerRecord } from '@/lib/competitive-edge/managerRecord'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

const access = (unlocked: boolean): CoreDepthAccess => ({
  depth: 'competitive_edge',
  unlocked,
  hasPlan: unlocked,
  preLaunchFree: false,
  startsAt: '2026-10-15T00:00:00.000Z',
  planName: 'AF Pro',
  label: 'Competitive Edge',
  upgradePath: '/upgrade?plan=pro',
})

const side = (ownerId: string, inPos: string, outPos: string) => ({ ownerId, playersIn: [{ position: inPos }], playersOut: [{ position: outPos }], picksIn: [], picksOut: [] })
const RECORD: ManagerRecord = buildManagerRecord({
  manager: { name: 'Mike', teamExternalId: '3', ownerId: 'mike' },
  viewerOwnerId: null,
  trades: {
    available: true,
    data: {
      trades: [1, 2, 3].map((i) => ({ id: `t${i}`, season: '2026', week: i, createdIso: `2026-09-0${i}T00:00:00Z`, sides: [side('mike', 'WR', 'RB'), side('sam', 'RB', 'WR')] })),
      seasonsScanned: ['2026'], historyGaps: [], asOf: '2026-11-15T00:00:00Z', stale: false,
    },
  },
  waivers: { available: true, data: { season: 2026, usesFaab: true, claims: [], faabRemaining: 61, asOf: null, stale: false } },
  drafts: { available: false, reason: "Competitive Edge reads Sleeper draft history today. ESPN leagues aren't connected yet." },
})

function req(team: string | null) {
  const url = new URL('https://x.test/api/leagues/L1/manager-record' + (team ? `?team=${team}` : ''))
  return { nextUrl: url } as never
}
const params = { params: Promise.resolve({ leagueId: 'L1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.language = 'en'
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.depth.mockResolvedValue(access(true))
  h.load.mockResolvedValue({ available: true, data: { league: { id: 'L1', name: 'X', platform: 'sleeper' }, viewerTeamExternalId: '1', records: [RECORD] } })
})

describe('GET /api/leagues/[leagueId]/manager-record', () => {
  it('🛑 without the plan: the lock and NO record, and the history is never read', async () => {
    h.depth.mockResolvedValue(access(false))
    const res = await GET(req('3'), params)
    const body = await res.json()
    expect(body.locked).toBe(true)
    expect(body.record).toBeUndefined()
    expect(h.load).not.toHaveBeenCalled()
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('with the plan: the one team’s record, read through the membership-checking loader', async () => {
    const res = await GET(req('3'), params)
    const body = await res.json()
    expect(body.locked).toBe(false)
    expect(body.record.manager.name).toBe('Mike')
    expect(h.load).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1', teamExternalId: '3' })
  })

  it('signed out is 401; no team is 400; a refused league is 404 with the loader’s reason', async () => {
    h.session.mockResolvedValueOnce(null)
    expect((await GET(req('3'), params)).status).toBe(401)
    expect((await GET(req(null), params)).status).toBe(400)
    h.load.mockResolvedValueOnce({ available: false, reason: 'Manager records are read only for a league you are in.' })
    const refused = await GET(req('3'), params)
    expect(refused.status).toBe(404)
    expect((await refused.json()).error).toBe('Manager records are read only for a league you are in.')
  })
})

function sheet(fetcher: typeof fetch) {
  return render(
    <ManagerRecordSheet leagueId="L1" teamExternalId="3" managerName="Mike" onClose={() => {}} openerRef={{ current: null }} fetcher={fetcher} />,
  )
}
const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('ManagerRecordSheet', () => {
  it('draws the record: every section from the builders, and a section that could not be read says why', async () => {
    await act(async () => {
      sheet(json({ locked: false, access: access(true), record: RECORD }))
    })
    expect(await screen.findByText('Mike took on a WR in 3 of their 3 trades and sent one away in none.')).toBeTruthy()
    expect(screen.getByText('Mike has $61 of FAAB left.')).toBeTruthy()
    expect(screen.getByText("Competitive Edge reads Sleeper draft history today. ESPN leagues aren't connected yet.")).toBeTruthy()
    expect(screen.getByText(/It says nothing about what they will do/)).toBeTruthy()
  })

  it('draws the lock card (with its upgrade link) for a viewer without the plan', async () => {
    await act(async () => {
      sheet(json({ locked: true, access: access(false) }))
    })
    expect(await screen.findByTestId('core-lock-competitive_edge')).toBeTruthy()
    expect(document.querySelector('a.af-core-lock-cta')?.getAttribute('href')).toContain('/upgrade?plan=pro')
  })

  it('an error says so, never an empty record', async () => {
    await act(async () => {
      sheet(json({ error: 'Manager records are read only for a league you are in.' }, 404))
    })
    expect((await screen.findByRole('alert')).textContent).toBe('Manager records are read only for a league you are in.')
  })

  it('Spanish: the new trade-record lines and the section titles translate', async () => {
    h.language = 'es'
    await act(async () => {
      sheet(json({ locked: false, access: access(true), record: RECORD }))
    })
    expect(await screen.findByText('Mike adquirió un WR en 3 de sus 3 intercambios y no cedió ninguno.')).toBeTruthy()
    expect(screen.getByText('Intercambios')).toBeTruthy()
    expect(screen.getByText('Competitive Edge utiliza el historial de drafts de Sleeper. Las ligas de ESPN todavía no están conectadas.')).toBeTruthy()
  })
})
