// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
const session = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`)
})
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))

const deps = vi.hoisted(() => ({
  resolveTenantsForUser: vi.fn(),
  authorizeRead: vi.fn(async () => true),
  readWorkspace: vi.fn(),
  readLeagueFacts: vi.fn(async () => ({ leagues: [{ id: 'L1', name: 'Harbor City', sport: 'NFL' }], snapshots: [], managers: [] })),
  readRecommendationRecord: vi.fn(async () => null as unknown),
}))
vi.mock('@/lib/partner-portal/workspaceDeps', () => ({ portalDeps: deps }))

import PartnerPortalPage from '@/app/partners/portal/page'

const renderPage = async () => render(await PartnerPortalPage())

beforeEach(() => {
  session.mockResolvedValue({ user: { id: 'u1', name: 'Sam' } })
  deps.resolveTenantsForUser.mockReset()
  deps.readWorkspace.mockReset()
  redirect.mockClear()
})
afterEach(() => cleanup())

describe('/partners/portal', () => {
  it('signed out → sign in, and back here', async () => {
    session.mockResolvedValue(null)
    await expect(renderPage()).rejects.toThrow('REDIRECT /login?callbackUrl=%2Fpartners%2Fportal')
    expect(deps.resolveTenantsForUser).not.toHaveBeenCalled()
  })

  it('not in a workspace: says so, offers the demo and a way to ask', async () => {
    deps.resolveTenantsForUser.mockResolvedValue([])
    await renderPage()
    expect(screen.getByRole('heading', { name: "This account isn't part of a partner workspace" })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See the demo' }).getAttribute('href')).toBe('/partners#demo')
  })

  it('tenancy layer unavailable: a calm notice, never an error page', async () => {
    deps.resolveTenantsForUser.mockRejectedValue(new Error('isolation assertion failed'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderPage()
    expect(screen.getByRole('heading', { name: "Partner workspaces aren't switched on yet" })).toBeTruthy()
    spy.mockRestore()
  })

  it('a member with linked leagues sees the workspace, its leagues and its sources', async () => {
    deps.resolveTenantsForUser.mockResolvedValue([{ tenantId: 't-acme', role: 'TENANT_OWNER' }])
    deps.readWorkspace.mockResolvedValue({
      name: 'Acme Fantasy',
      bindings: [{ id: 'b1', leagueId: 'L1', provider: 'sleeper', status: 'IDLE', consecutiveFailures: 0, lastSyncedAt: null, lastErrorAt: null, lastErrorSummary: null }],
    })
    await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Acme Fantasy' })).toBeTruthy()
    expect(document.body.textContent).toContain('Signed in as Owner')
    expect(document.body.textContent).toContain('Harbor City')
    expect(document.body.textContent).toContain('No activity yet')
    expect(document.body.textContent).toContain('Never synced')
  })

  it('the recommendation record: graded counts, a bar with a text legend, and the sample rule', async () => {
    deps.resolveTenantsForUser.mockResolvedValue([{ tenantId: 't-acme', role: 'TENANT_OWNER' }])
    deps.readWorkspace.mockResolvedValue({
      name: 'Acme Fantasy',
      bindings: [{ id: 'b1', leagueId: 'L1', provider: 'sleeper', status: 'OK', consecutiveFailures: 0, lastSyncedAt: new Date(), lastErrorAt: null, lastErrorSummary: null }],
    })
    deps.readRecommendationRecord.mockResolvedValueOnce({
      season: 2026,
      throughWeek: 10,
      bench: { right: 8, wrong: 4, same: 2, gain: 30, pending: 3, unscored: 0, withdrawn: 0 },
      pickups: { graded: 6, startable: 4, vsDrop: 5, beatDrop: 3, lostDrop: 2, pending: 2, noStats: 0 },
      trades: { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 },
      users: {},
    })
    await renderPage()
    expect(screen.getByRole('heading', { name: 'Recommendation record' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '8 recommended player scored more, 2 within a point, 4 benched player scored more' })).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).toContain('14 calls')
    expect(text).toContain('A rate shows once 30 calls are decided (12 now)')
    expect(text).toContain('3 calls are waiting on games.')
    expect(text).toContain('4 of 6')
    expect(text).toContain('3 of 5')
    expect(text).toContain('2026 NFL season, through week 10')
  })

  it('no recommendations yet, and a failed read, are each said plainly', async () => {
    deps.resolveTenantsForUser.mockResolvedValue([{ tenantId: 't-acme', role: 'TENANT_OWNER' }])
    deps.readWorkspace.mockResolvedValue({
      name: 'Acme Fantasy',
      bindings: [{ id: 'b1', leagueId: 'L1', provider: 'sleeper', status: 'OK', consecutiveFailures: 0, lastSyncedAt: new Date(), lastErrorAt: null, lastErrorSummary: null }],
    })
    await renderPage()
    expect(document.body.textContent).toContain('No lineup or pickup recommendations have been given in your linked leagues')
    cleanup()
    deps.readRecommendationRecord.mockRejectedValueOnce(new Error('x'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderPage()
    spy.mockRestore()
    expect(document.body.textContent).toContain("The record couldn't be read just now")
    expect(document.body.textContent).toContain('Harbor City')
  })

  it('a member with no linked leagues is told what happens next', async () => {
    deps.resolveTenantsForUser.mockResolvedValue([{ tenantId: 't-acme', role: 'TENANT_SUPPORT' }])
    deps.readWorkspace.mockResolvedValue({ name: 'Acme Fantasy', bindings: [] })
    await renderPage()
    expect(screen.getByRole('heading', { name: 'No leagues are linked yet' })).toBeTruthy()
  })

  it('🛑 customer-safe language in every state (per text node)', async () => {
    for (const setup of [
      () => deps.resolveTenantsForUser.mockResolvedValue([]),
      () => deps.resolveTenantsForUser.mockRejectedValue(new Error('x')),
      () => {
        deps.resolveTenantsForUser.mockResolvedValue([{ tenantId: 't', role: 'TENANT_OWNER' }])
        deps.readWorkspace.mockResolvedValue({
          name: 'Acme',
          bindings: [{ id: 'b1', leagueId: 'L1', provider: 'sleeper', status: 'OK', consecutiveFailures: 0, lastSyncedAt: new Date(), lastErrorAt: null, lastErrorSummary: null }],
        })
        deps.readRecommendationRecord.mockResolvedValueOnce({
          season: 2026,
          throughWeek: 10,
          bench: { right: 40, wrong: 10, same: 2, gain: 120, pending: 0, unscored: 0, withdrawn: 0 },
          pickups: { graded: 31, startable: 20, vsDrop: 25, beatDrop: 15, lostDrop: 10, pending: 0, noStats: 0 },
          trades: { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 },
          users: {},
        })
      },
    ]) {
      setup()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await renderPage()
      spy.mockRestore()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) expect(n.textContent ?? '').not.toMatch(/\bAI\b/)
      cleanup()
    }
  })
})
