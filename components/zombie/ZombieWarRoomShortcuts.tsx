'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ZombieSummary } from './types'
import { zombieChipStatus } from './ZombieStatusChip'

/** The summary is already filtered for this viewer, including secret Whisperer identity. */
export function ZombieWarRoomShortcuts({ leagueId }: { leagueId: string }) {
  const [summary, setSummary] = useState<ZombieSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setSummary(null)
    setFailed(false)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/zombie/summary`, { cache: 'no-store' })
      .then(res => { if (!res.ok) throw new Error('Summary unavailable'); return res.json() })
      .then(data => { if (active) setSummary(data as ZombieSummary) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [leagueId])

  const hub = `/zombie/${encodeURIComponent(leagueId)}`
  const role = summary?.myRosterId && summary.myStatus ? zombieChipStatus(summary.myStatus, (summary.revivedRosterIds ?? []).includes(summary.myRosterId)) : null
  return (
    <section className="rounded-2xl border border-lime-300/25 bg-[#091c15]/95 p-4 text-white shadow-lg" data-testid="zombie-war-room-shortcuts">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-lime-200">Zombie league · your field guide</p>
      <h2 className="mt-1 text-lg font-bold">{role === 'whisperer' ? 'Whisperer strategy' : role === 'zombie' ? 'Zombie strategy' : role ? 'Survivor strategy' : 'Prepare for the outbreak'}</h2>
      <p className="mt-1 text-sm leading-6 text-white/75">
        {role === 'whisperer' ? 'Review your ambushes and use the Chimmy action cards to plan a matchup change.' : role === 'zombie' ? 'Review your serum balance and the rules for returning to the survivors.' : role ? 'Check your matchup and supplies before the week locks.' : failed ? 'Your status is unavailable right now. You can still review the league rules.' : summary ? 'Join a team to see your personal status and supplies.' : 'Loading your league status…'}
      </p>
      {role && summary?.myResources && <p className="mt-2 text-xs text-lime-100/85">Your supplies: {summary.myResources.serums} serums · {summary.myResources.weapons} weapons{role === 'whisperer' ? ` · ${summary.myResources.ambush} ambushes` : ''}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`${hub}/matchups`} className="inline-flex min-h-[44px] items-center rounded-xl border border-white/20 bg-black/30 px-3 text-sm font-semibold">Matchups</Link>
        {role && <Link href={role === 'whisperer' ? `${hub}/chat` : `${hub}/items`} className="inline-flex min-h-[44px] items-center rounded-xl border border-lime-300/35 bg-lime-400/15 px-3 text-sm font-semibold text-lime-100">{role === 'whisperer' ? 'Chimmy action cards' : 'Your items'}</Link>}
        <Link href={`${hub}/rules`} className="inline-flex min-h-[44px] items-center rounded-xl border border-white/20 bg-black/30 px-3 text-sm font-semibold">Zombie rules</Link>
      </div>
    </section>
  )
}
