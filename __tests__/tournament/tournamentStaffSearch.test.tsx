/**
 * Adding Tournament staff used to need a raw user UUID typed into a monospace box. The commissioner now
 * searches by name: players already in the tournament match on part of their name or username, anyone
 * else only on their exact username. The creator and people already on staff are never offered.
 */
import React from 'react'
import { NextRequest } from 'next/server'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: { user: { id: 'creator' } } as { user: { id: string } } | null,
  prisma: {
    legacyTournament: { findUnique: vi.fn() },
    legacyTournamentParticipant: { findMany: vi.fn() },
    legacyTournamentStaff: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    appUser: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/tournament/legacyTournamentAccess', () => ({
  getLegacyTournamentAccess: vi.fn(async () => ({ isCreator: true })),
  canManageStaff: (a: { isCreator?: boolean }) => Boolean(a?.isCreator),
}))
vi.mock('@/components/i18n/LanguageProviderClient', async (orig) => {
  const real = await orig<typeof import('@/components/i18n/LanguageProviderClient')>()
  const { translations } = await import('@/lib/i18n/translations')
  const en = (translations as unknown as Record<string, Record<string, string>>).en ?? {}
  const t = (k: string) => en[k] ?? k
  const value = () => ({ language: 'en', setLanguage: () => {}, t, tInterpolate: t })
  return { ...real, useLanguage: value, useOptionalLanguage: value }
})

import { GET } from '@/app/api/tournament/[tournamentId]/staff/route'
import { TournamentMembersPanel } from '@/components/tournament/TournamentCommissionerDashboard'

const params = { params: Promise.resolve({ tournamentId: 't1' }) }
const get = (q?: string) => GET(new NextRequest(`http://x/api/tournament/t1/staff${q == null ? '' : `?q=${encodeURIComponent(q)}`}`), params)

beforeEach(() => {
  m.session = { user: { id: 'creator' } }
  m.prisma.legacyTournament.findUnique.mockResolvedValue({ creatorId: 'creator' })
  m.prisma.legacyTournamentParticipant.findMany.mockResolvedValue([{ userId: 'u-jo' }, { userId: 'u-staff' }, { userId: 'creator' }])
  m.prisma.legacyTournamentStaff.findMany.mockResolvedValue([{ userId: 'u-staff', permissions: {}, id: 's1', createdAt: new Date(0), user: { username: 'stf', displayName: 'Staffer' } }])
  m.prisma.appUser.findMany.mockResolvedValue([
    { id: 'u-jo', username: 'jojo', displayName: 'Joanna Park', avatarUrl: null },
    { id: 'u-staff', username: 'jostaff', displayName: 'Jo Staff', avatarUrl: null },
    { id: 'creator', username: 'jocreator', displayName: 'Jo Creator', avatarUrl: null },
    { id: 'u-out', username: 'jo', displayName: 'Outside Jo', avatarUrl: null },
  ])
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('staff search route', () => {
  it('finds players by part of their name and anyone else by exact username, never the creator or current staff', async () => {
    const res = await get('jo')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.candidates).toEqual([
      { userId: 'u-jo', displayName: 'Joanna Park', username: 'jojo', avatarUrl: null, inTournament: true },
      { userId: 'u-out', displayName: 'Outside Jo', username: 'jo', avatarUrl: null, inTournament: false },
    ])
    const where = m.prisma.appUser.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { id: { in: ['u-jo', 'u-staff', 'creator'] }, OR: [
        { username: { contains: 'jo', mode: 'insensitive' } },
        { displayName: { contains: 'jo', mode: 'insensitive' } },
      ] },
      { username: { equals: 'jo', mode: 'insensitive' } },
    ])
  })

  it('a one-letter search returns nobody and reads no users', async () => {
    const body = await (await get('j')).json()
    expect(body.candidates).toEqual([])
    expect(m.prisma.appUser.findMany).not.toHaveBeenCalled()
  })

  it('only the creator can search', async () => {
    m.session = null
    expect((await get('jo')).status).toBe(401)
  })

  it('without a search it still lists the staff', async () => {
    const body = await (await get()).json()
    expect(body.staff.map((s: { displayName: string }) => s.displayName)).toEqual(['Staffer'])
    expect(body.candidates).toBeUndefined()
  })
})

describe('Members tab staff form', () => {
  it('searches by name and adds the chosen person — no user ID box anywhere', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const json = url.includes('/waitlist') ? { entries: [] }
        : url.includes('?q=') ? { candidates: [{ userId: 'u-jo', displayName: 'Joanna Park', username: 'jojo', avatarUrl: null, inTournament: true }] }
        : { staff: [] }
      return { ok: true, json: async () => json } as Response
    }))
    render(<TournamentMembersPanel tournamentId="t1" isCreator onRefreshSummary={() => {}} />)
    await screen.findByText('No staff assigned yet.')
    expect(screen.queryByPlaceholderText('User UUID')).toBeNull()
    expect(document.body.textContent).not.toMatch(/user ID|UUID/i)

    const box = screen.getByRole('searchbox', { name: 'Find a person' })
    fireEvent.change(box, { target: { value: 'jo' } })
    const pick = await screen.findByRole('button', { name: /Joanna Park/ })
    expect(pick.textContent).toContain('@jojo')
    expect(pick.textContent).toContain('In this tournament')
    expect(calls.some(c => c.url === '/api/tournament/t1/staff?q=jo')).toBe(true)

    const add = screen.getByRole('button', { name: 'Add staff' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.click(pick)
    expect(screen.getByText('Joanna Park')).toBeTruthy()
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() => expect(calls.some(c => c.init?.method === 'POST')).toBe(true))
    const post = calls.find(c => c.init?.method === 'POST')!
    expect(JSON.parse(String(post.init!.body)).assigneeUserId).toBe('u-jo')
  })

  it('says how to find someone who is not a player when nothing matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, json: async () => (url.includes('/waitlist') ? { entries: [] } : url.includes('?q=') ? { candidates: [] } : { staff: [] }),
    }) as Response))
    render(<TournamentMembersPanel tournamentId="t1" isCreator onRefreshSummary={() => {}} />)
    await screen.findByText('No staff assigned yet.')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a person' }), { target: { value: 'zed' } })
    await screen.findByText('No one matches. Someone outside the tournament needs their exact username.')
  })
})
