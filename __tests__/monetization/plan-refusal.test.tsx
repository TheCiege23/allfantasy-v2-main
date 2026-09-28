import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * From Oct 15 the cost gate answers a free user with
 *   403 { error: 'Premium feature', code: 'feature_not_entitled', message, requiredPlan, upgradePath }
 * and the Chimmy tool screens printed `error` — the bare words "Premium feature", no way forward.
 * Every one of them now shows the server's sentence and the button that fixes it.
 */

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('next/image', () => ({ __esModule: true, default: () => null }))

import { PlanRefusalError, readPlanRefusal, refusalOf } from '@/lib/monetization/planRefusal'
import { PlanRefusalNotice } from '@/components/monetization/PlanRefusalNotice'
import { AIToolModalShell } from '@/components/ai-tools/AIToolModalShell'
import { StartSitModal } from '@/components/ai-tools/modals/StartSitModal'
import { MatchupAiAnalysisPanel } from '@/components/matchup-center/MatchupAiAnalysisPanel'
import { useLeagueMatchupAi } from '@/hooks/useLeagueMatchupAi'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'

const LOCKED = {
  error: 'Premium feature',
  code: 'feature_not_entitled',
  message: 'Start/sit analysis is part of AF Pro. Your leagues, scores and the basics stay free.',
  requiredPlan: 'AF Pro',
  upgradePath: '/upgrade?plan=pro&feature=pro_start_sit',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('readPlanRefusal', () => {
  it('a plan refusal: the server sentence, and a button to the plan that unlocks it', () => {
    expect(readPlanRefusal(403, LOCKED)).toEqual({
      kind: 'plan',
      message: LOCKED.message,
      actionHref: '/upgrade?plan=pro&feature=pro_start_sit',
      actionLabel: 'See AF Pro',
    })
  })

  it('never shows the bare code, even when the server sends nothing else', () => {
    const r = readPlanRefusal(403, { error: 'Premium feature' })!
    expect(r).toMatchObject({ kind: 'plan', actionHref: '/pricing', actionLabel: 'See plans' })
    expect(r.message).not.toBe('Premium feature')
  })

  it('a server-supplied link can only point inside the app', () => {
    for (const bad of ['https://evil.example/pay', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      expect(readPlanRefusal(403, { ...LOCKED, upgradePath: bad })!.actionHref).toBe('/pricing')
    }
  })

  it("today's limit: an upgrade button for a free user, none for someone who already pays", () => {
    const free = readPlanRefusal(429, { code: 'daily_limit_reached', message: "You've reached today's limit.", upgradePath: '/pricing' })
    expect(free).toMatchObject({ kind: 'daily_limit', actionHref: '/pricing', actionLabel: 'See plans' })
    const paid = readPlanRefusal(429, { code: 'daily_limit_reached', message: "You've reached today's limit.", upgradePath: null })
    expect(paid).toMatchObject({ kind: 'daily_limit', actionHref: null, actionLabel: null })
  })

  it('signed out: sign in and come back here', () => {
    const r = readPlanRefusal(401, { code: 'sign_in_required', message: 'Sign in to use Trade Finder.' }, { returnTo: '/trade-finder?x=1' })
    expect(r).toMatchObject({ kind: 'sign_in', actionHref: '/login?callbackUrl=%2Ftrade-finder%3Fx%3D1', actionLabel: 'Sign in' })
  })

  it('anything else is not a refusal', () => {
    expect(readPlanRefusal(500, { error: 'boom' })).toBeNull()
    expect(readPlanRefusal(403, { error: 'Forbidden' })).toBeNull()
    expect(readPlanRefusal(404, null)).toBeNull()
  })

  it('a thrown refusal carries its sentence and its way forward', () => {
    const r = readPlanRefusal(403, LOCKED)!
    const e = new PlanRefusalError(r)
    expect(e.message).toBe(LOCKED.message)
    expect(refusalOf(e)).toBe(r)
    expect(refusalOf(new Error('x'))).toBeNull()
  })
})

describe('what the screens show', () => {
  it('the notice: the sentence and the button', () => {
    render(<PlanRefusalNotice refusal={readPlanRefusal(403, LOCKED)!} />)
    expect(screen.getByText(LOCKED.message)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See AF Pro' }).getAttribute('href')).toBe(LOCKED.upgradePath)
  })

  it('a tool modal shows the refusal INSTEAD of its error line', () => {
    render(
      <AIToolModalShell open onClose={() => {}} title="Start/Sit" error="Premium feature" refusal={readPlanRefusal(403, LOCKED)}>
        <div>body</div>
      </AIToolModalShell>,
    )
    expect(screen.getByText(LOCKED.message)).toBeTruthy()
    expect(screen.queryByText('Premium feature')).toBeNull()
    expect(screen.getByRole('link', { name: 'See AF Pro' })).toBeTruthy()
  })

  it('and still shows an ordinary error as before', () => {
    render(
      <AIToolModalShell open onClose={() => {}} title="Start/Sit" error="Network error.">
        <div>body</div>
      </AIToolModalShell>,
    )
    expect(screen.getByText('Network error.')).toBeTruthy()
    expect(screen.queryByTestId('plan-refusal')).toBeNull()
  })

  it('Start/Sit end to end: a locked answer from the server becomes the upgrade button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (String(url).includes('/start-sit/analyze') ? json(403, LOCKED) : json(200, { teams: [] }))),
    )
    render(<StartSitModal open onClose={() => {}} leagueId="lg1" leagueName="KBFL" leagues={[{ id: 'lg1', name: 'KBFL', sport: 'NFL' } as never]} />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'See AF Pro' })).toBeTruthy())
    expect(screen.getByRole('link', { name: 'See AF Pro' }).getAttribute('href')).toBe(LOCKED.upgradePath)
    expect(screen.queryByText('Premium feature')).toBeNull()
  })

  it('the matchup panel shows the refusal instead of its error line', () => {
    render(
      <MatchupAiAnalysisPanel sport="NFL" loading={false} result={null} error={LOCKED.message} refusal={readPlanRefusal(403, LOCKED)} onRun={() => {}} />,
    )
    expect(screen.getByRole('link', { name: 'See AF Pro' })).toBeTruthy()
  })
})

