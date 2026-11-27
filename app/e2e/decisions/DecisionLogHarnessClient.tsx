'use client'

import { DecisionLogScreen, type DecisionLogLoader } from '@/components/core-app/screens/DecisionLogScreen'
import { EMPTY_SUMMARY, SAMPLE_DECISIONS, SAMPLE_LEAGUE_NAMES, SAMPLE_SUMMARY } from './fixtures'

/* Module-level loaders: the screen re-reads whenever its loader changes identity. */
const loaders: Record<string, DecisionLogLoader> = {
  ready: async (leagueId) => ({
    ok: true,
    data: {
      decisions: leagueId ? SAMPLE_DECISIONS.filter((d) => d.leagueId === leagueId) : SAMPLE_DECISIONS,
      summary: SAMPLE_SUMMARY,
    },
  }),
  empty: async () => ({ ok: true, data: { decisions: [], summary: EMPTY_SUMMARY } }),
  loading: () => new Promise(() => {}),
  error: async () => ({ ok: false, locked: false }),
  /* The route's 403 — the screen draws the same lock the page draws from the server read. */
  denied: async () => ({ ok: false, locked: true }),
}

export function DecisionLogHarnessClient({ state }: { state: string }) {
  // `locked` is the page's server-side paywall read: the lock, and no load at all.
  if (state === 'locked') return <DecisionLogScreen leagueNames={{}} locked />
  return <DecisionLogScreen leagueNames={SAMPLE_LEAGUE_NAMES} load={loaders[state] ?? loaders.ready} />
}
