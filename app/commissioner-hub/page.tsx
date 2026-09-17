import { redirect } from 'next/navigation'

/**
 * /commissioner-hub → /core/commissioner (five-doors restyle, 2026-09-17).
 *
 * This page was the all-leagues Commissioner Hub, and it did two jobs: what needs a
 * commissioner this week, and Commissioner OS-style analytics. The user's calls
 * (gap analysis of 2026-09-15, answered 2026-09-17): both hub views live in /core,
 * analytics live in Commissioner OS, and this address forwards. Where each section
 * went, so nothing reads as dropped by accident:
 *
 *   kept, restyled   the cross-league attention queue (all six detectors — see
 *                    lib/core-app/commissioner/signals.ts), the @everyone
 *                    broadcast (inline composer now), league status chips, and
 *                    the tournament-hub entry under the same conditions
 *   moved            League Pulse, League/Trade OS panels, Manager DNA,
 *                    recommendations and the health map → Commissioner OS;
 *                    "Send invites" → the one-league screen's Members area;
 *                    "Open format hubs" → the hub switcher
 *   removed          the landing-page hero, the sample-data preview (an honest
 *                    empty state instead), the platform data-coverage "Command
 *                    Center", "Ask Commissioner AI" (Chimmy is on every /core
 *                    screen), the Draft readiness card (Draft HQ), the Migration
 *                    Center (/import), "Leagues I play in", and the no-gambling
 *                    banner
 *
 * `CommissionerHubPageClient.tsx` beside this file is no longer routed. It is left
 * for a deliberate dead-code pass: several suites still read its source.
 *
 * ⚠ A PAGE, NOT A next.config REDIRECT, so the address keeps its existing route and
 * adds none (standing rule: no new routes).
 */
export const dynamic = 'force-dynamic'

export default function CommissionerHubRedirect(): never {
  redirect('/core/commissioner')
}