describe('the matchup hook', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

  it('a locked answer throws a PlanRefusalError; any other failure a plain Error', async () => {
    const { result } = renderHook(() => useLeagueMatchupAi('lg1'))
    vi.mocked(fetch).mockResolvedValueOnce(json(403, LOCKED))
    let caught: unknown
    await act(async () => {
      caught = await result.current.runMatchupAnalysis({ season: 2026, week: 4 }).catch((e) => e)
    })
    expect(refusalOf(caught)).toMatchObject({ actionHref: LOCKED.upgradePath })

    vi.mocked(fetch).mockResolvedValueOnce(json(500, { error: 'Engine down' }))
    await act(async () => {
      caught = await result.current.runMatchupAnalysis({ season: 2026, week: 4 }).catch((e) => e)
    })
    expect(refusalOf(caught)).toBeNull()
    expect((caught as Error).message).toBe('Engine down')
  })
})

describe('checkout while signed out', () => {
  it('sends them to sign in and back, instead of printing "Unauthorized"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'Unauthorized' })))
    window.history.pushState({}, '', '/pricing?plan=pro')
    const r = await resolveCheckoutUrl({ sku: 'af_pro_monthly', productType: 'subscription', returnPath: '/pricing' })
    expect(r).toEqual({ ok: true, signIn: true, url: '/login?callbackUrl=%2Fpricing%3Fplan%3Dpro' })
  })

  it('any other failure still reads as a failure, with the server sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { error: 'X', message: 'Checkout is temporarily unavailable.' })))
    const r = await resolveCheckoutUrl({ sku: 'af_pro_yearly', productType: 'subscription', returnPath: '/pricing' })
    expect(r).toEqual({ ok: false, error: 'Checkout is temporarily unavailable.' })
  })
})

/*
 * The screens not rendered above (their setup needs a whole league) must still read refusals and
 * show the notice. Anchored to statement starts, so a comment mentioning the helper cannot pass it.
 */
describe('every Chimmy tool screen is wired', () => {
  const modals = [
    'AFWarRoomModal',
    'InjuryImpactModal',
    'LongTermCoachingModal',
    'MatchupPrepModal',
    'PowerRankingsModal',
    'StartSitModal',
    'TrendingPlayersModal',
    'WaiverWireModal',
  ]
  it.each(modals)('%s hands refusals to the modal shell', (name) => {
    const src = readFileSync(path.join(process.cwd(), `components/ai-tools/modals/${name}.tsx`), 'utf8')
    expect(src).toMatch(/^\s*setRefusal\(readPlanRefusal\((r|res)\.status, (json|j), \{ returnTo: currentPathForReturn\(\) \}\)\)/m)
    expect(src).toMatch(/^\s*refusal=\{refusal\}/m)
  })

  it.each([
    ['components/ai-tools/modals/TradeValueModal.tsx', /^\s*<PlanRefusalNotice refusal=\{refusal\}/m],
    ['components/TradeFinderV2.tsx', /^\s*<PlanRefusalNotice refusal=\{refusal\} \/>/m],
    ['components/TradeFinderV2.tsx', /^\s*<PlanRefusalNotice refusal=\{mmRefusal\} \/>/m],
    ['components/matchup-center/MatchupTabContainer.tsx', /^\s*refusal=\{ssRefusal\}/m],
    ['components/matchup-center/MatchupTabContainer.tsx', /^\s*refusal=\{matchupAiRefusal\}/m],
    ['components/matchup-center/MatchupStartSitModal.tsx', /^\s*<PlanRefusalNotice refusal=\{refusal\}/m],
    ['app/league/[leagueId]/components/LeagueSettingsSubPanels.tsx', /^\s*<PlanRefusalNotice refusal=\{refusal\} \/>/m],
  ])('%s shows the notice', (file, pattern) => {
    expect(readFileSync(path.join(process.cwd(), file), 'utf8')).toMatch(pattern)
  })
})
