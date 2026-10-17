/**
 * world-cup-intro-gate.test.tsx
 *
 * Tests for WorldCupIntroGate — the client-side guard that ensures the World
 * Cup intro video plays before any /brackets/world-cup/** page is shown.
 *
 * Strategy
 * ────────
 * WorldCupIntroExperience is mocked globally so these tests are pure gate-logic
 * tests (not video rendering tests). The mock captures the `onComplete` callback
 * so tests can trigger the "intro done" transition without playing real video.
 *
 * next/dynamic is mocked with React.lazy so the captured component resolves
 * inside `await act(async () => {})` without real network requests.
 *
 * See also: world-cup-intro-experience.test.tsx for component-level tests.
 */

import React, { Suspense } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Capture onComplete prop passed to the experience ──────────────────────────

const introCapture = vi.hoisted(() => ({
  onComplete: undefined as (() => void) | undefined,
  nextDest: undefined as string | undefined,
}))

// ── Mock WorldCupIntroExperience with a controllable stub ─────────────────────

vi.mock('@/components/world-cup/WorldCupIntroExperience', () => ({
  default: function MockWorldCupIntroExperience({
    onComplete,
    nextDest,
  }: {
    onComplete?: () => void
    nextDest?: string
  }) {
    introCapture.onComplete = onComplete
    introCapture.nextDest = nextDest
    return (
      <div data-testid="wc-intro-experience">
        <button data-testid="wc-intro-skip" onClick={onComplete}>
          Skip intro
        </button>
      </div>
    )
  },
}))

// ── Mock next/dynamic with React.lazy so async resolution works in tests ──────

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) => React.lazy(loader),
}))

// ── Mock next/navigation ──────────────────────────────────────────────────────

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}))

const pathnameMock = vi.hoisted(() => ({ value: '/brackets/world-cup' }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => pathnameMock.value,
  useSearchParams: () => searchParamsMock.value,
}))

// ── matchMedia stub (jsdom doesn't implement it) ──────────────────────────────

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// ── sessionStorage helpers ────────────────────────────────────────────────────

const SESSION_KEY = 'af_world_cup_intro_seen'
const setIntroSeen = () => sessionStorage.setItem(SESSION_KEY, 'true')
const clearIntroSeen = () => sessionStorage.removeItem(SESSION_KEY)
const isIntroSeen = () => sessionStorage.getItem(SESSION_KEY) === 'true'

// ── Helper: render gate inside required Suspense boundary ─────────────────────

