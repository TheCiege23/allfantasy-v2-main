import type { Metadata } from 'next'

import { SleeperCheck } from '@/components/sleeper-check/SleeperCheck'
import { normalizeSleeperUsername } from '@/lib/sleeper-check/username'

/**
 * `/check` — the public Sleeper lookup the game-day ads land on (Guap, 2026-09-27: public
 * username lookup, no account; signing up is what it takes to act).
 *
 * The page itself is static marketing HTML, so crawlers and link previews get the pitch. The
 * lookup runs in the browser against `/api/sleeper-check`, so no person's results are ever
 * rendered into an indexable page — a shared `?u=` link runs the check for whoever opens it.
 */

export const metadata: Metadata = {
  title: 'Who is hurt in your Sleeper lineups? | AllFantasy',
  description:
    'Type your Sleeper username. See every player you roster, every injury designation, and every league he is starting in. Free, no account.',
  alternates: { canonical: '/check' },
  openGraph: {
    title: 'Who is hurt in your Sleeper lineups?',
    description: 'Every player you roster, every injury, every league he is starting in. Free, no account.',
    url: '/check',
  },
}

export default function CheckPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const u = searchParams?.u
  const raw = Array.isArray(u) ? u[0] : u
  return <SleeperCheck initialUsername={normalizeSleeperUsername(raw) ?? ''} />
}
