'use client'

/**
 * CommissionerLeaderboard — dashboard card for commissioners: every owned
 * league pulse-scanned (shared commissionerPulseService), ranked worst-first,
 * with one-tap "send nudge" that posts a friendly system message to that
 * league's chat (deduped 3 days per roster). Renders nothing for
 * non-commissioners.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { sleeperAvatarThumb } from '@/lib/sports-data/headshots'
import { WarRoomCard } from './warroom/WarRoomCard'
import { SectionHeading } from './warroom/SectionHeading'
import '@/components/decide/broadcast-deck.css'

type PulseManager = {
  rosterId: number
  ownerId: string | null
  name: string
  teamName: string | null
  avatar: string | null
  signals: string[]
  flagged: boolean
}
type Row = {
  leagueId: string
  leagueName: string
  flaggedCount: number
  teamCount: number
  flagged: PulseManager[]
}
type ApiResponse = { rows: Row[]; method: string | null }

export function CommissionerLeaderboard() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [nudgeState, setNudgeState] = useState<Record<string, 'working' | 'sent' | 'cooldown' | 'failed'>>({})

  useEffect(() => {
    let cancelled = false
    void fetch('/api/dashboard/commissioner-leaderboard', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<ApiResponse>) : null))
      .then((payload) => {
        if (!cancelled) setData(payload ?? null)
      })
      .catch(() => {
        /* additive */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const nudge = useCallback(async (leagueId: string, rosterId: number) => {
    const key = `${leagueId}:${rosterId}`
    setNudgeState((p) => ({ ...p, [key]: 'working' }))
    try {
      const res = await fetch('/api/dashboard/commissioner-leaderboard', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, rosterId }),
      })
      const payload = (await res.json().catch(() => ({}))) as { posted?: boolean; reason?: string }
      setNudgeState((p) => ({
        ...p,
        [key]: payload.posted ? 'sent' : payload.reason?.includes('3 days') ? 'cooldown' : 'failed',
      }))
    } catch {
      setNudgeState((p) => ({ ...p, [key]: 'failed' }))
    }
  }, [])

  if (!loading && (!data || data.rows.length === 0)) return null

  return (
    <WarRoomCard className="p-4 sm:p-5" data-testid="commissioner-leaderboard">
      <SectionHeading
        trailing={
          data ? (
            <span className="text-[10px] font-bold uppercase tracking-wide text-white/30">
              {data.rows.length} leagues you run
            </span>
          ) : undefined
        }
      >
        League health — your commissioner leagues
      </SectionHeading>
      {loading || !data ? (
        <div className="bdx-skel" style={{ height: 56, marginTop: 12 }} />
      ) : (
        <div className="bdx mt-3 space-y-3" style={{ background: 'transparent', padding: 0 }}>
          {data.rows.map((row) => (
            <div key={row.leagueId} className="rounded-xl border border-[#262c6a] bg-[#12163e]/70 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/league/${row.leagueId}?view=decide`}
                  className="text-[12.5px] font-extrabold text-[#f0f2ff] hover:underline"
                >
                  {row.leagueName}
                </Link>
                {row.flaggedCount > 0 ? (
                  <span className="bdx-sev warn">⚠ {row.flaggedCount} of {row.teamCount} teams flagged</span>
                ) : (
                  <span className="bdx-sev ok">✓ all {row.teamCount} teams alive</span>
                )}
              </div>
              {row.flagged.map((m) => {
                const key = `${row.leagueId}:${m.rosterId}`
                const state = nudgeState[key]
                const av = sleeperAvatarThumb(m.avatar)
                return (
                  <div key={m.rosterId} className="mt-2 flex flex-wrap items-center gap-2">
                    {av ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={av} alt="" className="h-5 w-5 rounded-full object-cover" />
                    ) : null}
                    <span className="text-[11.5px] font-semibold text-[#c6cbf5]">{m.teamName || m.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-[#8b93cf]">{m.signals.join(' · ')}</span>
                    {state === 'sent' ? (
                      <span className="bdx-sev ok">✓ nudged</span>
                    ) : state === 'cooldown' ? (
                      <span className="bdx-sev info">nudged recently</span>
                    ) : (
                      <button
                        type="button"
                        className="bdx-btn sec"
                        style={{ padding: '3px 10px', fontSize: 10.5 }}
                        disabled={state === 'working'}
                        onClick={() => void nudge(row.leagueId, m.rosterId)}
                        title="Posts a friendly system message to the league chat naming the counted signals. Max once per 3 days per team."
                      >
                        {state === 'working' ? 'Sending…' : state === 'failed' ? 'Retry nudge' : 'Send nudge'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {data.method ? <p className="text-[10px] leading-snug text-[#5d64a3]">{data.method}</p> : null}
        </div>
      )}
    </WarRoomCard>
  )
}

export default CommissionerLeaderboard