async function renderGate(children: React.ReactNode) {
  const { WorldCupIntroGate } = await import('@/components/world-cup/WorldCupIntroGate')
  await act(async () => {
    render(
      <Suspense fallback={<div data-testid="suspense-loading" />}>
        <WorldCupIntroGate>{children}</WorldCupIntroGate>
      </Suspense>
    )
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorldCupIntroGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearIntroSeen()
    introCapture.onComplete = undefined
    introCapture.nextDest = undefined
    pathnameMock.value = '/brackets/world-cup'
    searchParamsMock.value = new URLSearchParams()
  })

  afterEach(() => {
    clearIntroSeen()
  })

  // ── First visit ─────────────────────────────────────────────────────────────

  it('first visit (no session key) shows intro before bracket content', async () => {
    await renderGate(<div data-testid="bracket-hub">Bracket Hub</div>)

    // Intro must be visible
    expect(screen.getByTestId('wc-intro-experience')).toBeTruthy()
    // Bracket content must be hidden
    expect(screen.queryByTestId('bracket-hub')).toBeNull()
  })

  it('gate passes nextDest prop as current pathname to the intro experience', async () => {
    pathnameMock.value = '/brackets/world-cup/create'
    await renderGate(<div data-testid="bracket-hub">Hub</div>)

    expect(introCapture.nextDest).toBe('/brackets/world-cup/create')
  })

  // ── Returning visit ─────────────────────────────────────────────────────────

  it('returning visit (session key already set) passes through to bracket content', async () => {
    setIntroSeen()
    await renderGate(<div data-testid="bracket-hub">Bracket Hub</div>)

    expect(screen.getByTestId('bracket-hub')).toBeTruthy()
    expect(screen.queryByTestId('wc-intro-experience')).toBeNull()
  })

  // ── onComplete transition ───────────────────────────────────────────────────

  it('clicking Skip (onComplete) reveals bracket content', async () => {
    await renderGate(<div data-testid="bracket-hub">Bracket Hub</div>)

    // Intro is showing; bracket is not
    expect(screen.getByTestId('wc-intro-experience')).toBeTruthy()
    expect(screen.queryByTestId('bracket-hub')).toBeNull()

    // Click skip → triggers onComplete → gate transitions to pass
    await act(async () => { fireEvent.click(screen.getByTestId('wc-intro-skip')) })

    expect(screen.getByTestId('bracket-hub')).toBeTruthy()
    expect(screen.queryByTestId('wc-intro-experience')).toBeNull()
  })

  it('calling onComplete programmatically reveals bracket content and hides intro', async () => {
    await renderGate(<div data-testid="bracket-hub">Bracket Hub</div>)

    await act(async () => { introCapture.onComplete?.() })

    expect(screen.getByTestId('bracket-hub')).toBeTruthy()
    expect(screen.queryByTestId('wc-intro-experience')).toBeNull()
  })

  it('session key is set before bracket content appears (intro sets it)', async () => {
    await renderGate(<div data-testid="bracket-hub">Bracket Hub</div>)

    // Manually set session key (simulates what WorldCupIntroExperience.advance() does)
    sessionStorage.setItem(SESSION_KEY, 'true')
    await act(async () => { introCapture.onComplete?.() })

    expect(isIntroSeen()).toBe(true)
    expect(screen.getByTestId('bracket-hub')).toBeTruthy()
  })

  // ── Force replay ────────────────────────────────────────────────────────────

  it('?force=1 clears session key and shows intro even when already seen', async () => {
    setIntroSeen()
    searchParamsMock.value = new URLSearchParams('force=1')

    await renderGate(<div data-testid="bracket-hub">Bracket Hub</div>)

    // Session key cleared by force mode
    expect(isIntroSeen()).toBe(false)
    // Intro is showing; bracket is not
    expect(screen.getByTestId('wc-intro-experience')).toBeTruthy()
    expect(screen.queryByTestId('bracket-hub')).toBeNull()
  })

  it('?force=1 with clean session also shows intro', async () => {
    searchParamsMock.value = new URLSearchParams('force=1')

    await renderGate(<div data-testid="bracket-hub">Bracket Hub</div>)

    expect(screen.getByTestId('wc-intro-experience')).toBeTruthy()
  })

  // ── Sub-routes ──────────────────────────────────────────────────────────────

  it('gate applies to sub-route /brackets/world-cup/create (first visit)', async () => {
    pathnameMock.value = '/brackets/world-cup/create'
    await renderGate(<div data-testid="create-page">Create Page</div>)

    expect(screen.getByTestId('wc-intro-experience')).toBeTruthy()
    expect(screen.queryByTestId('create-page')).toBeNull()
  })

  it('gate passes through on sub-route when already seen', async () => {
    setIntroSeen()
    pathnameMock.value = '/brackets/world-cup/discover'
    await renderGate(<div data-testid="discover-page">Discover Page</div>)

    expect(screen.getByTestId('discover-page')).toBeTruthy()
    expect(screen.queryByTestId('wc-intro-experience')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('WorldCupIntroGate — static analysis', () => {
  it('layout.tsx wraps WorldCupIntroGate + Suspense for all /brackets/world-cup routes', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'app/brackets/world-cup/layout.tsx'),
      'utf-8'
    )
    expect(src).toContain('WorldCupIntroGate')
    expect(src).toContain('Suspense')
    expect(src).toContain("children: React.ReactNode")
  })

  it('WorldCupIntroGate uses sessionStorage key af_world_cup_intro_seen', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'components/world-cup/WorldCupIntroGate.tsx'),
      'utf-8'
    )
    expect(src).toContain("'af_world_cup_intro_seen'")
  })

  it('WorldCupIntroGate accepts ?force=1 to replay the intro', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'components/world-cup/WorldCupIntroGate.tsx'),
      'utf-8'
    )
    expect(src).toContain("force")
    expect(src).toContain("sessionStorage.removeItem")
  })

  it('brackets hub page has no World Cup CTAs, so none can bypass the intro gate', () => {
    // This used to assert the hub's WC CTAs pointed at /brackets/world-cup, the
    // gated layout. On 2026-10-01 the owner switched the World Cup off as a hub
    // destination (the tournament ended in July), so the hub now links into NO
    // World Cup route at all — the stronger form of "nothing skips the gate".
    // brackets-hub-restore.test.ts pins the same decision from the hub's side.
    const src = readFileSync(resolve(process.cwd(), 'app/brackets/page.tsx'), 'utf-8')
    expect(src).not.toMatch(/href(=|:\s*)"\/brackets\/world-cup/)
  })

  it('video path in WorldCupIntroExperience is /videos/brackets/world-cup/af-world-cup-hero.mp4', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'components/world-cup/WorldCupIntroExperience.tsx'),
      'utf-8'
    )
    expect(src).toContain('/videos/brackets/world-cup/af-world-cup-hero.mp4')
    expect(src).not.toContain('"/videos/world-cup/af-world-cup-hero.mp4"')
  })

  it('WorldCupIntroExperience has muted, autoPlay, playsInline, preload=auto', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'components/world-cup/WorldCupIntroExperience.tsx'),
      'utf-8'
    )
    expect(src).toMatch(/autoPlay/)
    expect(src).toMatch(/\bmuted\b/)
    expect(src).toMatch(/playsInline/)
    expect(src).toMatch(/preload="auto"/)
  })

  it('WorldCupIntroExperience accepts nextDest prop for gate embedding', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'components/world-cup/WorldCupIntroExperience.tsx'),
      'utf-8'
    )
    expect(src).toContain('nextDest')
    expect(src).toContain('onComplete')
  })
})
