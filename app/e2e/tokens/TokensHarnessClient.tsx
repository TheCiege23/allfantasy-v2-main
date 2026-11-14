'use client'

import { TokenCentreV4 } from '@/components/core-app/screens/TokenCentreV4'

type State = 'normal' | 'low' | 'error'

/*
 * The screen reads three APIs. This answers them from the scenario and refuses every other /api/ call,
 * so nothing reaches a database or Stripe. History rows use the real ledger shape
 * (TokenSpendService `toLedgerView`), including the two older descriptions seen live.
 */
type HarnessWindow = Window & { __afTokensHarness?: { state: State; rules: unknown[] } }

const HISTORY: Record<State, unknown[]> = {
  normal: [
    { id: 'h1', entryType: 'spend', tokenDelta: -10, spendFeatureLabel: 'Chimmy question', createdAt: '2026-11-13T18:00:00Z' },
    { id: 'h2', entryType: 'spend', tokenDelta: -30, spendFeatureLabel: 'Full trade review', createdAt: '2026-11-12T20:00:00Z' },
    { id: 'h3', entryType: 'purchase', tokenDelta: 250, description: 'Stripe purchase: AllFantasy AI Tokens (250)', tokenPackageSku: 'af_tokens_5', createdAt: '2026-11-10T15:00:00Z' },
    { id: 'h4', entryType: 'adjustment', tokenDelta: 0, description: 'Daily free allowance (20 token floor)', createdAt: '2026-11-09T09:00:00Z' },
    { id: 'h5', entryType: 'adjustment', tokenDelta: 15, sourceType: 'daily_free_tokens', description: 'Daily free floor: 2 Chimmy questions', createdAt: '2026-11-08T09:00:00Z' },
    { id: 'h6', entryType: 'refund', tokenDelta: 10, spendFeatureLabel: 'Chimmy question', createdAt: '2026-11-07T11:00:00Z' },
  ],
  low: [],
  error: [],
}

const BALANCE: Record<State, number | null> = { normal: 250, low: 12, error: null }

function install(state: State, rules: unknown[]) {
  if (typeof window === 'undefined') return
  const w = window as HarnessWindow
  const first = !w.__afTokensHarness
  w.__afTokensHarness = { state, rules }
  if (!first) return
  const real = window.fetch.bind(window)
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    const cur = w.__afTokensHarness!
    if (url.origin === window.location.origin) {
      if (url.pathname === '/api/tokens/spend-rules') return json({ rules: cur.rules })
      if (url.pathname === '/api/tokens/history') return json({ entries: HISTORY[cur.state] })
      if (url.pathname === '/api/tokens/balance') {
        const b = BALANCE[cur.state]
        return b == null ? json({ error: 'harness: balance unavailable' }, 503) : json({ balance: b, updatedAt: '2026-11-14T12:00:00Z' })
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'harness: no API' }, 503)
    }
    return real(input, init)
  }
}

export default function TokensHarnessClient({
  state,
  packs,
  rules,
}: {
  state: State
  packs: Array<{ sku: string; amountUsd: number; tokenAmount: number | null }>
  rules: unknown[]
}) {
  install(state, rules)
  return <TokenCentreV4 packs={packs} />
}
