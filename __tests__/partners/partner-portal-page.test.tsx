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
