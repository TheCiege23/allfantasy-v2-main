'use client'

import { SessionProvider } from 'next-auth/react'
import PlayoffBracketShell from '@/components/brackets/playoffs/PlayoffBracketShell'
import PlayoffBracketEntryShell from '@/components/brackets/playoffs/PlayoffBracketEntryShell'
import BracketQuickNav from '@/components/brackets/BracketQuickNav'
import { HARNESS_USER_ID, VIEWS } from './fixtures'

/**
 * Harness only (app/e2e is 404 in production). Mirrors app/brackets/leagues/[leagueId]/page.tsx — the REAL
 * `PlayoffBracketShell` over `initialView` — with the view from fixtures.ts in place of `getPlayoffBracketView`.
 * The shell reads `useSession`, and /e2e routes get a null session, so this nests one carrying the viewer's id
 * (no /api/auth call is made).
 */
export default function BracketPoolHarnessClient({ variant, screen = 'dashboard' }: { variant: keyof typeof VIEWS; screen?: 'dashboard' | 'entry' }) {
  const view = VIEWS[variant]
  return (
    <SessionProvider
      session={{ user: { id: view.viewerUserId ?? HARNESS_USER_ID, name: 'Harness', email: null, image: null }, expires: '2099-01-01T00:00:00.000Z' } as never}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      {screen === 'entry' ? (
        // Mirrors app/brackets/leagues/[leagueId]/entries/[entryId]/page.tsx: quick nav, then the pick screen.
        <>
          <BracketQuickNav leagueId={view.challenge.id} showInvite={view.challenge.ownerUserId === view.viewerUserId && Boolean(view.challenge.inviteCode)} />
          <PlayoffBracketEntryShell initialView={view} />
        </>
      ) : (
        <PlayoffBracketShell initialView={view} initialInviteCode={null} />
      )}
    </SessionProvider>
  )
}
