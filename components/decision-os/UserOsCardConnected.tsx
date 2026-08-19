'use client'

import { useEffect, useState } from 'react'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'
import UserOsCard from '@/components/decision-os/UserOsCard'

/**
 * Phase 36 — self-contained connector for `UserOsCard`, reusing the exact real
 * fetch pattern `app/league/[leagueId]/tabs/LeagueTab.tsx` already uses for
 * NBA/MLB/NHL/NCAAB/SOCCER/PGA leagues (same `/api/decision-os/user-os` route,
 * same session-scoped authorization — the route always resolves the caller's
 * own managerId server-side, never a client-suppliable one).
 *
 * Built so NFL/NCAAF leagues (`NflRedraftLeagueHomeDashboard.tsx`) can reach
 * Manager OS without duplicating `UserOsCard`'s own rendering/state logic —
 * this component only owns the fetch; `UserOsCard` still owns every visual state.
 */
export default function UserOsCardConnected({ leagueId, variant = 'league' }: { leagueId: string; variant?: 'dashboard' | 'league' | 'commissioner' }) {
  const [snapshot, setSnapshot] = useState<UserOsSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    setSnapshot(null)
    void fetch(`/api/decision-os/user-os?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? (res.json() as Promise<UserOsSnapshot>) : null))
      .then((data) => {
        if (!cancelled) setSnapshot(data)
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  return <UserOsCard snapshot={snapshot} variant={variant} />
}
